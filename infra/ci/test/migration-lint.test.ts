import { readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { git, makeTempRepo, repoRoot, run, writeFiles } from "./helpers.js";

// 迁移规范检查的用例（W0-06b；D7 第 8.3 节第 5 条）。不连库：在仓库外的临时 git 仓库里造迁移，跑脚本本身。
// 每一例：先提交一个“已经合并的”迁移当基线，再在工作区里加新迁移或动旧迁移，拿基线那个提交当 --base。

const SCRIPT = join(repoRoot, "infra/ci/migration-lint.mjs");
const MIGRATIONS = "packages/db/prisma/migrations";
const SCHEMA = "packages/db/prisma/schema.prisma";
const MERGED = `${MIGRATIONS}/20260101000000_init/migration.sql`;
const NEXT = `${MIGRATIONS}/20260201000000_next/migration.sql`;
const MARK = "-- lyx:allow 用例里的理由";

/** 基线：两张表。order_item.kind 上有一条 CHECK，order_item.qty 带默认值，order_item.note 不带 */
const BASE_SQL = `-- 基线迁移
CREATE TABLE "order_head" (
    "id" UUID NOT NULL,
    "status" TEXT NOT NULL,
    CONSTRAINT "pk_order_head" PRIMARY KEY ("id")
);
CREATE TABLE "order_item" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "qty" INTEGER DEFAULT 1,
    "note" TEXT,
    "legacy_code" TEXT,
    CONSTRAINT "pk_order_item" PRIMARY KEY ("id")
);
ALTER TABLE order_item ADD CONSTRAINT ck_order_item_kind
  CHECK (kind IN ('a', 'b'));
ALTER TABLE order_item ADD CONSTRAINT fk_order_item_order_id
  FOREIGN KEY (order_id) REFERENCES order_head(id);
`;

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

/** 建临时仓库并提交基线；之后在工作区里写 changes（值为 null 表示删掉），跑检查 */
function lint(
  changes: Record<string, string | null>,
  {
    base = { [MERGED]: BASE_SQL },
    prepare,
  }: { base?: Record<string, string>; prepare?: (dir: string) => void } = {},
) {
  const temp = makeTempRepo("lyx-migration-lint-", base);
  cleanups.push(temp.cleanup);
  git(temp.dir, "commit", "-q", "-m", "base");
  prepare?.(temp.dir);
  for (const [path, content] of Object.entries(changes)) {
    if (content === null) rmSync(join(temp.dir, path));
    else writeFiles(temp.dir, { [path]: content });
  }
  return run("node", [SCRIPT, "--root", temp.dir, "--base", "HEAD"], temp.dir);
}

const PASS = "结论：通过。四类语句都带了理由，已经合并的迁移没有被改。";
const missing = (line: number, kinds: string) =>
  `- ${NEXT} 第 ${line} 行：${kinds} 没有带 “-- lyx:allow <理由>”：`;

describe("现有的迁移", () => {
  it("本仓库的迁移通过", () => {
    const result = run("node", [SCRIPT, "--base", "HEAD"], repoRoot);
    expect(result.output).toContain(PASS);
    expect(result.status).toBe(0);
  });

  it("把迁移里的标记都拿掉：每一处都报出来（带标记的语句确实是被认出来之后才通过的）", () => {
    const names = readdirSync(join(repoRoot, MIGRATIONS), { withFileTypes: true })
      .flatMap((entry) => (entry.isDirectory() ? [entry.name] : []))
      .sort();
    const files: Record<string, string> = {};
    let marks = 0;
    for (const name of names) {
      const lines = readFileSync(join(repoRoot, MIGRATIONS, name, "migration.sql"), "utf8").split(
        "\n",
      );
      const kept = lines.filter((line) => !/^--\s*lyx:allow\s/.test(line));
      marks += lines.length - kept.length;
      files[`${MIGRATIONS}/${name}/migration.sql`] = kept.join("\n");
    }
    expect(marks).toBeGreaterThan(0);
    const result = lint({}, { base: files });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`迁移规范检查未通过：${marks} 处。`);
  });
});

describe("四类语句要带理由", () => {
  const unmarked: Array<[string, string, string]> = [
    ["DROP TABLE", "DROP TABLE order_item;", "DROP"],
    [
      "DROP COLUMN（没有发布标签时一律要标记）",
      'ALTER TABLE "order_item" DROP COLUMN "legacy_code";',
      "DROP",
    ],
    ["DROP INDEX", 'DROP INDEX "ix_whatever";', "DROP"],
    ["RENAME COLUMN", "ALTER TABLE order_item RENAME COLUMN note TO remark;", "RENAME"],
    ["RENAME TO", "ALTER TABLE order_item RENAME TO order_line;", "RENAME"],
    ["ALTER COLUMN … TYPE", "ALTER TABLE order_item ALTER COLUMN qty TYPE bigint;", "ALTER … TYPE"],
    [
      "SET DATA TYPE，不写 COLUMN",
      "ALTER TABLE order_item ALTER qty SET DATA TYPE bigint;",
      "ALTER … TYPE",
    ],
    [
      "不带默认值的 SET NOT NULL",
      "ALTER TABLE order_item ALTER COLUMN note SET NOT NULL;",
      "不带默认值的 SET NOT NULL（note）",
    ],
    [
      "一条语句里两类",
      "ALTER TABLE order_item DROP COLUMN legacy_code, ALTER COLUMN qty TYPE bigint;",
      "DROP、ALTER … TYPE",
    ],
    ["DO 块里的 DROP（块体当场执行）", "DO $$ BEGIN DROP TABLE order_item; END $$;", "DROP"],
  ];

  // 一个迁移里把十种写法都放进去（检查只读文本、不执行，语句之间互不相干）：省得每种各建一个仓库
  it("十种写法都不带标记：逐条报出来，指到行号与类别", () => {
    const result = lint({ [NEXT]: `${unmarked.map(([, sql]) => sql).join("\n")}\n` });
    unmarked.forEach(([, sql, kinds], index) => {
      expect(result.stderr).toContain(`${missing(index + 1, kinds)}${sql}`);
    });
    expect(result.stderr).toContain(`迁移规范检查未通过：${unmarked.length} 处。`);
    expect(result.status).toBe(1);
  });

  it("十种写法都带了标记：通过，并逐条列在“带 lyx:allow 的语句”里", () => {
    const result = lint({ [NEXT]: `${unmarked.map(([, sql]) => `${MARK}\n${sql}`).join("\n")}\n` });
    expect(result.output).toContain(PASS);
    expect(result.stdout).toContain(`新迁移里带 lyx:allow 的语句 ${unmarked.length} 处`);
    unmarked.forEach(([, sql], index) => {
      expect(result.stdout).toContain(
        `- ${NEXT} 第 ${index * 2 + 2} 行：${sql}（lyx:allow 用例里的理由）`,
      );
    });
    expect(result.status).toBe(0);
  });

  it("标记写在语句中间的一行也算；标记不写理由、写在语句后面、隔了一条语句都不算", () => {
    const inside =
      "ALTER TABLE order_item\n  -- lyx:allow 用例里的理由\n  DROP COLUMN legacy_code;\n";
    expect(lint({ [NEXT]: inside }).status).toBe(0);
    const bad = [
      "-- lyx:allow\nDROP TABLE order_item;\n",
      "DROP TABLE order_item; -- lyx:allow 写在后面\n",
      `${MARK}\nCREATE INDEX ix_a ON order_item (kind);\nDROP TABLE order_item;\n`,
      `/* lyx:allow 块注释不认 */\nDROP TABLE order_item;\n`,
    ];
    for (const sql of bad) {
      const result = lint({ [NEXT]: sql });
      expect(result.stderr).toContain("DROP 没有带 “-- lyx:allow <理由>”");
      expect(result.status).toBe(1);
    }
  });

  it("不是四类的不用标记；字符串、注释、函数体里的字不当关键字", () => {
    const sql = [
      'CREATE TABLE "drop_log" ("id" UUID NOT NULL, "rename_count" INTEGER NOT NULL DEFAULT 0, "type" TEXT NOT NULL);',
      "-- 这里不 DROP 也不 RENAME",
      "COMMENT ON TABLE drop_log IS 'drop; rename; alter column x type y';",
      'CREATE INDEX "ix_drop_log_type" ON "drop_log"("type");',
      'ALTER TABLE "drop_log" ALTER COLUMN "type" SET DEFAULT \'x\';',
      "CREATE FUNCTION lyx_probe() RETURNS trigger LANGUAGE plpgsql AS $fn$",
      "BEGIN EXECUTE 'DROP TABLE nothing'; ALTER TABLE x RENAME TO y; RETURN NEW; END;",
      "$fn$;",
      "ALTER TABLE order_item ADD COLUMN extra TEXT;",
      "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO lyx_readonly;",
    ].join("\n");
    const result = lint({ [NEXT]: sql });
    expect(result.output).toContain(PASS);
    expect(result.status).toBe(0);
  });
});

describe("不带默认值的 SET NOT NULL：默认值按迁移的文本推", () => {
  const setNotNull = (column: string) =>
    `ALTER TABLE order_item ALTER COLUMN ${column} SET NOT NULL;\n`;
  const BARE = "不带默认值的 SET NOT NULL";

  it("建表时带 DEFAULT 的列、同一个迁移里先 SET DEFAULT 的列、加列时带 DEFAULT 的列：不用标记", () => {
    expect(lint({ [NEXT]: setNotNull("qty") }).status).toBe(0);
    const sql = `ALTER TABLE order_item ALTER COLUMN note SET DEFAULT '';\n${setNotNull("note")}`;
    expect(lint({ [NEXT]: sql }).status).toBe(0);
    const add = `ALTER TABLE order_item ADD COLUMN flag BOOLEAN DEFAULT false;\n${setNotNull("flag")}`;
    expect(lint({ [NEXT]: add }).status).toBe(0);
  });

  it("默认值是前一个迁移里给的：也算", () => {
    const earlier = `${MIGRATIONS}/20260115000000_default/migration.sql`;
    const base = {
      [MERGED]: BASE_SQL,
      [earlier]: "ALTER TABLE order_item ALTER COLUMN note SET DEFAULT '';\n",
    };
    expect(lint({ [NEXT]: setNotNull("note") }, { base }).status).toBe(0);
  });

  it("没有默认值、默认值被拿掉了、同名列在另一张表上有默认值：要标记", () => {
    expect(lint({ [NEXT]: setNotNull("note") }).stderr).toContain(`${BARE}（note）`);
    const dropped = `${MARK}\nALTER TABLE order_item ALTER COLUMN qty DROP DEFAULT;\n${setNotNull("qty")}`;
    expect(lint({ [NEXT]: dropped }).stderr).toContain(`${missing(3, `${BARE}（qty）`)}`);
    const other = `ALTER TABLE order_head ADD COLUMN note TEXT DEFAULT '';\n${setNotNull("note")}`;
    expect(lint({ [NEXT]: other }).stderr).toContain(`${BARE}（note）`);
  });

  it("表改了名、照着旧表建新表（LIKE … INCLUDING DEFAULTS）：默认值跟着走", () => {
    const sql = [
      MARK,
      "ALTER TABLE order_item RENAME TO order_item_plain;",
      "CREATE TABLE order_item (LIKE order_item_plain INCLUDING DEFAULTS INCLUDING CONSTRAINTS);",
      "ALTER TABLE order_item ALTER COLUMN qty SET NOT NULL;",
      "ALTER TABLE order_item_plain ALTER COLUMN qty SET NOT NULL;",
    ].join("\n");
    expect(lint({ [NEXT]: sql }).status).toBe(0);
  });
});

describe("成对的 CHECK 替换不用标记", () => {
  const ADD =
    "ALTER TABLE order_item ADD CONSTRAINT ck_order_item_kind_v2 CHECK (kind IN ('a', 'b', 'c')) NOT VALID;";
  const VALIDATE = "ALTER TABLE order_item VALIDATE CONSTRAINT ck_order_item_kind_v2;";
  const DROP = "ALTER TABLE order_item DROP CONSTRAINT ck_order_item_kind;";
  const unmarkedDrop = (line: number) => `${missing(line, "DROP")}`;

  it("同一个迁移里：加（NOT VALID）→ 校验 → 删旧的，三句同一张表：通过", () => {
    const result = lint({ [NEXT]: [ADD, VALIDATE, DROP].join("\n") });
    expect(result.output).toContain(PASS);
    expect(result.stdout).not.toContain("带 lyx:allow 的语句");
    expect(result.status).toBe(0);
  });

  const broken: Array<[string, string[], number]> = [
    ["先删后加", [DROP, ADD, VALIDATE], 1],
    ["加了没校验", [ADD, DROP], 2],
    [
      "加的时候不是 NOT VALID（会全表扫描并全程持锁）",
      [ADD.replace(" NOT VALID", ""), VALIDATE, DROP],
      3,
    ],
    [
      "删的不是 CHECK（外键）",
      [ADD, VALIDATE, DROP.replace("ck_order_item_kind", "fk_order_item_order_id")],
      3,
    ],
    [
      "加在另一张表上",
      [
        ADD.replace("order_item ADD", "order_head ADD"),
        VALIDATE.replace("order_item", "order_head"),
        DROP,
      ],
      3,
    ],
    [
      "一对“加 + 校验”后面删两条",
      [ADD, VALIDATE, DROP, DROP.replace("ck_order_item_kind", "ck_order_item_kind_v2")],
      4,
    ],
  ];

  it.each(broken)("%s：那句 DROP 要标记", (_label, statements, line) => {
    const result = lint({ [NEXT]: statements.join("\n") });
    expect(result.stderr).toContain(unmarkedDrop(line));
    expect(result.status).toBe(1);
  });
});

describe("删的列在上一个发布标签的 schema 里已标 @ignore", () => {
  const schema = (ignore: string) =>
    `model OrderItem {\n  id String @id @db.Uuid\n  /// 旧编码\n  legacyCode String? @map("legacy_code")${ignore}\n  note String?\n\n  @@map("order_item")\n}\n`;
  const DROP_COLUMN = "ALTER TABLE order_item DROP COLUMN legacy_code;\n";
  const tagged = (ignore: string, tag = "v1.0.0") => ({
    base: { [MERGED]: BASE_SQL, [SCHEMA]: schema(ignore) },
    prepare: (dir: string) => void git(dir, "tag", tag),
  });

  it("标了：不用标记", () => {
    const result = lint({ [NEXT]: DROP_COLUMN }, tagged(" @ignore"));
    expect(result.output).toContain(PASS);
    expect(result.output).not.toContain("这一条不生效");
    expect(result.status).toBe(0);
  });

  it("没标、标的是别的列、带 CASCADE、标签不是 v 开头、还没有标签：要标记", () => {
    expect(lint({ [NEXT]: DROP_COLUMN }, tagged("")).status).toBe(1);
    expect(
      lint({ [NEXT]: "ALTER TABLE order_item DROP COLUMN note;\n" }, tagged(" @ignore")).status,
    ).toBe(1);
    expect(lint({ [NEXT]: DROP_COLUMN.replace(";", " CASCADE;") }, tagged(" @ignore")).status).toBe(
      1,
    );
    expect(lint({ [NEXT]: DROP_COLUMN }, tagged(" @ignore", "pre-rebase-1")).status).toBe(1);
    const untagged = lint(
      { [NEXT]: DROP_COLUMN },
      { base: { [MERGED]: BASE_SQL, [SCHEMA]: schema(" @ignore") } },
    );
    expect(untagged.stdout).toContain("仓库还没有 v 开头的发布标签");
    expect(untagged.status).toBe(1);
  });
});

describe("已经合并的迁移不能改", () => {
  const FINE = "CREATE INDEX ix_order_item_kind ON order_item (kind);\n";

  it("只加新迁移：通过，数出新增了几个", () => {
    const result = lint({ [NEXT]: FINE });
    expect(result.stdout).toContain("2 个迁移（相对 HEAD 新增 1 个）");
    expect(result.status).toBe(0);
  });

  const touched: Array<[string, Record<string, string | null>, string]> = [
    [
      "改一个字",
      { [MERGED]: `${BASE_SQL}-- 补一句注释\n` },
      `${MERGED}：已经合并的迁移不能改，这个文件被改了`,
    ],
    ["删掉", { [MERGED]: null }, `${MERGED}：已经合并的迁移不能改，这个文件被删了`],
    [
      "往它的目录里加文件",
      { [`${MIGRATIONS}/20260101000000_init/extra.sql`]: FINE },
      `${MIGRATIONS}/20260101000000_init/extra.sql：已经合并的迁移不能改，这个文件多了文件`,
    ],
  ];

  it.each(touched)("已合并的迁移被%s：不通过", (_label, changes, problem) => {
    const result = lint(changes);
    expect(result.stderr).toContain(`- ${problem}`);
    expect(result.status).toBe(1);
  });

  it("新迁移排在已有的前面、目录名不合写法、目录里不止一个文件：不通过", () => {
    const early = `${MIGRATIONS}/20251231000000_early`;
    expect(lint({ [`${early}/migration.sql`]: FINE }).stderr).toContain(
      `- ${early}：新迁移要排在已有的全部之后（最后一个已合并的是 20260101000000_init）`,
    );
    const named = `${MIGRATIONS}/20260201_Next`;
    expect(lint({ [`${named}/migration.sql`]: FINE }).stderr).toContain(
      `- ${named}：目录名要写成 <14 位时间戳>_<小写字母、数字、下划线>`,
    );
    const crowded = lint({ [NEXT]: FINE, [`${MIGRATIONS}/20260201000000_next/down.sql`]: FINE });
    expect(crowded.stderr).toContain(
      "里面应当只有一个 migration.sql，现在是 down.sql、migration.sql",
    );
    expect(crowded.status).toBe(1);
  });

  it("--base 认不出、参数写错：退出码 2，不当成通过", () => {
    const temp = makeTempRepo("lyx-migration-lint-", { [MERGED]: BASE_SQL });
    cleanups.push(temp.cleanup);
    git(temp.dir, "commit", "-q", "-m", "base");
    const unknown = run("node", [SCRIPT, "--root", temp.dir, "--base", "origin/nowhere"], temp.dir);
    expect(unknown.stderr).toContain("--base origin/nowhere 认不出");
    expect(unknown.status).toBe(2);
    expect(run("node", [SCRIPT, "--root", temp.dir, "--base", ""], temp.dir).status).toBe(2);
    expect(run("node", [SCRIPT, "--nope", "x"], temp.dir).status).toBe(2);
  });
});
