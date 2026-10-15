import { cpSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { makeTempDir, repoRoot, run } from "./helpers.js";

// 系统目录比对脚本的用例（W0-05）。比对脚本是甲类证据的来源，要反过来试：在库上改一处，它必须查得出，
// 并且指到改的那一处。连的是本地那套共享的 PostgreSQL（先 pnpm infra:up；连接参数取 DATABASE_URL 或 PG*，
// 见 CLAUDE.md 第 9 节）。连不上即失败，不跳过。
// 不碰 lyx_schema_check、lyx_migrate_check：自己用首版迁移建一个基准库 lyx_test_infra_catdiff_<进程号>，用完删掉。
//   “逐项反向试验”一组：每一例在基准库上开事务、改一处、读系统目录、回滚，再与没改过的目录比；基准库始终不变。
//   “命令行”一组：从基准库拷出真改过的库，跑 db-catalog-diff.mjs 本身，看退出码、输出与报告文件。

interface Row {
  key: string;
  def: Record<string, unknown>;
}
type Catalog = { version: string } & Record<string, Row[]>;
interface DbLib {
  CATEGORIES: Array<[string, string]>;
  CATALOG_SQL: string;
  parseCatalog(output: string): Catalog;
  readCatalog(db: string): Catalog;
  diffRows(refRows: Row[], targetRows: Row[]): string[];
  countsOf(catalog: Catalog): Record<string, [number, number]>;
  sqlOrThrow(db: string, sql: string): string;
  recreateDb(name: string, options?: { template?: string }): void;
  dropDb(name: string): void;
}
const lib = (await import(pathToFileURL(join(repoRoot, "infra/ci/db-lib.mjs")).href)) as DbLib;

const structureLib = (await import(
  pathToFileURL(join(repoRoot, "infra/ci/db-structure-lib.mjs")).href
)) as {
  applyMigrations(db: string): void;
  readStructure(db: string): { sections: unknown; counts: Record<string, [number, number]> };
  renderSnapshot(structure: unknown): string;
  parseSnapshot(text: string): { counts: Record<string, [number, number]> };
};
const currentCheckCounts = structureLib.parseSnapshot(
  readFileSync(join(repoRoot, "packages/db/snapshot/structure.txt"), "utf8"),
).counts["CHECK 约束"];
if (!currentCheckCounts) throw new Error("现行结构快照缺少 CHECK 约束计数");
const CURRENT = `lyx_test_infra_catcurrent_${process.pid}`;
const SCRIPT = "infra/ci/db-catalog-diff.mjs";
const MIGRATION = "packages/db/prisma/migrations/20261005000000_init/migration.sql";
const BASE = `lyx_test_infra_catdiff_${process.pid}`;
const COPY = `${BASE}_copy`;
const temp = makeTempDir("lyx-catalog-diff-");
let base: Catalog;

beforeAll(() => {
  lib.recreateDb(BASE);
  // 整个迁移放进一个事务：与 migrate deploy 一次发出去的效果相同，也比逐句提交快
  lib.sqlOrThrow(BASE, `begin;\n${readFileSync(join(repoRoot, MIGRATION), "utf8")}\ncommit;`);
  base = lib.readCatalog(BASE);
  lib.recreateDb(CURRENT);
  structureLib.applyMigrations(CURRENT);
}, 120_000);

afterAll(() => {
  lib.dropDb(COPY);
  lib.dropDb(BASE);
  lib.dropDb(CURRENT);
  temp.cleanup();
});

/** 在基准库上开事务、跑一段语句、读系统目录、回滚；基准库不变 */
const catalogAfter = (sql: string): Catalog =>
  lib.parseCatalog(lib.sqlOrThrow(BASE, `begin;\n${sql};\n${lib.CATALOG_SQL}\nrollback;`));

/** 改一处后的差异，按类别给出。setup 是两边都先做的（比如两边都先有同一个视图），差异里不该出现它 */
function problemsAfter(mutation: string, setup?: string): Record<string, string[]> {
  const before = setup ? catalogAfter(setup) : base;
  const mutated = catalogAfter(setup ? `${setup};\n${mutation}` : mutation);
  const problems: Record<string, string[]> = {};
  for (const [id] of lib.CATEGORIES) {
    const found = lib.diffRows(before[id] ?? [], mutated[id] ?? []);
    if (found.length > 0) problems[id] = found;
  }
  return problems;
}

const GONE = "：参照库有，迁移库没有";
const EXTRA = "：迁移库有，参照库没有";

describe("逐项反向试验：改一处，查得出，且指到改的那一处", () => {
  it("基准库就是首版迁移建出来的样子：数量对得上，两次读出来的目录没有差异", () => {
    expect(lib.countsOf(base)).toEqual({
      表: [166, 171],
      "CHECK 约束": [1234, 1284],
      触发器: [121, 126],
      外键: [477, 477],
      排他约束: [1, 1],
      索引: [757, 782],
      部分索引: [168, 183],
    });
    expect(problemsAfter("select 1 where false")).toEqual({});
  });

  // [说明, 改动, 各类别应当报出的差异（逐条全等；写数字的只核对条数）, 两边都先做的（可以不写）]
  const cases: Array<[string, string, Record<string, string[] | number>, string?]> = [
    [
      "删一条 CHECK",
      "ALTER TABLE idempotency_record DROP CONSTRAINT ck_idempotency_record_state",
      { constraints: [`idempotency_record.ck_idempotency_record_state${GONE}`] },
    ],
    [
      "同名的 CHECK 换了表达式",
      "ALTER TABLE biz_sequence DROP CONSTRAINT ck_biz_sequence_next_val, ADD CONSTRAINT ck_biz_sequence_next_val CHECK (next_val >= 0)",
      {
        constraints: [
          'biz_sequence.ck_biz_sequence_next_val 的 definition 不同：参照库 "CHECK ((next_val >= 1))"；迁移库 "CHECK ((next_val >= 0))"',
        ],
      },
    ],
    [
      "CHECK 重建成 NOT VALID",
      "ALTER TABLE biz_sequence DROP CONSTRAINT ck_biz_sequence_next_val, ADD CONSTRAINT ck_biz_sequence_next_val CHECK (next_val >= 1) NOT VALID",
      {
        constraints: [
          'biz_sequence.ck_biz_sequence_next_val 的 definition 不同：参照库 "CHECK ((next_val >= 1))"；迁移库 "CHECK ((next_val >= 1)) NOT VALID"',
          "biz_sequence.ck_biz_sequence_next_val 的 validated 不同：参照库 true；迁移库 false",
        ],
      },
    ],
    [
      "删一条外键",
      "ALTER TABLE outbox_delivery DROP CONSTRAINT fk_outbox_delivery_outbox_event_id",
      { constraints: [`outbox_delivery.fk_outbox_delivery_outbox_event_id${GONE}`] },
    ],
    [
      "外键的删除动作改了：定义不同，它名下执行删除动作的内部触发器也跟着换了",
      "ALTER TABLE outbox_delivery DROP CONSTRAINT fk_outbox_delivery_outbox_event_id, ADD CONSTRAINT fk_outbox_delivery_outbox_event_id FOREIGN KEY (outbox_event_id) REFERENCES outbox_event(id) ON DELETE CASCADE ON UPDATE CASCADE",
      {
        constraints: [
          'outbox_delivery.fk_outbox_delivery_outbox_event_id 的 definition 不同：参照库 "FOREIGN KEY (outbox_event_id) REFERENCES outbox_event(id) ON UPDATE CASCADE ON DELETE RESTRICT"；迁移库 "FOREIGN KEY (outbox_event_id) REFERENCES outbox_event(id) ON UPDATE CASCADE ON DELETE CASCADE"',
          'outbox_delivery.fk_outbox_delivery_outbox_event_id 的 internal_triggers 不同：参照库 ["\\"RI_FKey_cascade_upd\\" O","\\"RI_FKey_check_ins\\" O","\\"RI_FKey_check_upd\\" O","\\"RI_FKey_restrict_del\\" O"]；迁移库 ["\\"RI_FKey_cascade_del\\" O","\\"RI_FKey_cascade_upd\\" O","\\"RI_FKey_check_ins\\" O","\\"RI_FKey_check_upd\\" O"]',
        ],
      },
    ],
    [
      "删排他约束：约束与它的索引都少了",
      "ALTER TABLE subscription_term DROP CONSTRAINT ex_subscription_term_no_overlap",
      {
        constraints: [`subscription_term.ex_subscription_term_no_overlap${GONE}`],
        indexes: [`ex_subscription_term_no_overlap${GONE}`],
      },
    ],
    [
      "删一个索引",
      "DROP INDEX ix_idempotency_record_expires_at",
      { indexes: [`ix_idempotency_record_expires_at${GONE}`] },
    ],
    [
      "唯一索引换成同名的普通索引",
      "DROP INDEX uq_staff_staff_no; CREATE INDEX uq_staff_staff_no ON staff (staff_no)",
      {
        indexes: [
          'uq_staff_staff_no 的 definition 不同：参照库 "CREATE UNIQUE INDEX uq_staff_staff_no ON public.staff USING btree (staff_no)"；迁移库 "CREATE INDEX uq_staff_staff_no ON public.staff USING btree (staff_no)"',
          "uq_staff_staff_no 的 unique 不同：参照库 true；迁移库 false",
        ],
      },
    ],
    [
      "部分索引的条件改了",
      "DROP INDEX uq_checklist_template_active; CREATE UNIQUE INDEX uq_checklist_template_active ON checklist_template (code) WHERE status = 'draft'",
      { indexes: 1 },
    ],
    [
      "删一个触发器",
      "DROP TRIGGER trg_checklist_template_immutable ON checklist_template",
      { triggers: [`checklist_template.trg_checklist_template_immutable${GONE}`] },
    ],
    [
      "停用一个触发器",
      "ALTER TABLE checklist_template DISABLE TRIGGER trg_checklist_template_immutable",
      {
        triggers: [
          'checklist_template.trg_checklist_template_immutable 的 enabled 不同：参照库 "O"；迁移库 "D"',
        ],
      },
    ],
    [
      "触发器的参数少了一个",
      "DROP TRIGGER trg_checklist_template_immutable ON checklist_template; CREATE TRIGGER trg_checklist_template_immutable BEFORE UPDATE ON checklist_template FOR EACH ROW EXECUTE FUNCTION lyx_forbid_column_change('code', 'version_no', 'created_by_staff_id')",
      { triggers: 1 },
    ],
    [
      "改一个函数体",
      "CREATE OR REPLACE FUNCTION lyx_forbid_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END; $$",
      { functions: 1 },
    ],
    [
      "函数体不变，只加一项函数级设置",
      "ALTER FUNCTION lyx_forbid_update() SET search_path = public",
      { functions: 1 },
    ],
    [
      "改一列的类型",
      "ALTER TABLE biz_sequence ALTER COLUMN next_val TYPE bigint",
      { columns: ['biz_sequence.next_val 的 type 不同：参照库 "integer"；迁移库 "bigint"'] },
    ],
    [
      "改一列的可空",
      "ALTER TABLE idempotency_record ALTER COLUMN expires_at DROP NOT NULL",
      { columns: ["idempotency_record.expires_at 的 not_null 不同：参照库 true；迁移库 false"] },
    ],
    [
      "改一列的默认值",
      "ALTER TABLE idempotency_record ALTER COLUMN created_at SET DEFAULT clock_timestamp()",
      {
        columns: [
          'idempotency_record.created_at 的 default 不同：参照库 "CURRENT_TIMESTAMP"；迁移库 "clock_timestamp()"',
        ],
      },
    ],
    [
      "多一列",
      "ALTER TABLE biz_sequence ADD COLUMN extra integer",
      { columns: [`biz_sequence.extra${EXTRA}`] },
    ],
    [
      "多一张表：表、列、主键约束、主键索引各多一项",
      "CREATE TABLE lyx_extra (id uuid PRIMARY KEY)",
      {
        tables: [`lyx_extra${EXTRA}`],
        columns: [`lyx_extra.id${EXTRA}`],
        constraints: [`lyx_extra.lyx_extra_pkey${EXTRA}`],
        indexes: [`lyx_extra_pkey${EXTRA}`],
      },
    ],
    [
      "少一个分区子表：表、列、继承来的约束、索引、触发器都少了",
      "DROP TABLE analytics_event_default",
      {
        tables: [`analytics_event_default${GONE}`],
        columns: 21,
        constraints: 11,
        indexes: 5,
        triggers: 2,
      },
    ],
    [
      "表上开了行级安全",
      "ALTER TABLE biz_sequence ENABLE ROW LEVEL SECURITY",
      { tables: ["biz_sequence 的 row_security 不同：参照库 false；迁移库 true"] },
    ],
    [
      "序列的当前值被重置（迁移里把员工号的起点调到 1001）",
      "ALTER SEQUENCE staff_staff_no_seq RESTART WITH 1",
      { others: ['序列 staff_staff_no_seq 的 state 不同：参照库 "1001 false"；迁移库 "1 false"'] },
    ],
    [
      "序列不再循环",
      "ALTER SEQUENCE audit_no_seq NO CYCLE",
      { others: ["序列 audit_no_seq 的 cycle 不同：参照库 true；迁移库 false"] },
    ],
    [
      "少一个扩展（连带用它的索引与扩展自带的注释）",
      "DROP EXTENSION pg_trgm CASCADE",
      {
        others: [`扩展 pg_trgm${GONE}`, `注释 extension pg_trgm${GONE}`],
        indexes: [`ix_store_asset_search${GONE}`],
      },
    ],
    ["多一个模式", "CREATE SCHEMA lyx_extra", { others: [`模式 lyx_extra${EXTRA}`] }],
    [
      "多一个视图：视图与它的列各多一项",
      "CREATE VIEW lyx_extra AS SELECT prefix FROM biz_sequence",
      { others: [`关系 lyx_extra${EXTRA}`], columns: [`lyx_extra.prefix${EXTRA}`] },
    ],
    // 以下五种对象首版迁移不建：比的是“哪一边都没有多出来的”
    [
      "多一条行级安全策略（表上没开行级安全，表这一类看不出）",
      "CREATE POLICY lyx_extra ON biz_sequence USING (true)",
      { others: [`策略 biz_sequence.lyx_extra${EXTRA}`] },
    ],
    [
      "多一条规则",
      "CREATE RULE lyx_extra AS ON DELETE TO biz_sequence DO INSTEAD NOTHING",
      { others: [`规则 biz_sequence.lyx_extra${EXTRA}`] },
    ],
    [
      "多一个统计对象",
      "CREATE STATISTICS lyx_extra ON prefix, next_val FROM biz_sequence",
      { others: [`统计对象 public.lyx_extra${EXTRA}`] },
    ],
    [
      "多一个事件触发器（连同它的函数）",
      "CREATE FUNCTION lyx_extra() RETURNS event_trigger LANGUAGE plpgsql AS $$ BEGIN END $$; CREATE EVENT TRIGGER lyx_extra ON sql_drop EXECUTE FUNCTION lyx_extra()",
      { functions: [`lyx_extra()${EXTRA}`], others: [`事件触发器 lyx_extra${EXTRA}`] },
    ],
    [
      "多一条注释",
      "COMMENT ON COLUMN biz_sequence.next_val IS '多出来的注释'",
      { others: [`注释 column next_val of table biz_sequence${EXTRA}`] },
    ],
    // 以下十一种是第一轮复审试出来、当时查不出的：改动落在声明要比的类别里，报的却是 0 差异
    [
      "视图上多一个 INSTEAD OF 触发器（视图两边都有）",
      "CREATE TRIGGER lyx_extra_trg INSTEAD OF INSERT ON lyx_extra FOR EACH ROW EXECUTE FUNCTION lyx_forbid_mutation()",
      { triggers: [`lyx_extra.lyx_extra_trg${EXTRA}`] },
      "CREATE VIEW lyx_extra AS SELECT prefix FROM biz_sequence",
    ],
    [
      "停用一条外键的内部触发器：外键的定义没变，但插入时不再校验",
      `DO $$ DECLARE trg text; BEGIN
         SELECT t.tgname INTO STRICT trg FROM pg_trigger t JOIN pg_constraint k ON k.oid = t.tgconstraint
          WHERE k.conname = 'fk_outbox_delivery_outbox_event_id' AND t.tgfoid = '"RI_FKey_check_ins"'::regproc;
         EXECUTE format('ALTER TABLE outbox_delivery DISABLE TRIGGER %I', trg);
       END $$`,
      {
        constraints: [
          'outbox_delivery.fk_outbox_delivery_outbox_event_id 的 internal_triggers 不同：参照库 ["\\"RI_FKey_cascade_upd\\" O","\\"RI_FKey_check_ins\\" O","\\"RI_FKey_check_upd\\" O","\\"RI_FKey_restrict_del\\" O"]；迁移库 ["\\"RI_FKey_cascade_upd\\" O","\\"RI_FKey_check_ins\\" D","\\"RI_FKey_check_upd\\" O","\\"RI_FKey_restrict_del\\" O"]',
        ],
      },
    ],
    [
      "物化视图上多一个索引（物化视图两边都有）",
      "CREATE INDEX lyx_extra_ix ON lyx_extra (prefix)",
      { indexes: [`lyx_extra_ix${EXTRA}`] },
      "CREATE MATERIALIZED VIEW lyx_extra AS SELECT prefix FROM biz_sequence",
    ],
    [
      "外部表多一列（外部表两边都有）",
      "ALTER FOREIGN TABLE lyx_extra ADD COLUMN b text",
      { columns: [`lyx_extra.b${EXTRA}`] },
      "CREATE FOREIGN DATA WRAPPER lyx_extra; CREATE SERVER lyx_extra FOREIGN DATA WRAPPER lyx_extra; CREATE FOREIGN TABLE lyx_extra (a integer) SERVER lyx_extra",
    ],
    [
      "列的压缩方式改了",
      "ALTER TABLE biz_sequence ALTER COLUMN prefix SET COMPRESSION pglz",
      { columns: ['biz_sequence.prefix 的 compression 不同：参照库 ""；迁移库 "p"'] },
    ],
    [
      "列上多一个选项 n_distinct",
      "ALTER TABLE biz_sequence ALTER COLUMN prefix SET (n_distinct = 5)",
      { columns: ['biz_sequence.prefix 的 options 不同：参照库 null；迁移库 ["n_distinct=5"]'] },
    ],
    [
      "域上多一条 CHECK（域两边都有）",
      "ALTER DOMAIN lyx_extra ADD CONSTRAINT lyx_extra_positive CHECK (VALUE > 0)",
      {
        others: [
          '类型 lyx_extra 的 checks 不同：参照库 null；迁移库 ["lyx_extra_positive CHECK ((VALUE > 0))"]',
        ],
      },
      "CREATE DOMAIN lyx_extra AS integer",
    ],
    [
      "同名同参的聚合，定义不同（聚合两边都有）",
      "DROP AGGREGATE lyx_extra(integer); CREATE AGGREGATE lyx_extra(integer) (SFUNC = int4mul, STYPE = integer)",
      { functions: 1 },
      "CREATE AGGREGATE lyx_extra(integer) (SFUNC = int4pl, STYPE = integer)",
    ],
    [
      "多一个独立的复合类型：类型与它的两个属性各多一项",
      "CREATE TYPE lyx_extra AS (a integer, b text)",
      {
        others: [`类型 lyx_extra${EXTRA}`],
        columns: [`lyx_extra.a${EXTRA}`, `lyx_extra.b${EXTRA}`],
      },
    ],
    [
      "序列改成 UNLOGGED",
      "ALTER SEQUENCE audit_no_seq SET UNLOGGED",
      { others: ['序列 audit_no_seq 的 persistence 不同：参照库 "p"；迁移库 "u"'] },
    ],
    [
      "表的 TOAST 选项",
      "ALTER TABLE biz_sequence SET (toast.autovacuum_enabled = false)",
      {
        tables: [
          'biz_sequence 的 toast_options 不同：参照库 null；迁移库 ["autovacuum_enabled=false"]',
        ],
      },
    ],
  ];

  it.each(cases)("%s", (_label, mutation, expected, setup) => {
    const found = problemsAfter(mutation, setup);
    expect(Object.keys(found).sort()).toEqual(Object.keys(expected).sort());
    for (const [id, want] of Object.entries(expected)) {
      if (typeof want === "number") expect(found[id]).toHaveLength(want);
      else expect(found[id]).toEqual(want);
    }
  });

  it("_prisma_migrations 不计：迁移库多出它，没有差异", () => {
    const table =
      "CREATE TABLE _prisma_migrations (id varchar(36) PRIMARY KEY, checksum varchar(64) NOT NULL)";
    expect(problemsAfter(table)).toEqual({});
  });
});

describe("命令行", () => {
  const report = join(temp.dir, "report.md");
  const diff = (...args: string[]) => run("node", [SCRIPT, ...args, "--report", report], repoRoot);

  it("两个库相同（迁移库多一张 _prisma_migrations）：退出码 0，报告写出来，七类都是 0 差异", () => {
    lib.recreateDb(COPY, { template: CURRENT });
    lib.sqlOrThrow(COPY, "CREATE TABLE _prisma_migrations (id varchar(36) PRIMARY KEY)");
    const result = diff("--ref", CURRENT, "--target", COPY);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    const text = readFileSync(report, "utf8");
    expect(result.stdout).toContain(text);
    expect(text).toContain(
      "结论：通过：首版冻结等价，现行系统目录 0 差异、快照与 schema 一致，数量对得上",
    );
    expect(text).toContain("首版冻结等价证明");
    expect(text).toContain("现行快照与 schema");
    expect(
      text.match(/^\| .+ \| \d+ \| \d+ \| 0 \| `[0-9a-f]{16}` \| `[0-9a-f]{16}` \|$/gm),
    ).toHaveLength(7);
    // 首版证明继续使用冻结数量；本节 CURRENT 跑了全部迁移，必须对照现行官方快照。
    const [logical, all] = currentCheckCounts;
    const currentSection = text.split("## 3. 数量两组口径\n")[1]?.split("## 4. ")[0];
    expect(currentSection).toContain(
      `| CHECK 约束 | ${logical} / ${all} | ${logical} / ${all} | ${logical} / ${all} |`,
    );
  });

  it("迁移库上删一条 CHECK：退出码 1，指出是哪一条，数量也对不上", () => {
    lib.recreateDb(COPY, { template: CURRENT });
    lib.sqlOrThrow(
      COPY,
      "ALTER TABLE idempotency_record DROP CONSTRAINT ck_idempotency_record_state",
    );
    const result = diff("--ref", CURRENT, "--target", COPY);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "系统目录比对未通过。2. 系统目录逐项比对（`_prisma_migrations` 不计）：1 处；3. 数量两组口径：1 处",
    );
    const text = readFileSync(report, "utf8");
    expect(text).toContain(`- 【约束定义】idempotency_record.ck_idempotency_record_state${GONE}`);
    const [logical, all] = currentCheckCounts;
    expect(text).toContain(
      `- 迁移库的CHECK 约束是 ${logical - 1} / ${all - 1}，应为 ${logical} / ${all}`,
    );
  });

  it("库名不是 lyx_ 开头、库不存在、参数写错：退出码 2，不写报告", () => {
    const missing = join(temp.dir, "missing.md");
    const at = (...args: string[]) => run("node", [SCRIPT, ...args, "--report", missing], repoRoot);
    const wrongName = at("--ref", CURRENT, "--target", "liyoxi");
    expect(wrongName.status).toBe(2);
    expect(wrongName.stderr).toContain("liyoxi 不是 lyx_ 开头的校验库");
    const noSuchDb = at("--ref", CURRENT, "--target", `${BASE}_none`);
    expect(noSuchDb.status).toBe(2);
    expect(noSuchDb.stderr).toContain("读不到系统目录");
    expect(run("node", [SCRIPT, "--verbose", "1"], repoRoot).status).toBe(2);
    expect(existsSync(missing)).toBe(false);
  });

  it("现行 schema 改了模型一行：实际库→schema拒绝；文件头与 generator 修改不造成DDL", () => {
    // 脚本按自己的位置找两份 schema：拷一份最小的目录树出去改，不动仓库里的文件
    const tree = join(temp.dir, "tree");
    const moved = join(tree, "packages/db/prisma/schema.prisma");
    for (const path of [
      "infra/ci/db-lib.mjs",
      "infra/ci/db-structure-lib.mjs",
      "infra/ci/db-post-init-lib.mjs",
      SCRIPT,
      "docs/data-model/schema.prisma",
      "docs/data-model/constraints",
      "packages/db/prisma.config.ts",
      "packages/db/prisma/migrations/20261005000000_init/migration.sql",
      "packages/db/snapshot/structure.txt",
    ]) {
      mkdirSync(join(tree, path, ".."), { recursive: true });
      cpSync(join(repoRoot, path), join(tree, path), { recursive: true });
    }
    symlinkSync(
      join(repoRoot, "packages/db/node_modules"),
      join(tree, "packages/db/node_modules"),
      "dir",
    );
    const original = readFileSync(join(repoRoot, "packages/db/prisma/schema.prisma"), "utf8");
    const check = (text: string) => {
      cpSync(join(repoRoot, "docs/data-model/schema.prisma"), moved);
      writeFileSync(moved, text);
      return run("node", [SCRIPT, "--ref", CURRENT, "--target", CURRENT, "--report", report], tree);
    };

    const headOnly = original
      .replace(/^\/\/ .*\n/, "// 换了一行文件头注释\n")
      .replace('output   = "../dist/generated"', 'output   = "../somewhere/else"');
    expect(headOnly).not.toBe(original);
    expect(check(headOnly).status).toBe(0);

    const edited = original.replace("  nextVal   Int ", "  nextVal   BigInt ");
    expect(edited).not.toBe(original);
    const result = check(edited);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("4. 现行快照与 schema");
    expect(result.stdout).toContain('ALTER TABLE "biz_sequence" ALTER COLUMN "next_val"');
    expect(result.stdout).toContain("BIGINT");
  });
});
