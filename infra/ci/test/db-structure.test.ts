import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { makeTempDir, repoRoot, run, writeFiles } from "./helpers.js";

// 结构快照、约束清单比对、分区断言的用例（W0-06b）。要反过来试：在库上改一处，检查必须查得出，并且指到改的那一处。
// 连的是本地那套共享的 PostgreSQL（先 pnpm infra:up；连接参数取 DATABASE_URL 或 PG*，见 CLAUDE.md 第 9 节）。
// 连不上即失败，不跳过。不碰 lyx_schema_check、lyx_migrate_check：自己建一个基准库，跑完全部迁移，用完删掉。
//   “改一处”两组：每一例在基准库上开事务、改一处、读系统目录、回滚，再与入库的快照比；基准库始终不变。
//   “命令行”一组：从基准库拷出一个真改过的库，三个命令各跑一遍，看退出码与输出。
// 要动手脚的对象都从基准库的结构里现挑，不点名：以后加表、改索引的包不用回来改这份用例。

interface Row {
  key: string;
  def: Record<string, unknown>;
}
type Sections = Record<string, Row[]>;
type Counts = Record<string, [number, number]>;
interface Structure {
  version: string;
  sections: Sections;
  counts: Counts;
  partitions: string[];
}
interface PartitionTrigger {
  name: string;
  enabled: string;
  row: boolean;
  truncate: boolean;
  function: string;
}
interface PartitionInfo {
  today: string;
  parents: Array<{
    name: string;
    strategy: string;
    triggers: PartitionTrigger[];
    children: Array<{ name: string; bound: string; rows: number; triggers: PartitionTrigger[] }>;
  }>;
}
interface DbLib {
  CATALOG_SQL: string;
  parseCatalog(output: string): Record<string, never>;
  psql(db: string, sql: string): { status: number; stdout: string; stderr: string };
  sqlOrThrow(db: string, sql: string): string;
  recreateDb(name: string, options?: { template?: string }): void;
  dropDb(name: string): void;
}
interface StructureLib {
  SNAPSHOT_PATH: string;
  PARTITION_SQL: string;
  applyMigrations(db: string): string[];
  structureOf(catalog: Record<string, never>): Structure;
  renderSnapshot(structure: Pick<Structure, "sections" | "counts">): string;
  parseSnapshot(text: string): Pick<Structure, "sections" | "counts">;
  diffStructure(expected: Sections, actual: Sections, names: [string, string]): string[];
  readDocCounts(root?: string): Counts;
  countProblems(a: Counts, b: Counts, names: [string, string], columns?: number[]): string[];
  expectedMonths(today: string): Array<{ suffix: string; bound: string }>;
  partitionProblems(info: PartitionInfo, today?: string): string[];
}
const load = async <T>(path: string) =>
  (await import(pathToFileURL(join(repoRoot, path)).href)) as T;
const db = await load<DbLib>("infra/ci/db-lib.mjs");
const lib = await load<StructureLib>("infra/ci/db-structure-lib.mjs");

const BASE = `lyx_test_infra_struct_${process.pid}`;
const COPY = `${BASE}_copy`;
const stored = readFileSync(join(repoRoot, lib.SNAPSHOT_PATH), "utf8");
const snapshot = lib.parseSnapshot(stored);
let base: Structure;
let partitions: PartitionInfo;

beforeAll(() => {
  db.recreateDb(BASE);
  lib.applyMigrations(BASE);
  base = lib.structureOf(db.parseCatalog(db.sqlOrThrow(BASE, db.CATALOG_SQL)));
  partitions = JSON.parse(db.sqlOrThrow(BASE, lib.PARTITION_SQL)) as PartitionInfo;
}, 240_000);

afterAll(() => {
  db.dropDb(COPY);
  db.dropDb(BASE);
}, 240_000);

/** 在基准库上开事务、跑一段语句、读系统目录、回滚；返回与快照的差异（结构在前，逻辑表口径的数量在后） */
function problemsAfter(sql: string): string[] {
  const output = db.sqlOrThrow(BASE, `begin;\n${sql};\n${db.CATALOG_SQL}\nrollback;`);
  const mutated = lib.structureOf(db.parseCatalog(output));
  return [
    ...lib.diffStructure(snapshot.sections, mutated.sections, ["快照", "库里"]),
    ...lib.countProblems(snapshot.counts, mutated.counts, ["快照", "库里"], [0]),
  ];
}

/** 同上，读的是分区情况 */
function partitionProblemsAfter(sql: string): string[] {
  const output = db.sqlOrThrow(BASE, `begin;\n${sql};\n${lib.PARTITION_SQL}\nrollback;`);
  return lib.partitionProblems(JSON.parse(output) as PartitionInfo);
}

const text = (value: unknown) => String(value);
const ordinary = (table: unknown) =>
  base.sections.tables?.find((row) => row.key === table)?.def.kind === "r";
/** 一个不唯一的部分索引（建在普通表上的；排他约束名下的那个删不掉，不挑） */
const partialIndex = () => {
  const found = base.sections.indexes?.find(
    (row) =>
      / WHERE /.test(text(row.def.definition)) &&
      !row.def.unique &&
      !row.def.exclusion &&
      ordinary(row.def.table),
  );
  if (!found) throw new Error("基准库里挑不出部分索引");
  return found.key;
};
/** 一个建在普通表上的触发器：[表, 触发器名, 它调的函数（带参数表的写法）] */
const someTrigger = (): [string, string, string] => {
  for (const row of base.sections.triggers ?? []) {
    const [table = "", name = ""] = row.key.split(".");
    const fn = text(row.def.definition).match(/EXECUTE FUNCTION (\w+)\(\)$/)?.[1];
    if (fn && ordinary(table)) return [table, name, `${fn}()`];
  }
  throw new Error("基准库里挑不出触发器");
};
/** 一列能直接改成 bigint 的 integer 列（挨个试，被触发器、外键用着的列改不动）：[表, 列] */
const integerColumn = (): [string, string] => {
  for (const row of base.sections.columns ?? []) {
    const [table = "", column = ""] = row.key.split(".");
    if (row.def.type !== "integer" || !ordinary(table)) continue;
    const sql = `begin;\nALTER TABLE ${table} ALTER COLUMN ${column} TYPE bigint;\nrollback;`;
    if (db.psql(BASE, sql).status === 0) return [table, column];
  }
  throw new Error("基准库里挑不出能改类型的 integer 列");
};

describe("结构快照：入库的那一份就是迁移建出来的样子", () => {
  it("空库跑完全部迁移后重新生成，与入库的快照逐字节相同", () => {
    expect(lib.renderSnapshot(base)).toBe(stored);
    expect(base.version.startsWith("17.")).toBe(true);
  });

  it("快照里没有分区子表及其名下的东西；数量与 06 第 1 节两组口径都对得上", () => {
    expect(base.partitions.length).toBeGreaterThan(0);
    // 函数体可以合法引用兜底分区；排除的是子表对象与其名下的结构，不是全文中的名字。
    for (const child of base.partitions) {
      expect(
        snapshot.sections.tables?.some((row) => row.key === child),
        child,
      ).toBe(false);
      for (const section of ["columns", "constraints", "triggers"]) {
        expect(
          snapshot.sections[section]?.some((row) => row.key.startsWith(`${child}.`)),
          `${section}: ${child}`,
        ).toBe(false);
      }
      expect(
        snapshot.sections.indexes?.some((row) => row.def.table === child),
        child,
      ).toBe(false);
    }
    expect(lib.countProblems(lib.readDocCounts(), snapshot.counts, ["06 第 1 节", "快照"])).toEqual(
      [],
    );
    // 逻辑表口径的数量就是各节的行数：计数一节不是另记的一本账
    expect(snapshot.counts["表"]?.[0]).toBe(snapshot.sections.tables?.length);
    expect(snapshot.counts["索引"]?.[0]).toBe(snapshot.sections.indexes?.length);
    expect(snapshot.counts["触发器"]?.[0]).toBe(snapshot.sections.triggers?.length);
  });

  it("读法与写法互逆；认不出的行报错，不猜", () => {
    expect(lib.renderSnapshot(lib.parseSnapshot(stored))).toBe(stored);
    expect(() => lib.parseSnapshot("## 视图\n")).toThrow(/第 1 行：不认识的节“视图”/);
    expect(() => lib.parseSnapshot("## 表\n只有名字没有定义\n")).toThrow(/第 2 行：写法认不出/);
  });
});

describe("改一处，查得出，且指到改的那一处", () => {
  it("没改：0 差异", () => {
    expect(problemsAfter("select 1 where false")).toEqual([]);
  });

  it("删一个部分索引：指到该索引，索引与部分索引的数量各少 1", () => {
    const index = partialIndex();
    const [total, partial] = [
      snapshot.counts["索引"]?.[0] ?? 0,
      snapshot.counts["部分索引"]?.[0] ?? 0,
    ];
    expect(problemsAfter(`DROP INDEX ${index}`)).toEqual([
      `【索引】${index}：快照有，库里没有`,
      `【计数】索引：快照 ${total}；库里 ${total - 1}`,
      `【计数】部分索引：快照 ${partial}；库里 ${partial - 1}`,
    ]);
  });

  it("改一列类型：指到该列", () => {
    const [table, column] = integerColumn();
    const found = problemsAfter(`ALTER TABLE ${table} ALTER COLUMN ${column} TYPE bigint`);
    // 这一列上的 CHECK、索引可能跟着重写（定义里的类型转换变了）而多报几条：只钉住指到该列的那一条
    expect(found).toContain(`【列】${table}.${column} 的 type 不同：快照 "integer"；库里 "bigint"`);
  });

  it("触发器被停用：定义没变，启停变了", () => {
    const [table, trigger] = someTrigger();
    expect(problemsAfter(`ALTER TABLE ${table} DISABLE TRIGGER ${trigger}`)).toEqual([
      `【触发器】${table}.${trigger} 的 enabled 不同：快照 "O"；库里 "D"`,
    ]);
  });

  it("触发器被删掉", () => {
    const [table, trigger] = someTrigger();
    const total = snapshot.counts["触发器"]?.[0] ?? 0;
    expect(problemsAfter(`DROP TRIGGER ${trigger} ON ${table}`)).toEqual([
      `【触发器】${table}.${trigger}：快照有，库里没有`,
      `【计数】触发器：快照 ${total}；库里 ${total - 1}`,
    ]);
  });

  it("触发器函数被换成空函数：名字、参数都没变，函数体变了", () => {
    const [, , fn] = someTrigger();
    const found = problemsAfter(
      `CREATE OR REPLACE FUNCTION ${fn} RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$`,
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(
      new RegExp(`^【函数】${fn.replace(/[()]/g, "\\$&")} 的 definition 不同：快照 `),
    );
  });

  it("整张表的触发器都被停用：外键靠内部触发器校验，约束一节也报", () => {
    const [table] = someTrigger();
    const found = problemsAfter(`ALTER TABLE ${table} DISABLE TRIGGER ALL`);
    expect(found.some((line) => line.startsWith(`【触发器】${table}.`))).toBe(true);
    for (const line of found) expect(line).toMatch(/ 的 (?:enabled|internal_triggers) 不同：/);
  });

  it("表上开了行级安全；库里多出一张表", () => {
    const [table] = someTrigger();
    expect(problemsAfter(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`)).toEqual([
      `【表】${table} 的 row_security 不同：快照 false；库里 true`,
    ]);
    const total = snapshot.counts["表"]?.[0] ?? 0;
    expect(problemsAfter("CREATE TABLE lyx_probe_extra (id uuid)")).toEqual([
      "【表】lyx_probe_extra：库里有，快照没有",
      "【列】lyx_probe_extra.id：库里有，快照没有",
      `【计数】表：快照 ${total}；库里 ${total + 1}`,
    ]);
  });

  it("规范化：多建一个月的分区、动分区子表上的触发器，快照这边都没有差异（归分区断言管）", () => {
    const parent = partitions.parents[0];
    const child = parent?.children.find((item) => item.bound !== "DEFAULT");
    const guard = child?.triggers.find((item) => item.truncate);
    expect(child && guard).toBeTruthy();
    expect(
      problemsAfter(
        `CREATE TABLE ${parent?.name}_y2099m01 PARTITION OF ${parent?.name} ` +
          `FOR VALUES FROM ('2099-01-01 00:00:00+08') TO ('2099-02-01 00:00:00+08');\n` +
          `ALTER TABLE ${child?.name} DISABLE TRIGGER ${guard?.name}`,
      ),
    ).toEqual([]);
  });
});

describe("数量只写在文档与快照里", () => {
  const temp = makeTempDir("lyx-doc-counts-");
  afterAll(temp.cleanup);
  const doc = readFileSync(join(repoRoot, "docs/06-data-model.md"), "utf8");
  const countsWith = (content: string) => {
    writeFiles(temp.dir, { "docs/06-data-model.md": content });
    return lib.readDocCounts(temp.dir);
  };

  it("06 第 1 节行内改一个数，读出来的跟着变，与快照对不上的那一项报出来", () => {
    const logical = snapshot.counts["索引"]?.[0] ?? 0;
    const from = `索引 ${logical.toLocaleString("en-US")} 个（部分索引`;
    expect(doc).toContain(from);
    const changed = countsWith(doc.replace(from, `索引 ${logical + 1} 个（部分索引`));
    expect(lib.countProblems(changed, snapshot.counts, ["06 第 1 节", "快照"])).toEqual([
      `【计数】索引：06 第 1 节 ${logical + 1} / ${snapshot.counts["索引"]?.[1]}；快照 ${logical} / ${snapshot.counts["索引"]?.[1]}`,
    ]);
  });

  it("那一条的句式被改写、读不出数：报错，不当成通过", () => {
    expect(() => countsWith(doc.replace("只数 ", "仅统计 "))).toThrow(/读不出逻辑表口径的几个数/);
    expect(() => countsWith("# 空文档\n")).toThrow(/读不出表数/);
  });
});

describe("分区断言", () => {
  const parent = () => {
    const found = partitions.parents[0];
    if (!found) throw new Error("基准库里没有分区表");
    return found;
  };
  const months = () => lib.expectedMonths(partitions.today);
  const rowTrigger = () => parent().triggers.find((item) => item.row)?.name ?? "";

  it("刚跑完迁移的库：成立。兜底分区在且为空，当月与未来 3 个月的分区都在", () => {
    expect(lib.partitionProblems(partitions)).toEqual([]);
    const names = parent().children.map((child) => child.name);
    expect(names).toContain(`${parent().name}_default`);
    for (const { suffix } of months()) expect(names).toContain(`${parent().name}_${suffix}`);
    expect(rowTrigger()).not.toBe("");
  });

  it("删一个未来月的分区：指到那个月", () => {
    const last = `${parent().name}_${months().at(-1)?.suffix}`;
    expect(partitionProblemsAfter(`DROP TABLE ${last}`)).toEqual([
      `${parent().name}：分区 ${last} 不存在（当月与未来 3 个月都要有）`,
    ]);
  });

  it("往兜底分区写一行：不成立", () => {
    // 发生时间取 2000 年：没有哪个月分区接得住，落进兜底分区
    const insert =
      `insert into ${parent().name} (occurred_at, id, event_id, name, source, actor_type) ` +
      `values ('2000-01-01T00:00:00Z', gen_random_uuid(), 'struct-' || gen_random_uuid(), 'struct_test', 'direct', 'system')`;
    expect(partitionProblemsAfter(insert)).toEqual([
      `${parent().name}：兜底分区 ${parent().name}_default 里有数据，应为空`,
    ]);
  });

  it("子表上拦 TRUNCATE 的触发器被停用、被删掉；父表带下来的行级触发器被停用", () => {
    const child = parent().children.find((item) => item.bound !== "DEFAULT");
    const guard = child?.triggers.find((item) => item.truncate);
    if (!child || !guard) throw new Error("基准库的月分区上没有拦 TRUNCATE 的触发器");
    expect(
      partitionProblemsAfter(`ALTER TABLE ${child.name} DISABLE TRIGGER ${guard.name}`),
    ).toEqual([`${child.name}：拦 TRUNCATE 的触发器 ${guard.name} 被停用或改了启用方式`]);
    expect(partitionProblemsAfter(`DROP TRIGGER ${guard.name} ON ${child.name}`)).toEqual([
      `${child.name}：没有拦 TRUNCATE 的语句级触发器（调 ${guard.function}）`,
    ]);
    expect(
      partitionProblemsAfter(`ALTER TABLE ${child.name} DISABLE TRIGGER ${rowTrigger()}`),
    ).toEqual([`${child.name}：触发器 ${rowTrigger()} 被停用或改了启用方式（D）`]);
  });

  it("“当月”往后挪一个月：少最远的那个月（长期留着的库过了月初就是这样）", () => {
    const [year = 0, month = 0] = partitions.today.split("-").map(Number);
    const next = `${month === 12 ? year + 1 : year}-${String((month % 12) + 1).padStart(2, "0")}-01`;
    const missing = lib.expectedMonths(next).at(-1)?.suffix;
    expect(lib.partitionProblems(partitions, next)).toEqual([
      `${parent().name}：分区 ${parent().name}_${missing} 不存在（当月与未来 3 个月都要有）`,
    ]);
  });

  it("月份的算法：跨年、十二月；上下界是北京时间的月界", () => {
    expect(lib.expectedMonths("2026-11-30").map((month) => month.suffix)).toEqual([
      "y2026m11",
      "y2026m12",
      "y2027m01",
      "y2027m02",
    ]);
    expect(lib.expectedMonths("2026-12-01")[0]).toEqual({
      suffix: "y2026m12",
      bound: "FOR VALUES FROM ('2026-12-01 00:00:00+08') TO ('2027-01-01 00:00:00+08')",
    });
  });

  it("一张分区表都没有、上下界不对、兜底分区不在：都不成立", () => {
    expect(lib.partitionProblems({ today: "2026-10-05", parents: [] })).toEqual([
      "这个库里一张分区表都没有：连错了库，或迁移没跑",
    ]);
    const info = structuredClone(partitions);
    const children = info.parents[0]?.children ?? [];
    const month = children.find((child) => child.bound !== "DEFAULT");
    if (month)
      month.bound = "FOR VALUES FROM ('2020-01-01 00:00:00+08') TO ('2020-02-01 00:00:00+08')";
    children.splice(
      children.findIndex((child) => child.bound === "DEFAULT"),
      1,
    );
    const found = lib.partitionProblems(info);
    expect(found).toContain(`${parent().name}：兜底分区 ${parent().name}_default 不存在`);
    expect(found.some((line) => line.includes(`分区 ${month?.name} 的上下界不对`))).toBe(true);
  });
});

describe("命令行", () => {
  const node = (script: string, ...args: string[]) => run("node", [script, ...args], repoRoot);
  let index = "";
  let column: [string, string] = ["", ""];
  let trigger: [string, string, string] = ["", "", ""];
  let month = "";

  beforeAll(() => {
    index = partialIndex();
    column = integerColumn();
    trigger = someTrigger();
    month = `${partitions.parents[0]?.name}_${lib.expectedMonths(partitions.today).at(-1)?.suffix}`;
    db.recreateDb(COPY, { template: BASE });
    db.sqlOrThrow(
      COPY,
      [
        `DROP INDEX ${index}`,
        `ALTER TABLE ${column[0]} ALTER COLUMN ${column[1]} TYPE bigint`,
        `ALTER TABLE ${trigger[0]} DISABLE TRIGGER ${trigger[1]}`,
        `DROP TABLE ${month}`,
      ].join(";\n"),
    );
  }, 240_000);

  it("没动过的库：三个命令都通过", () => {
    const snap = node("infra/ci/db-snapshot.mjs", "--db", BASE, "--check");
    expect(snap.output).toContain("结构快照无差异");
    expect(snap.status).toBe(0);
    const constraints = node("infra/ci/db-constraints.mjs", "--db", BASE);
    expect(constraints.output).toContain(
      "结论：通过。六节逐条一致，数量与快照、06 第 1 节对得上。",
    );
    expect(constraints.status).toBe(0);
    const assert = node("infra/ci/db-partition-assert.mjs", "--db", BASE);
    expect(assert.output).toContain("结论：成立。");
    expect(assert.status).toBe(0);
  });

  it("改过的库：快照比对与约束清单比对都失败，指到被删的部分索引、改了类型的列、被停用的触发器", () => {
    for (const result of [
      node("infra/ci/db-snapshot.mjs", "--db", COPY, "--check"),
      node("infra/ci/db-constraints.mjs", "--db", COPY),
    ]) {
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(`- 【索引】${index}：快照有，库里没有`);
      expect(result.stderr).toContain(
        `- 【列】${column[0]}.${column[1]} 的 type 不同：快照 "integer"；库里 "bigint"`,
      );
      expect(result.stderr).toContain(
        `- 【触发器】${trigger[0]}.${trigger[1]} 的 enabled 不同：快照 "O"；库里 "D"`,
      );
      // 少了一个月的分区不归这两条管
      expect(result.output).not.toContain(month);
    }
  });

  it("改过的库：分区断言不成立，指到少的那个月；--check 不写文件", () => {
    const assert = node("infra/ci/db-partition-assert.mjs", "--db", COPY);
    expect(assert.status).toBe(1);
    expect(assert.stderr).toContain(`分区 ${month} 不存在`);
    expect(readFileSync(join(repoRoot, lib.SNAPSHOT_PATH), "utf8")).toBe(stored);
  });

  it("用法与环境错误是退出码 2，不与“有差异”混在一起", () => {
    const missing = "lyx_test_infra_struct_missing";
    expect(node("infra/ci/db-snapshot.mjs", "--db", missing, "--check").status).toBe(2);
    expect(node("infra/ci/db-constraints.mjs", "--db", missing).status).toBe(2);
    expect(node("infra/ci/db-partition-assert.mjs", "--db", missing).status).toBe(2);
    expect(node("infra/ci/db-snapshot.mjs", "--nope").status).toBe(2);
    expect(node("infra/ci/db-constraints.mjs", "--nope").status).toBe(2);
    expect(node("infra/ci/db-partition-assert.mjs", "--today", "十月").status).toBe(2);
  });
});
