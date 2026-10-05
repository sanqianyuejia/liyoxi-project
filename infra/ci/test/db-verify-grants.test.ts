import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { repoRoot } from "./helpers.js";

// 角色与授权核对脚本的用例（W0-06a 任务书 第 7 节第 10 条）：在本地那套 PostgreSQL 上演练。
// 先 pnpm infra:up 并给出 DATABASE_URL（CLAUDE.md 第 9 节）；连不上即失败，不跳过。
// 只建、删自己的两个库 lyx_test_infra_grants_<进程号> 与 …_bare。角色是整个实例共用的：这里不建角色、不改角色的属性。
// 本文件不写死“多少张表、多少个序列”：期望取 packages/db/src/grants.expected.json（脚本读的同一份），数量现查系统目录。
// 以后加表、加序列、加函数的包不用改这里；“恰好是多少”由 packages/db/src/grants.test.ts 管。

interface DbLib {
  recreateDb(name: string): void;
  dropDb(name: string): void;
  sqlOrThrow(db: string, sql: string): string;
}
const lib = (await import(pathToFileURL(join(repoRoot, "infra/ci/db-lib.mjs")).href)) as DbLib;

// 全仓用例并行跑时库很忙，建库、删库可能要十几秒：缺省的 5 秒（用例）与 10 秒（钩子）不够
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

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
/** 现查系统目录：public 里某一类对象有多少个 */
const countOf = (where: string): number =>
  Number(
    lib
      .sqlOrThrow(
        DB,
        `select count(*) from pg_class where relnamespace = 'public'::regnamespace and ${where}`,
      )
      .trim(),
  );

function verify(databaseUrl: string | undefined) {
  const { DATABASE_URL: _dropped, PGHOST: _host, ...rest } = process.env;
  const env = databaseUrl === undefined ? rest : { ...rest, DATABASE_URL: databaseUrl };
  const result = spawnSync("node", ["infra/ci/db-verify-grants.mjs"], {
    cwd: repoRoot,
    encoding: "utf8",
    env,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** 动一处手脚，核对要失败并报出这一句；再还原 */
function tampered(change: string, revert: string, expected: string | RegExp): void {
  lib.sqlOrThrow(DB, change);
  try {
    const result = verify(urlOf(DB));
    expect(result.stdout).toMatch(expected);
    expect(result.stdout).toContain("结论：不通过。");
    expect(result.status).toBe(1);
  } finally {
    lib.sqlOrThrow(DB, revert);
  }
}

beforeAll(() => {
  lib.recreateDb(DB);
  const deploy = spawnSync("pnpm", ["--filter", "@liyoxi/db", "migrate:deploy"], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: urlOf(DB) },
  });
  if (deploy.status !== 0) throw new Error(`迁移没跑通：${deploy.stdout}${deploy.stderr}`);
});

afterAll(() => {
  lib.dropDb(DB);
  lib.dropDb(BARE);
});

describe("db-verify-grants.mjs", () => {
  it("没给 DATABASE_URL、库名不是 lyx_ 开头：退出码 2", () => {
    const missing = verify(undefined);
    expect(missing.status).toBe(2);
    expect(missing.stderr).toContain("角色与授权核对：没有连接参数");
    const wrongName = verify(base);
    expect(wrongName.status).toBe(2);
    expect(wrongName.stderr).toContain("DATABASE_URL 指的库名要以 lyx_ 开头");
  });

  it("连不上：退出码 2，报错里没有主机、账号、口令", () => {
    const result = verify("postgresql://lyx_user_x:s3cret-pw-x@127.0.0.1:1/lyx_none");
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("角色与授权核对：连不上库，或语句没跑成");
    expect(result.stdout + result.stderr).not.toMatch(
      /lyx_user_x|s3cret-pw-x|127\.0\.0\.1|postgresql:/,
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
    expect(definers).toContain("lyx_03_purge_auth_event");
    for (const line of [
      "## 角色与授权",
      `- 库：\`${DB}\``,
      "- 角色：lyx_app、lyx_readonly 都在，不可登录，没有特权属性，不是别的角色的成员",
      "- 模式 public：两个角色都有 USAGE，没有 CREATE；库上也没有 CREATE",
      `- lyx_app 的表级权限（${logical} 张逻辑表，逐张与期望相同）：${spread}\n`,
      `- 分区子表与 _prisma_migrations（${all - logical} 张）：lyx_app 没有任何权限`,
      `- 只增表 ${expected.appendOnly.length} 张：改、删、清空都没有权限；列级 UPDATE 只有 ${columns.length} 列（${columns.join("、")}）`,
      `- file_object：${expected.tables.file_object}，没有 DELETE`,
      `- 序列 ${sequences} 个：lyx_app 都有 USAGE（取号），没有 UPDATE（改当前值）`,
      `- 以属主身份执行的函数 ${definers.length} 个（${definers.join("、")}）：PUBLIC 不能执行，可执行的角色与期望相同`,
      `- lyx_readonly：${all} 张表（含分区子表与 _prisma_migrations）、${sequences} 个序列都只读；缺省授权 2 条`,
      "- 转授权：没有。属主以外在表、列、序列上有授权的角色：只有 lyx_app 与 lyx_readonly",
      "结论：通过。角色在，授权生效，分区表可写可查",
    ]) {
      expect(result.stdout).toContain(line);
    }
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
    const off = (table: string, actual: string) =>
      `lyx_app 的表级权限与期望不符：${table}（实际 ${actual}，期望 ${expected.tables[table]}）`;
    // 少授：常规表、可增删不可改的表、不给删除的表
    tampered(
      "REVOKE UPDATE ON store FROM lyx_app",
      "GRANT UPDATE ON store TO lyx_app",
      off("store", "DELETE,INSERT,SELECT"),
    );
    tampered(
      "REVOKE DELETE ON timer FROM lyx_app",
      "GRANT DELETE ON timer TO lyx_app",
      off("timer", "INSERT,SELECT,UPDATE"),
    );
    tampered(
      "REVOKE DELETE ON service_ticket_ref FROM lyx_app",
      "GRANT DELETE ON service_ticket_ref TO lyx_app",
      off("service_ticket_ref", "INSERT,SELECT"),
    );
    tampered(
      "REVOKE UPDATE ON file_object FROM lyx_app",
      "GRANT UPDATE ON file_object TO lyx_app",
      off("file_object", "INSERT,SELECT"),
    );
    tampered(
      "REVOKE INSERT ON billing_order FROM lyx_app",
      "GRANT INSERT ON billing_order TO lyx_app",
      off("billing_order", "SELECT,UPDATE"),
    );
    // 多授：不给删除的表、只插入的时间线、不可改的关联行、只增表
    tampered(
      "GRANT DELETE ON billing_order, payment_txn TO lyx_app",
      "REVOKE DELETE ON billing_order, payment_txn FROM lyx_app",
      /lyx_app 的表级权限与期望不符：billing_order（实际 DELETE,INSERT,SELECT,UPDATE，期望 [A-Z,]+）、payment_txn（/,
    );
    tampered(
      "GRANT DELETE ON service_ticket TO lyx_app",
      "REVOKE DELETE ON service_ticket FROM lyx_app",
      off("service_ticket", "DELETE,INSERT,SELECT,UPDATE"),
    );
    tampered(
      "GRANT UPDATE, DELETE ON service_ticket_entry TO lyx_app",
      "REVOKE UPDATE, DELETE ON service_ticket_entry FROM lyx_app",
      off("service_ticket_entry", "DELETE,INSERT,SELECT,UPDATE"),
    );
    tampered(
      "GRANT UPDATE ON service_ticket_ref TO lyx_app",
      "REVOKE UPDATE ON service_ticket_ref FROM lyx_app",
      off("service_ticket_ref", "DELETE,INSERT,SELECT,UPDATE"),
    );
    tampered(
      "GRANT DELETE ON audit_log TO lyx_app",
      "REVOKE DELETE ON audit_log FROM lyx_app",
      "只增表上 lyx_app 的表级权限不是恰好 INSERT、SELECT：audit_log",
    );
    // 四种读写之外的权限也算：清空、建触发器、PostgreSQL 17 的 MAINTAIN
    tampered(
      "GRANT TRUNCATE ON timer TO lyx_app",
      "REVOKE TRUNCATE ON timer FROM lyx_app",
      off("timer", "DELETE,INSERT,SELECT,TRUNCATE,UPDATE"),
    );
    tampered(
      "GRANT TRIGGER, MAINTAIN ON audit_log TO lyx_app",
      "REVOKE TRIGGER, MAINTAIN ON audit_log FROM lyx_app",
      off("audit_log", "INSERT,MAINTAIN,SELECT,TRIGGER"),
    );
    // 库里多一张、少一张表
    tampered(
      "CREATE TABLE lyx_extra_table (id integer PRIMARY KEY)",
      "DROP TABLE lyx_extra_table",
      /库里有而期望清单（packages\/db\/src\/grants\.expected\.json）里没有的表：lyx_extra_table/,
    );
    tampered(
      "ALTER TABLE home_banner RENAME TO lyx_renamed_table",
      "ALTER TABLE lyx_renamed_table RENAME TO home_banner",
      "期望清单里有而库里没有的表：home_banner",
    );
    tampered(
      "GRANT SELECT ON analytics_event_default TO lyx_app",
      "REVOKE SELECT ON analytics_event_default FROM lyx_app",
      "lyx_app 能直接碰的分区子表或 _prisma_migrations：analytics_event_default",
    );
    expect(verify(urlOf(DB)).status).toBe(0);
  });

  it("列、序列、函数、只读角色、PUBLIC 动一处手脚就不通过", () => {
    tampered(
      "GRANT UPDATE (payload) ON outbox_event TO lyx_app",
      "REVOKE UPDATE (payload) ON outbox_event FROM lyx_app",
      "期望之外的列级授权：outbox_event.payload（lyx_app UPDATE）",
    );
    tampered(
      "REVOKE UPDATE (cancelled_at) ON param_value FROM lyx_app",
      "GRANT UPDATE (cancelled_at) ON param_value TO lyx_app",
      "lyx_app 少了列级 UPDATE 的列：param_value.cancelled_at",
    );
    tampered(
      "GRANT SELECT (id) ON store TO lyx_readonly",
      "REVOKE SELECT (id) ON store FROM lyx_readonly",
      "期望之外的列级授权：store.id（lyx_readonly SELECT）",
    );
    tampered(
      "GRANT DELETE ON file_object TO lyx_app",
      "REVOKE DELETE ON file_object FROM lyx_app",
      "file_object 上 lyx_app 有 DELETE",
    );
    tampered(
      "GRANT SELECT ON work_calendar_day TO PUBLIC",
      "REVOKE SELECT ON work_calendar_day FROM PUBLIC",
      "PUBLIC 有权限的表、列或序列：work_calendar_day",
    );
    tampered(
      "REVOKE USAGE ON SEQUENCE audit_no_seq FROM lyx_app",
      "GRANT USAGE ON SEQUENCE audit_no_seq TO lyx_app",
      "lyx_app 的权限不是恰好 USAGE 的序列：audit_no_seq",
    );
    tampered(
      "GRANT UPDATE ON SEQUENCE audit_no_seq TO lyx_app",
      "REVOKE UPDATE ON SEQUENCE audit_no_seq FROM lyx_app",
      "lyx_app 的权限不是恰好 USAGE 的序列：audit_no_seq",
    );
    const purge = "FUNCTION lyx_03_purge_auth_event(timestamptz)";
    tampered(
      `GRANT EXECUTE ON ${purge} TO PUBLIC`,
      `REVOKE EXECUTE ON ${purge} FROM PUBLIC`,
      "以属主身份执行的函数，库里的与期望清单不符：lyx_03_purge_auth_event（可执行的是 PUBLIC,lyx_app，期望 lyx_app）",
    );
    tampered(
      `REVOKE EXECUTE ON ${purge} FROM lyx_app`,
      `GRANT EXECUTE ON ${purge} TO lyx_app`,
      "lyx_03_purge_auth_event（可执行的是 无，期望 lyx_app）",
    );
    // 新建一个以属主身份执行的函数而不收回缺省给所有人的执行权
    tampered(
      "CREATE FUNCTION lyx_extra_definer() RETURNS integer LANGUAGE sql SECURITY DEFINER AS 'select 1'",
      "DROP FUNCTION lyx_extra_definer()",
      "lyx_extra_definer（可执行的是 PUBLIC，期望 清单里没有它）",
    );
    tampered(
      "REVOKE SELECT ON analytics_event_default FROM lyx_readonly",
      "GRANT SELECT ON analytics_event_default TO lyx_readonly",
      "lyx_readonly 的权限不是恰好 SELECT 的表：analytics_event_default",
    );
    tampered(
      "GRANT INSERT ON timer TO lyx_readonly",
      "REVOKE INSERT ON timer FROM lyx_readonly",
      "lyx_readonly 的权限不是恰好 SELECT 的表：timer",
    );
    tampered(
      "REVOKE SELECT ON SEQUENCE audit_no_seq FROM lyx_readonly",
      "GRANT SELECT ON SEQUENCE audit_no_seq TO lyx_readonly",
      "lyx_readonly 的权限不是恰好 SELECT 的序列：audit_no_seq",
    );
    tampered(
      "ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE SELECT ON TABLES FROM lyx_readonly",
      "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO lyx_readonly",
      "没有给 lyx_readonly 的缺省授权",
    );
    tampered(
      "ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE SELECT ON SEQUENCES FROM lyx_readonly",
      "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON SEQUENCES TO lyx_readonly",
      "没有给 lyx_readonly 的缺省授权",
    );
    // 缺省授权多出一条：以后新建的表（每月的分区在内）会自动授给应用角色
    tampered(
      "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT INSERT ON TABLES TO lyx_app",
      "ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE INSERT ON TABLES FROM lyx_app",
      "期望之外的缺省授权（以后新建的表、序列会自动带上）：lyx_app INSERT",
    );
    expect(verify(urlOf(DB)).status).toBe(0);
  });

  it("模式与库的权限、转授权、别的角色的写权限：动一处手脚就不通过", () => {
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
    tampered(
      "GRANT SELECT ON store TO lyx_app WITH GRANT OPTION",
      "REVOKE GRANT OPTION FOR SELECT ON store FROM lyx_app",
      "带转授权（WITH GRANT OPTION）的授权：表 store（lyx_app SELECT）",
    );
    tampered(
      "GRANT USAGE ON SEQUENCE audit_no_seq TO lyx_app WITH GRANT OPTION",
      "REVOKE GRANT OPTION FOR USAGE ON SEQUENCE audit_no_seq FROM lyx_app",
      "带转授权（WITH GRANT OPTION）的授权：序列 audit_no_seq（lyx_app USAGE）",
    );
    tampered(
      "GRANT USAGE ON SCHEMA public TO lyx_readonly WITH GRANT OPTION",
      "REVOKE GRANT OPTION FOR USAGE ON SCHEMA public FROM lyx_readonly",
      "带转授权（WITH GRANT OPTION）的授权：模式 public（lyx_readonly USAGE）",
    );
    // 别的角色：借系统自带的 pg_monitor 来试，不在共用的实例上建角色
    tampered(
      "GRANT INSERT, UPDATE, DELETE ON audit_log TO pg_monitor",
      "REVOKE INSERT, UPDATE, DELETE ON audit_log FROM pg_monitor",
      "只增表或不给改、删的表上，别的角色有查询以外的权限：表 audit_log（pg_monitor DELETE,INSERT,UPDATE）",
    );
    tampered(
      "GRANT UPDATE (status) ON billing_order TO pg_monitor",
      "REVOKE UPDATE (status) ON billing_order FROM pg_monitor",
      "只增表或不给改、删的表上，别的角色有查询以外的权限：列 billing_order.status（pg_monitor UPDATE）",
    );
    // 分区子表也算受限的表：绕过父表直接删子表里的行
    tampered(
      "GRANT DELETE ON analytics_event_default TO pg_monitor",
      "REVOKE DELETE ON analytics_event_default FROM pg_monitor",
      "别的角色有查询以外的权限：表 analytics_event_default（pg_monitor DELETE）",
    );
    // 不算问题、只列出来请人过目的：别的角色在受限的表上只有查询，或在常规读写的表上有授权
    lib.sqlOrThrow(
      DB,
      "GRANT SELECT ON audit_log TO pg_monitor; GRANT UPDATE ON store TO pg_monitor",
    );
    try {
      const listed = verify(urlOf(DB));
      expect(listed.stdout).toContain(
        "- 转授权：没有。属主以外在表、列、序列上有授权的角色：除这两个之外还有 pg_monitor（",
      );
      expect(listed.status).toBe(0);
    } finally {
      lib.sqlOrThrow(DB, "REVOKE ALL ON audit_log, store FROM pg_monitor");
    }
    expect(verify(urlOf(DB)).status).toBe(0);
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
