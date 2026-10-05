import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { repoRoot } from "./helpers.js";

// 角色与授权核对脚本的用例（W0-06a 任务书 第 7 节第 10 条）：在本地那套 PostgreSQL 上演练。
// 先 pnpm infra:up 并给出 DATABASE_URL（CLAUDE.md 第 9 节）；连不上即失败，不跳过。
// 只建、删自己的两个库 lyx_test_infra_grants_<进程号> 与 …_bare。角色、成员关系是整个实例共用的：
// 这里不建角色、不改角色的属性、不加成员（在共用的实例上动这些，同时在跑的别的核对会误报）；
// 成员那几条规则拿改过的目录文档来验（最后一组），别的角色借系统自带的 pg_monitor 来试。
// 本文件不写死“多少张表、多少个序列”，也不点名哪张表现在是什么权限：期望取 packages/db/src/grants.expected.json
//（脚本读的同一份），要动手脚的表按权限集合从期望里现挑，“动完之后实际是什么”由期望算出来；列、序列、分区子表现查系统目录。
// 以后加表、加序列、加函数、改一张表的授权的包都不用改这里；“恰好是多少”由 packages/db/src/grants.test.ts 管。
// 例外只有 file_object：核对脚本自己点名它不给删除，这里跟着点名。

interface DbLib {
  recreateDb(name: string): void;
  dropDb(name: string): void;
  sqlOrThrow(db: string, sql: string): string;
}
interface Member {
  role: string;
  name: string;
  super: boolean;
  admin: boolean;
  uses: boolean;
  connect: boolean;
  create: boolean;
  others: string[];
}
interface Catalog {
  me: { name: string };
  members: Member[];
  tables: Array<{ name: string; owner: string; logical: boolean }>;
  [key: string]: unknown;
}
interface Rules {
  CATALOG_SQL: string;
  MIN_VERSION_NUM: number;
  judge(
    catalog: Catalog,
    expected: unknown,
  ): { notes: string[]; problems: string[]; review: string[] };
  versionProblem(versionNum: number | string, versionText: string): string | null;
}
const load = async <T>(file: string): Promise<T> =>
  (await import(pathToFileURL(join(repoRoot, "infra/ci", file)).href)) as T;
const lib = await load<DbLib>("db-lib.mjs");
const rules = await load<Rules>("db-grants-rules.mjs");

// 全仓用例并行跑时库很忙，建库、删库可能要十几秒：缺省的 5 秒（用例）与 10 秒（钩子）不够
vi.setConfig({ testTimeout: 180_000, hookTimeout: 120_000 });

const base = process.env.DATABASE_URL;
if (!base)
  throw new Error("DATABASE_URL 未设置：这份用例要连本地的 PostgreSQL（CLAUDE.md 第 9 节）");
const DB = `lyx_test_infra_grants_${process.pid}`;
const BARE = `${DB}_bare`;
const urlOf = (db: string) => Object.assign(new URL(base), { pathname: `/${db}` }).toString();
const { hostname, port, username, password } = new URL(base);

/** 期望的授权：核对脚本读的同一份 */
const expected = JSON.parse(
  readFileSync(join(repoRoot, "packages/db/src/grants.expected.json"), "utf8"),
) as {
  tables: Record<string, string>;
  appendOnly: string[];
  columnUpdate: Record<string, string[]>;
  definerFunctions: Record<string, string[]>;
};

// ===== 要动手脚的对象：从期望里按权限集合现挑，别的现查系统目录 =====

const FULL = "DELETE,INSERT,SELECT,UPDATE";
const privilegesOf = (table: string): string[] => (expected.tables[table] ?? "").split(",");
const plus = (set: string, ...more: string[]): string =>
  [...new Set([...set.split(","), ...more])].sort().join(",");
const minus = (set: string, privilege: string): string =>
  set
    .split(",")
    .filter((item) => item !== privilege)
    .join(",") || "无";
function need<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`期望数据里找不到${what}：这份用例要它来动手脚`);
  return value;
}
// 不挑带例外列的表：收回表级的 UPDATE 会把列级的 UPDATE 一并收回，还原时补不回来
const tableNames = Object.keys(expected.tables).filter(
  (table) => !Object.hasOwn(expected.columnUpdate, table),
);
/** 期望里出现过的权限集合，各取第一张表 */
const firstOfEachSet = [...new Set(tableNames.map((table) => expected.tables[table] ?? ""))].map(
  (set) =>
    [
      set,
      need(
        tableNames.find((table) => expected.tables[table] === set),
        set,
      ),
    ] as const,
);
/** 一张常规读写的表、一张只增表、两张不给删除的表、一张受限而不是只增的表（可能没有） */
const regular = need(
  tableNames.find((table) => expected.tables[table] === FULL),
  "常规读写的表",
);
const appendOnly = need(
  expected.appendOnly.find((table) => tableNames.includes(table)),
  "只增表",
);
const noDelete = tableNames.filter((table) => !privilegesOf(table).includes("DELETE")).sort();
const restrictedOther = tableNames.find(
  (table) => expected.tables[table] !== FULL && !expected.appendOnly.includes(table),
);
const [columnTable, columnList] = need(Object.entries(expected.columnUpdate)[0], "例外列");
const exceptionColumn = need(columnList[0], "例外列");

const one = (db: string, sql: string): string =>
  need(lib.sqlOrThrow(db, sql).trim().split("\n")[0] || undefined, `查询结果（${sql}）`);
/** 现查系统目录：public 里某一类对象有多少个 */
const countOf = (where: string): number =>
  Number(
    one(
      DB,
      `select count(*) from pg_class where relnamespace = 'public'::regnamespace and ${where}`,
    ),
  );
/** 某张表里第一个不在给定名单里的列 */
const columnOf = (table: string, not: string[] = []): string =>
  one(
    DB,
    `select attname from pg_attribute where attrelid = '${table}'::regclass and attnum > 0 and not attisdropped
        and attname not in ('${["", ...not].join("', '")}') order by attnum limit 1`,
  );

function verify(databaseUrl: string | undefined, args: string[] = []) {
  const { DATABASE_URL: _dropped, PGHOST: _host, ...rest } = process.env;
  const env = databaseUrl === undefined ? rest : { ...rest, DATABASE_URL: databaseUrl };
  const result = spawnSync("node", ["infra/ci/db-verify-grants.mjs", ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** 动一处手脚，核对要失败并报出这一句；再还原 */
function tampered(change: string, revert: string, message: string | RegExp): void {
  lib.sqlOrThrow(DB, change);
  try {
    const result = verify(urlOf(DB));
    expect(result.stdout).toMatch(message);
    expect(result.stdout).toContain("结论：不通过。");
    expect(result.status).toBe(1);
  } finally {
    lib.sqlOrThrow(DB, revert);
  }
}
const off = (table: string, actual: string) =>
  `lyx_app 的表级权限与期望不符：${table}（实际 ${actual}，期望 ${expected.tables[table]}）`;

/** 库里的对象名与服务器版本：beforeAll 里迁移跑完之后现查 */
let child = "";
let sequence = "";
let me = "";
let versionNum = 0;

beforeAll(() => {
  lib.recreateDb(DB);
  const deploy = spawnSync("pnpm", ["--filter", "@liyoxi/db", "migrate:deploy"], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: urlOf(DB) },
  });
  if (deploy.status !== 0) throw new Error(`迁移没跑通：${deploy.stdout}${deploy.stderr}`);
  const inPublic = "relnamespace = 'public'::regnamespace";
  child = one(
    DB,
    `select relname from pg_class where ${inPublic} and relispartition and relkind = 'r' order by 1 limit 1`,
  );
  sequence = one(
    DB,
    `select relname from pg_class where ${inPublic} and relkind = 'S' order by 1 limit 1`,
  );
  me = one(DB, "select current_user");
  versionNum = Number(one(DB, "show server_version_num"));
});

afterAll(() => {
  lib.dropDb(DB);
  lib.dropDb(BARE);
});

describe("db-verify-grants.mjs", () => {
  it("没给 DATABASE_URL、库名不是 lyx_ 开头、参数不对：退出码 2", () => {
    const missing = verify(undefined);
    expect(missing.status).toBe(2);
    expect(missing.stderr).toContain("角色与授权核对：没有连接参数");
    const wrongName = verify(base);
    expect(wrongName.status).toBe(2);
    expect(wrongName.stderr).toContain("DATABASE_URL 指的库名要以 lyx_ 开头");
    expect(wrongName.stderr).toContain("--database <库名>");
    for (const args of [["--database"], ["--force"], ["--database", DB, "more"], [DB]]) {
      const bad = verify(urlOf(DB), args);
      expect(bad.status, args.join(" ")).toBe(2);
      expect(bad.stderr).toContain("不认识的参数");
    }
    const odd = verify(urlOf(DB), ["--database", "host=elsewhere dbname=x"]);
    expect(odd.status).toBe(2);
    expect(odd.stderr).toContain("库名只认字母、数字、下划线、连字符");
  });

  it("--database：写出的库名与连上的逐字相同才往下跑；不以 lyx_ 开头的库名只有写明了才核对", () => {
    // 写的不是连上的那个库：不跑
    const other = verify(urlOf(DB), ["--database", BARE]);
    expect(other.status).toBe(2);
    expect(other.stderr).toContain("--database 写的库名与 DATABASE_URL 指的不是同一个");
    expect(other.stdout).toBe("");
    // 写对了：照常核对，经根脚本 pnpm db:verify-grants 传参也一样
    const same = verify(urlOf(DB), ["--database", DB]);
    expect(same.stdout).toContain("结论：通过。");
    expect(same.status).toBe(0);
    const viaPnpm = spawnSync("pnpm", ["db:verify-grants", "--database", DB], {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, DATABASE_URL: urlOf(DB) },
    });
    expect(viaPnpm.stdout).toContain(`- 库：\`${DB}\``);
    expect(viaPnpm.status).toBe(0);
    // 名字不以 lyx_ 开头的库：拿实例自带的 postgres 库来试（里面没有业务表，核对在“没有表”那一步就停，不做写入）。
    // 不写明库名：守卫拦下；写明了：过了守卫，往下核对
    const maintenance = urlOf("postgres");
    const guarded = verify(maintenance);
    expect(guarded.status).toBe(2);
    expect(guarded.stderr).toContain("DATABASE_URL 指的库名要以 lyx_ 开头");
    const named = verify(maintenance, ["--database", "postgres"]);
    expect(named.stderr).toBe("");
    expect(named.stdout).toContain("- 库：`postgres`");
    expect(named.stdout).toMatch(/结论：不通过。/);
    expect(named.status).toBe(1);
  });

  it("连不上：退出码 2，报错里没有主机、账号、口令", () => {
    const result = verify("postgresql://lyx_user_x:s3cret-pw-x@127.0.0.1:1/lyx_none");
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("角色与授权核对：连不上库，或语句没跑成");
    expect(result.stdout + result.stderr).not.toMatch(
      /lyx_user_x|s3cret-pw-x|127\.0\.0\.1|postgresql:/,
    );
  });

  it("服务器版本：16 以下开头就停并说明白（规则单验；真的旧版本上的表现见 packages/db/README.md 第 9 节）", () => {
    expect(rules.versionProblem(170011, "17.11")).toBeNull();
    expect(rules.versionProblem(rules.MIN_VERSION_NUM, "16.0")).toBeNull();
    expect(rules.versionProblem("150013", "15.13")).toContain("本脚本要 16 及以上");
    expect(rules.versionProblem(140021, "14.21")).toContain("服务器是 PostgreSQL 14.21");
    // 这套用例自己也要 16 及以上：连着的实例不够新时在这里说明白
    expect(versionNum, "这份用例要 PostgreSQL 16 及以上的实例").toBeGreaterThanOrEqual(
      rules.MIN_VERSION_NUM,
    );
  });

  it("跑完全部迁移的库：通过；逐项报告；输出里没有连接信息；库里不留数据", () => {
    const result = verify(urlOf(DB));
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    // 数量现查；分布由期望数据算出来（张数多的在前，张数相同按权限集合的字母序）
    const all = countOf("relkind in ('r', 'p')");
    const logical = countOf(
      "relkind in ('r', 'p') and not relispartition and relname <> '_prisma_migrations'",
    );
    const sequences = countOf("relkind = 'S'");
    expect(logical).toBe(Object.keys(expected.tables).length);
    expect(all).toBeGreaterThan(logical);
    expect(sequences).toBeGreaterThan(0);
    const bySet = new Map<string, number>();
    for (const set of Object.values(expected.tables)) bySet.set(set, (bySet.get(set) ?? 0) + 1);
    const spread = [...bySet]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([set, count]) => `${set} ${count} 张`)
      .join("；");
    const columns = Object.entries(expected.columnUpdate).flatMap(([table, list]) =>
      list.map((column) => `${table}.${column}`),
    );
    const definers = Object.keys(expected.definerFunctions).sort();
    expect(columns.length).toBeGreaterThan(0);
    for (const line of [
      "## 角色与授权",
      `- 库：\`${DB}\`；PostgreSQL `,
      "- 角色：lyx_app、lyx_readonly 都在，不可登录，没有特权属性，不是别的角色的成员",
      "- 模式 public：两个角色都有 USAGE，没有 CREATE；库上也没有 CREATE",
      `- lyx_app 的表级权限（${logical} 张逻辑表，逐张与期望相同）：${spread}\n`,
      `- 分区子表与 _prisma_migrations（${all - logical} 张）：lyx_app 没有任何权限`,
      `- 只增表 ${expected.appendOnly.length} 张：改、删、清空都没有权限；列级 UPDATE 只有 ${columns.length} 列（${columns.join("、")}）`,
      `- file_object：${expected.tables.file_object}，没有 DELETE`,
      `- 序列 ${sequences} 个：lyx_app 都有 USAGE（取号），没有 UPDATE（改当前值）`,
      "- 表与序列之外的关系（视图、物化视图、外部表，别的模式里的对象）0 个：",
      `- 以属主身份执行的函数 ${definers.length} 个（${definers.join("、")}）：PUBLIC 不能执行，可执行的角色与期望相同`,
      `- lyx_readonly：${all} 张表（含分区子表与 _prisma_migrations）、${sequences} 个序列都只读；缺省授权 2 条`,
      "- 转授权：没有。别的角色在受限的表（只增、不给改删、分区子表、_prisma_migrations）、序列、视图等上面没有查询以外的权限",
      "结论：通过。角色在，授权生效，分区表可写可查",
    ]) {
      expect(result.stdout).toContain(line);
    }
    expect(result.stdout).toMatch(/- 成员：.*(还没有成员|都连得上这个库)/);
    expect(result.stdout).not.toContain("请人过目");
    expect(result.stdout).toMatch(
      /- 分区表：写入一行落在 analytics_event_y\d{4}m\d{2}，经父表读得回；已回滚，库里不留数据/,
    );
    expect(result.stdout).toMatch(
      /- 当前账号：超级用户 [是否]，可建角色 [是否]，是全部表的属主 是，/,
    );
    for (const secret of [hostname, `:${port}`, password, "postgresql:"]) {
      expect(secret.length).toBeGreaterThan(2);
      expect(result.stdout).not.toContain(secret);
    }
    // 账号名可能很短、也可能与正文里的词重合（本地是 liyoxi），只核对“账号@”“账号:”这两种连接串里的写法
    expect(result.stdout).not.toMatch(new RegExp(`${username}[@:]`));
    expect(lib.sqlOrThrow(DB, "select count(*) from analytics_event").trim()).toBe("0");
  });

  it("lyx_app 的表级权限少授、多授一处就不通过，并指到是哪张表、差在哪", () => {
    // 期望里出现过的每一种权限集合各挑一张表：已有的权限逐个收回，没有的逐个多授，报出来的“实际”由期望算
    for (const [set, table] of firstOfEachSet) {
      for (const privilege of set.split(","))
        tampered(
          `REVOKE ${privilege} ON ${table} FROM lyx_app`,
          `GRANT ${privilege} ON ${table} TO lyx_app`,
          off(table, minus(set, privilege)),
        );
      for (const privilege of FULL.split(",").filter((item) => !set.split(",").includes(item)))
        tampered(
          `GRANT ${privilege} ON ${table} TO lyx_app`,
          `REVOKE ${privilege} ON ${table} FROM lyx_app`,
          off(table, plus(set, privilege)),
        );
    }
    // 一句多授两张不给删除的表：两张都报出来
    const [first, second] = [need(noDelete[0], "不给删除的表"), need(noDelete[1], "不给删除的表")];
    lib.sqlOrThrow(DB, `GRANT DELETE ON ${first}, ${second} TO lyx_app`);
    try {
      const both = verify(urlOf(DB));
      for (const table of [first, second])
        expect(both.stdout).toContain(
          `${table}（实际 ${plus(expected.tables[table] ?? "", "DELETE")}，期望 `,
        );
      expect(both.status).toBe(1);
    } finally {
      lib.sqlOrThrow(DB, `REVOKE DELETE ON ${first}, ${second} FROM lyx_app`);
    }
    // 只增表另有一条不看期望清单的核对：必须恰好是 INSERT、SELECT
    for (const privilege of ["DELETE", "UPDATE"])
      tampered(
        `GRANT ${privilege} ON ${appendOnly} TO lyx_app`,
        `REVOKE ${privilege} ON ${appendOnly} FROM lyx_app`,
        `只增表上 lyx_app 的表级权限不是恰好 INSERT、SELECT：${appendOnly}`,
      );
    // 四种读写之外的权限也算：清空、建触发器，PostgreSQL 17 起另有 MAINTAIN
    tampered(
      `GRANT TRUNCATE ON ${regular} TO lyx_app`,
      `REVOKE TRUNCATE ON ${regular} FROM lyx_app`,
      off(regular, plus(FULL, "TRUNCATE")),
    );
    const beyond = versionNum >= 170000 ? ["TRIGGER", "MAINTAIN"] : ["TRIGGER"];
    tampered(
      `GRANT ${beyond.join(", ")} ON ${appendOnly} TO lyx_app`,
      `REVOKE ${beyond.join(", ")} ON ${appendOnly} FROM lyx_app`,
      off(appendOnly, plus(expected.tables[appendOnly] ?? "", ...beyond)),
    );
    // 库里多一张、少一张表
    tampered(
      "CREATE TABLE lyx_extra_table (id integer PRIMARY KEY)",
      "DROP TABLE lyx_extra_table",
      /库里有而期望清单（packages\/db\/src\/grants\.expected\.json）里没有的表：lyx_extra_table/,
    );
    tampered(
      `ALTER TABLE ${regular} RENAME TO lyx_renamed_table`,
      `ALTER TABLE lyx_renamed_table RENAME TO ${regular}`,
      `期望清单里有而库里没有的表：${regular}`,
    );
    tampered(
      `GRANT SELECT ON ${child} TO lyx_app`,
      `REVOKE SELECT ON ${child} FROM lyx_app`,
      `lyx_app 能直接碰的分区子表或 _prisma_migrations：${child}`,
    );
    expect(verify(urlOf(DB)).status).toBe(0);
  });

  it("列、序列、函数、只读角色、PUBLIC、缺省授权动一处手脚就不通过", () => {
    const extraColumn = columnOf(columnTable, columnList);
    tampered(
      `GRANT UPDATE (${extraColumn}) ON ${columnTable} TO lyx_app`,
      `REVOKE UPDATE (${extraColumn}) ON ${columnTable} FROM lyx_app`,
      `期望之外的列级授权：${columnTable}.${extraColumn}（lyx_app UPDATE）`,
    );
    tampered(
      `REVOKE UPDATE (${exceptionColumn}) ON ${columnTable} FROM lyx_app`,
      `GRANT UPDATE (${exceptionColumn}) ON ${columnTable} TO lyx_app`,
      `lyx_app 少了列级 UPDATE 的列：${columnTable}.${exceptionColumn}`,
    );
    const anyColumn = columnOf(regular);
    tampered(
      `GRANT SELECT (${anyColumn}) ON ${regular} TO lyx_readonly`,
      `REVOKE SELECT (${anyColumn}) ON ${regular} FROM lyx_readonly`,
      `期望之外的列级授权：${regular}.${anyColumn}（lyx_readonly SELECT）`,
    );
    // file_object 是核对脚本自己点名的
    tampered(
      "GRANT DELETE ON file_object TO lyx_app",
      "REVOKE DELETE ON file_object FROM lyx_app",
      "file_object 上 lyx_app 有 DELETE",
    );
    tampered(
      `GRANT SELECT ON ${regular} TO PUBLIC`,
      `REVOKE SELECT ON ${regular} FROM PUBLIC`,
      `PUBLIC 有权限的表、列或序列：${regular}`,
    );
    tampered(
      `REVOKE USAGE ON SEQUENCE ${sequence} FROM lyx_app`,
      `GRANT USAGE ON SEQUENCE ${sequence} TO lyx_app`,
      `lyx_app 的权限不是恰好 USAGE 的序列：${sequence}`,
    );
    tampered(
      `GRANT UPDATE ON SEQUENCE ${sequence} TO lyx_app`,
      `REVOKE UPDATE ON SEQUENCE ${sequence} FROM lyx_app`,
      `lyx_app 的权限不是恰好 USAGE 的序列：${sequence}`,
    );
    // 以属主身份执行的函数：期望里有几个试几个（现在是清理函数一个），谁能执行由期望算
    for (const [name, roles] of Object.entries(expected.definerFunctions)) {
      const signature = `FUNCTION ${one(DB, `select oid::regprocedure from pg_proc where proname = '${name}' and pronamespace = 'public'::regnamespace`)}`;
      const wanted = [...roles].sort().join(",");
      tampered(
        `GRANT EXECUTE ON ${signature} TO PUBLIC`,
        `REVOKE EXECUTE ON ${signature} FROM PUBLIC`,
        `以属主身份执行的函数，库里的与期望清单不符：${name}（可执行的是 ${["PUBLIC", ...roles].sort().join(",")}，期望 ${wanted}）`,
      );
      const [granted = ""] = roles;
      const rest = roles.filter((role) => role !== granted).sort();
      tampered(
        `REVOKE EXECUTE ON ${signature} FROM ${granted}`,
        `GRANT EXECUTE ON ${signature} TO ${granted}`,
        `${name}（可执行的是 ${rest.join(",") || "无"}，期望 ${wanted}）`,
      );
    }
    // 新建一个以属主身份执行的函数而不收回缺省给所有人的执行权
    tampered(
      "CREATE FUNCTION lyx_extra_definer() RETURNS integer LANGUAGE sql SECURITY DEFINER AS 'select 1'",
      "DROP FUNCTION lyx_extra_definer()",
      "lyx_extra_definer（可执行的是 PUBLIC，期望 清单里没有它）",
    );
    tampered(
      `REVOKE SELECT ON ${child} FROM lyx_readonly`,
      `GRANT SELECT ON ${child} TO lyx_readonly`,
      `lyx_readonly 的权限不是恰好 SELECT 的表：${child}`,
    );
    tampered(
      `GRANT INSERT ON ${regular} TO lyx_readonly`,
      `REVOKE INSERT ON ${regular} FROM lyx_readonly`,
      `lyx_readonly 的权限不是恰好 SELECT 的表：${regular}`,
    );
    tampered(
      `REVOKE SELECT ON SEQUENCE ${sequence} FROM lyx_readonly`,
      `GRANT SELECT ON SEQUENCE ${sequence} TO lyx_readonly`,
      `lyx_readonly 的权限不是恰好 SELECT 的序列：${sequence}`,
    );
    const defaults = "ALTER DEFAULT PRIVILEGES IN SCHEMA public";
    for (const kind of ["TABLES", "SEQUENCES"])
      tampered(
        `${defaults} REVOKE SELECT ON ${kind} FROM lyx_readonly`,
        `${defaults} GRANT SELECT ON ${kind} TO lyx_readonly`,
        "没有给 lyx_readonly 的缺省授权",
      );
    // 缺省授权多出一条：以后新建的表（每月的分区在内）会自动授给应用角色；函数、别的角色、带转授权的也算
    tampered(
      `${defaults} GRANT INSERT ON TABLES TO lyx_app`,
      `${defaults} REVOKE INSERT ON TABLES FROM lyx_app`,
      "期望之外的缺省授权（以后新建的表、序列会自动带上）：lyx_app INSERT（以后新建的表；模式 public，挂在 当前账号 名下）",
    );
    tampered(
      "ALTER DEFAULT PRIVILEGES GRANT DELETE ON TABLES TO lyx_app",
      "ALTER DEFAULT PRIVILEGES REVOKE DELETE ON TABLES FROM lyx_app",
      "期望之外的缺省授权（以后新建的表、序列会自动带上）：lyx_app DELETE（以后新建的表；不限模式，",
    );
    tampered(
      `${defaults} GRANT EXECUTE ON FUNCTIONS TO lyx_app`,
      `${defaults} REVOKE EXECUTE ON FUNCTIONS FROM lyx_app`,
      "lyx_app EXECUTE（以后新建的函数；模式 public，",
    );
    tampered(
      `${defaults} GRANT DELETE ON TABLES TO pg_monitor`,
      `${defaults} REVOKE DELETE ON TABLES FROM pg_monitor`,
      "期望之外的缺省授权（以后新建的表、序列会自动带上）：pg_monitor DELETE（以后新建的表；",
    );
    tampered(
      `${defaults} GRANT SELECT ON TABLES TO lyx_readonly WITH GRANT OPTION`,
      `${defaults} REVOKE GRANT OPTION FOR SELECT ON TABLES FROM lyx_readonly`,
      "带转授权（WITH GRANT OPTION）的授权：缺省授权 lyx_readonly SELECT（以后新建的表；",
    );
    // 只读那两条挂到别的角色名下（那个角色以后建的表才带），跑迁移的账号名下的没了
    tampered(
      `${defaults} REVOKE SELECT ON TABLES FROM lyx_readonly; ALTER DEFAULT PRIVILEGES FOR ROLE pg_monitor IN SCHEMA public GRANT SELECT ON TABLES TO lyx_readonly`,
      `ALTER DEFAULT PRIVILEGES FOR ROLE pg_monitor IN SCHEMA public REVOKE SELECT ON TABLES FROM lyx_readonly; ${defaults} GRANT SELECT ON TABLES TO lyx_readonly`,
      /没有给 lyx_readonly 的缺省授权.*期望之外的缺省授权（以后新建的表、序列会自动带上）：lyx_readonly SELECT（以后新建的表；模式 public，挂在 pg_monitor 名下）/,
    );
    expect(verify(urlOf(DB)).status).toBe(0);
  });

  it("模式与库的权限、库的 CONNECT、转授权、属主：动一处手脚就不通过", () => {
    // 收回模式的使用权：表上的授权都还在，但应用进不了模式，一张表也找不到
    tampered(
      "REVOKE USAGE ON SCHEMA public FROM PUBLIC, lyx_app, lyx_readonly",
      "GRANT USAGE ON SCHEMA public TO PUBLIC, lyx_app, lyx_readonly",
      "进不了模式 public（没有 USAGE）的角色：lyx_app、lyx_readonly",
    );
    tampered(
      "GRANT CREATE ON SCHEMA public TO lyx_app",
      "REVOKE CREATE ON SCHEMA public FROM lyx_app",
      "能在模式 public 或库里建对象（有 CREATE）的角色：lyx_app",
    );
    tampered(
      `GRANT CREATE ON DATABASE ${DB} TO lyx_readonly`,
      `REVOKE CREATE ON DATABASE ${DB} FROM lyx_readonly`,
      "能在模式 public 或库里建对象（有 CREATE）的角色：lyx_readonly",
    );
    // 收回库的 CONNECT（加固脚本与托管平台常这么做）：授权都还在，但应用与备份的登录账号连不上这个库
    tampered(
      `REVOKE CONNECT ON DATABASE ${DB} FROM PUBLIC`,
      `GRANT CONNECT ON DATABASE ${DB} TO PUBLIC`,
      /连不上这个库（没有 CONNECT）：lyx_app/,
    );
    tampered(
      `GRANT SELECT ON ${regular} TO lyx_app WITH GRANT OPTION`,
      `REVOKE GRANT OPTION FOR SELECT ON ${regular} FROM lyx_app`,
      `带转授权（WITH GRANT OPTION）的授权：表 ${regular}（lyx_app SELECT）`,
    );
    tampered(
      `GRANT USAGE ON SEQUENCE ${sequence} TO lyx_app WITH GRANT OPTION`,
      `REVOKE GRANT OPTION FOR USAGE ON SEQUENCE ${sequence} FROM lyx_app`,
      `带转授权（WITH GRANT OPTION）的授权：序列 ${sequence}（lyx_app USAGE）`,
    );
    tampered(
      "GRANT USAGE ON SCHEMA public TO lyx_readonly WITH GRANT OPTION",
      "REVOKE GRANT OPTION FOR USAGE ON SCHEMA public FROM lyx_readonly",
      "带转授权（WITH GRANT OPTION）的授权：模式 public（lyx_readonly USAGE）",
    );
    // 属主：只增表落到别的角色名下（属主能停掉触发器、能再授权），或落到应用角色名下
    tampered(
      `ALTER TABLE ${appendOnly} OWNER TO pg_monitor`,
      `ALTER TABLE ${appendOnly} OWNER TO "${me}"`,
      `属主与多数表不同的表或序列（都该属于跑迁移的那个账号）：${appendOnly}（属主 pg_monitor）`,
    );
    tampered(
      `ALTER TABLE ${regular} OWNER TO lyx_app`,
      `ALTER TABLE ${regular} OWNER TO "${me}"; REVOKE ALL ON ${regular} FROM lyx_app; GRANT ${expected.tables[regular]} ON ${regular} TO lyx_app`,
      `属主是 lyx_app 或 lyx_readonly 的表：${regular}`,
    );
    expect(verify(urlOf(DB)).status).toBe(0);
  });

  it("视图、物化视图、别的模式里的表：授给两个角色或 PUBLIC 的，期望之外一律不通过", () => {
    const beyond = (name: string, grantee: string, privileges: string) =>
      `表与序列之外的关系（视图、物化视图、外部表，或别的模式里的对象）上，期望之外的授权：视图等 ${name}（${grantee} ${privileges}）`;
    // 属主建一张视图套在只增表上再授给应用：应用经视图就能删表里的行（视图按属主的权限访问底下的表）
    tampered(
      `CREATE VIEW lyx_extra_view AS SELECT * FROM ${appendOnly}; GRANT SELECT, DELETE ON lyx_extra_view TO lyx_app`,
      "DROP VIEW lyx_extra_view",
      beyond("lyx_extra_view", "lyx_app", "DELETE,SELECT"),
    );
    // 只给查询也不行：期望的 views 里没有它
    tampered(
      `CREATE VIEW lyx_extra_view AS SELECT * FROM ${appendOnly}; GRANT SELECT ON lyx_extra_view TO lyx_app`,
      "DROP VIEW lyx_extra_view",
      beyond("lyx_extra_view", "lyx_app", "SELECT"),
    );
    tampered(
      `CREATE VIEW lyx_extra_view AS SELECT * FROM ${regular}; GRANT SELECT ON lyx_extra_view TO PUBLIC`,
      "DROP VIEW lyx_extra_view",
      beyond("lyx_extra_view", "PUBLIC", "SELECT"),
    );
    tampered(
      `CREATE VIEW lyx_extra_view AS SELECT * FROM ${regular}; GRANT UPDATE ON lyx_extra_view TO lyx_readonly`,
      "DROP VIEW lyx_extra_view",
      beyond("lyx_extra_view", "lyx_readonly", "SELECT,UPDATE"),
    );
    tampered(
      `CREATE MATERIALIZED VIEW lyx_extra_matview AS SELECT * FROM ${appendOnly}; GRANT SELECT ON lyx_extra_matview TO lyx_app`,
      "DROP MATERIALIZED VIEW lyx_extra_matview",
      beyond("lyx_extra_matview", "lyx_app", "SELECT"),
    );
    tampered(
      "CREATE SCHEMA lyx_extra_schema; CREATE TABLE lyx_extra_schema.t (id integer); GRANT USAGE ON SCHEMA lyx_extra_schema TO lyx_app; GRANT INSERT ON lyx_extra_schema.t TO lyx_app",
      "DROP SCHEMA lyx_extra_schema CASCADE",
      beyond("lyx_extra_schema.t", "lyx_app", "INSERT"),
    );
    tampered(
      `CREATE VIEW lyx_extra_view AS SELECT * FROM ${appendOnly}; GRANT DELETE ON lyx_extra_view TO pg_monitor`,
      "DROP VIEW lyx_extra_view",
      "序列、视图等上面，别的角色有查询以外的权限：视图等 lyx_extra_view（pg_monitor DELETE）",
    );
    // 属主建了视图而没有授给应用：通过。只读角色靠缺省授权自动带上 SELECT，这是期望之内的
    lib.sqlOrThrow(DB, `CREATE VIEW lyx_extra_view AS SELECT * FROM ${regular}`);
    try {
      const plain = verify(urlOf(DB));
      expect(plain.stdout).toContain(
        "- 表与序列之外的关系（视图、物化视图、外部表，别的模式里的对象）1 个：",
      );
      expect(plain.status).toBe(0);
    } finally {
      lib.sqlOrThrow(DB, "DROP VIEW lyx_extra_view");
    }
    expect(verify(urlOf(DB)).status).toBe(0);
  });

  it("别的角色：受限的表、序列上有查询以外的权限就不通过；其余的逐条列出请人过目，结论行带上“另有几项”", () => {
    // 别的角色：借系统自带的 pg_monitor 来试，不在共用的实例上建角色
    tampered(
      `GRANT INSERT, UPDATE, DELETE ON ${appendOnly} TO pg_monitor`,
      `REVOKE INSERT, UPDATE, DELETE ON ${appendOnly} FROM pg_monitor`,
      `只增表或不给改、删的表上，别的角色有查询以外的权限：表 ${appendOnly}（pg_monitor DELETE,INSERT,UPDATE）`,
    );
    if (restrictedOther !== undefined) {
      const column = columnOf(restrictedOther);
      tampered(
        `GRANT UPDATE (${column}) ON ${restrictedOther} TO pg_monitor`,
        `REVOKE UPDATE (${column}) ON ${restrictedOther} FROM pg_monitor`,
        `只增表或不给改、删的表上，别的角色有查询以外的权限：列 ${restrictedOther}.${column}（pg_monitor UPDATE）`,
      );
    }
    // 分区子表也算受限的表：绕过父表直接删子表里的行
    tampered(
      `GRANT DELETE ON ${child} TO pg_monitor`,
      `REVOKE DELETE ON ${child} FROM pg_monitor`,
      `别的角色有查询以外的权限：表 ${child}（pg_monitor DELETE）`,
    );
    // 序列一律按受限的算：能改当前值（setval）就能让编号回退、撞号；取号（USAGE）也不该给
    for (const privilege of ["UPDATE", "USAGE"])
      tampered(
        `GRANT ${privilege} ON SEQUENCE ${sequence} TO pg_monitor`,
        `REVOKE ${privilege} ON SEQUENCE ${sequence} FROM pg_monitor`,
        `序列、视图等上面，别的角色有查询以外的权限：序列 ${sequence}（pg_monitor ${privilege}）`,
      );
    // 不算不通过、逐条列出请人过目的：别的角色在受限的表、序列上只有查询，在常规读写的表上有授权，缺省授权里只给查询
    lib.sqlOrThrow(
      DB,
      `GRANT SELECT ON ${appendOnly} TO pg_monitor; GRANT UPDATE, TRUNCATE ON ${regular} TO pg_monitor;
       GRANT SELECT ON SEQUENCE ${sequence} TO pg_monitor;
       ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO pg_monitor`,
    );
    try {
      const listed = verify(urlOf(DB));
      for (const line of [
        "- 请人过目（不算不通过）4 项：",
        `  - pg_monitor 在表 ${appendOnly} 上有 SELECT`,
        `  - pg_monitor 在表 ${regular} 上有 TRUNCATE,UPDATE`,
        `  - pg_monitor 在序列 ${sequence} 上有 SELECT`,
        "  - 缺省授权：pg_monitor SELECT（以后新建的表；模式 public，挂在 当前账号 名下）",
        "结论：通过，另有 4 项请人过目（见上面“请人过目”一行）。角色在，授权生效，分区表可写可查",
      ])
        expect(listed.stdout).toContain(line);
      expect(listed.stdout).not.toContain("结论：通过。");
      expect(listed.status).toBe(0);
    } finally {
      lib.sqlOrThrow(
        DB,
        `REVOKE ALL ON ${appendOnly}, ${regular} FROM pg_monitor; REVOKE ALL ON SEQUENCE ${sequence} FROM pg_monitor;
         ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE SELECT ON TABLES FROM pg_monitor`,
      );
    }
    const clean = verify(urlOf(DB));
    expect(clean.stdout).toContain("结论：通过。角色在，授权生效，分区表可写可查");
    expect(clean.status).toBe(0);
  });

  it("当月的分区摘掉：写入的行落进兜底分区，不通过；还原之后通过，库里不留数据", () => {
    const [current] = lib
      .sqlOrThrow(
        DB,
        "select 'analytics_event_y' || to_char(now() AT TIME ZONE 'Asia/Shanghai', 'YYYY\"m\"MM')",
      )
      .trim()
      .split("\n");
    const bound = lib
      .sqlOrThrow(
        DB,
        `select pg_get_expr(relpartbound, oid) from pg_class where relname = '${current}'`,
      )
      .trim();
    tampered(
      `ALTER TABLE analytics_event DETACH PARTITION ${current}`,
      `ALTER TABLE analytics_event ATTACH PARTITION ${current} ${bound}`,
      "分区表：写入的行落在 analytics_event_default（应是当月的分区）",
    );
    // 全部还原之后又是通过的：上面每一处都还原干净了，失败的那几次也没有留下数据
    const restored = verify(urlOf(DB));
    expect(restored.stdout).toContain("逐张与期望相同");
    expect(restored.status).toBe(0);
    expect(lib.sqlOrThrow(DB, "select count(*) from analytics_event").trim()).toBe("0");
  });

  it("一张表都没有的空库、只跑了首版迁移而没有授权的库：都不通过，脚本不崩", () => {
    lib.recreateDb(BARE);
    const empty = verify(urlOf(BARE));
    expect(empty.stderr).toBe("");
    expect(empty.status).toBe(1);
    // 空库上只报“没有表”，不逐项往下报，也不带出 psql 的报错行
    expect(empty.stdout).toContain("- 表：库里一张表都没有\n\n结论：不通过。迁移还没有跑");
    expect(empty.stdout).not.toMatch(/序列 0 个|LINE 1:|ERROR:/);
    const init = join(repoRoot, "packages/db/prisma/migrations/20261005000000_init/migration.sql");
    lib.sqlOrThrow(BARE, `begin;\n${readFileSync(init, "utf8")}\ncommit;`);
    const result = verify(urlOf(BARE));
    expect(result.stderr).toBe("");
    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/lyx_app 的表级权限与期望不符：[a-z_]+（实际 无，期望 /);
    expect(result.stdout).toContain("lyx_app 的权限不是恰好 USAGE 的序列：");
    expect(result.stdout).toContain("没有给 lyx_readonly 的缺省授权");
    expect(result.stdout).toContain("结论：不通过。");
    // 没有埋点事件表时探针的报错只留一行
    lib.sqlOrThrow(BARE, "DROP TABLE analytics_event CASCADE");
    const noEvents = verify(urlOf(BARE));
    expect(noEvents.status).toBe(1);
    expect(noEvents.stdout).toMatch(
      /分区表写入或查询没成：ERROR: {2}relation "analytics_event" does not exist(；|\n|$)/,
    );
    expect(noEvents.stdout).not.toContain("LINE 1:");
  });
});

// 成员关系是整个实例共用的：在共用的实例上加一个超级用户成员，同时在跑的别的核对（别的用例文件、别的会话）就会误报。
// 所以这一组不动实例：从上面那个库现读一份目录文档（核对脚本用的同一条语句），在文档里改成员，再交给判定规则。
// 真库上把这几种做一遍的结果记在本包的 PR 证据里（各自的临时实例上做的）。
describe("判定规则：成员（拿改过的目录文档验，不动实例）", () => {
  const readCatalog = (): Catalog => JSON.parse(lib.sqlOrThrow(DB, rules.CATALOG_SQL)) as Catalog;
  const member = (patch: Partial<Member>): Member => ({
    role: "lyx_app",
    name: "lyx_login_x",
    super: false,
    admin: false,
    uses: true,
    connect: true,
    create: false,
    others: [],
    ...patch,
  });
  const judged = (members: Member[]) => {
    const catalog = readCatalog();
    return rules.judge({ ...catalog, members: [...catalog.members, ...members] }, expected);
  };

  it("目录文档原样：没有问题；加一个规矩的登录成员：照样没有问题，报告里列出它", () => {
    expect(judged([]).problems).toEqual([]);
    const plain = judged([member({}), member({ role: "lyx_readonly", name: "lyx_backup_x" })]);
    expect(plain.problems).toEqual([]);
    expect(plain.review).toEqual([]);
    expect(plain.notes.join("\n")).toMatch(
      /成员：lyx_app ← .*lyx_login_x.*；lyx_readonly ← .*lyx_backup_x.*。都连得上这个库，不是超级用户，不带 ADMIN OPTION，不另属别的角色/,
    );
  });

  it.each([
    [{ super: true }, "成员是超级用户（不受任何授权限制）：lyx_app 的成员 lyx_login_x"],
    [
      { admin: true },
      "成员带 ADMIN OPTION（能把别的账号加进这个角色）：lyx_app 的成员 lyx_login_x",
    ],
    [
      { others: ["pg_write_all_data"] },
      "成员另是别的角色的成员（带来这两个角色之外的权限）：lyx_app 的成员 lyx_login_x（另属 pg_write_all_data）",
    ],
    [{ create: true }, "成员能在模式 public 或库里建对象（有 CREATE）：lyx_app 的成员 lyx_login_x"],
    [{ connect: false }, "连不上这个库（没有 CONNECT）：lyx_app 的成员 lyx_login_x"],
  ] as Array<[Partial<Member>, string]>)("成员 %j：不通过", (patch, problem) => {
    expect(judged([member(patch)]).problems).toEqual([problem]);
  });

  it("只管成员关系、自己不继承也不能切换的账号：不算不通过，列出请人过目；跑迁移的账号（表的属主）不在这里判", () => {
    const admin = judged([member({ name: "lyx_console_x", admin: true, uses: false })]);
    expect(admin.problems).toEqual([]);
    expect(admin.review).toEqual([
      expect.stringMatching(/^lyx_console_x 能管理 lyx_app 的成员关系（带 ADMIN OPTION；/),
    ]);
    const inert = judged([member({ uses: false })]);
    expect(inert.problems).toEqual([]);
    expect(inert.review).toEqual([
      "lyx_login_x 是 lyx_app 的成员，但不继承、不能切换过去（这条成员关系不带来权限）",
    ]);
    // 属主本来就不受授权限制：它是成员、是超级用户、带 ADMIN OPTION 都不在这里报
    const owner = need(readCatalog().tables[0], "表").owner;
    const self = judged([member({ name: owner, super: true, admin: true, create: true })]);
    expect(self.problems).toEqual([]);
    expect(self.review).toEqual([]);
  });

  it("期望的 views 里列出的视图：lyx_app 可以有 SELECT，多一种权限、库里没有这张视图都不通过", () => {
    const catalog = readCatalog();
    const grant = (privilege: string) => ({
      kind: "relation",
      name: "lyx_listed_view",
      owned: false,
      grantee: "lyx_app",
      privilege,
      grantable: false,
    });
    const acl = catalog.acl as unknown[];
    const withView = (privileges: string[]) => ({
      ...catalog,
      relations: ["lyx_listed_view"],
      acl: [...acl, ...privileges.map(grant)],
    });
    const listed = { ...expected, views: ["lyx_listed_view"] };
    expect(rules.judge(withView(["SELECT"]), listed).problems).toEqual([]);
    expect(rules.judge(withView(["SELECT"]), expected).problems).toHaveLength(1);
    expect(rules.judge(withView(["SELECT", "UPDATE"]), listed).problems).toEqual([
      expect.stringContaining("视图等 lyx_listed_view（lyx_app SELECT,UPDATE）"),
    ]);
    expect(rules.judge(catalog, listed).problems).toEqual([
      "期望清单的 views 里有而库里没有的视图：lyx_listed_view",
    ]);
  });
});
