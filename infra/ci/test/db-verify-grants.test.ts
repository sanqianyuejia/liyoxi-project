import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { repoRoot } from "./helpers.js";

// 角色与授权核对脚本的用例（W0-06a 任务书 第 7 节第 10 条）：在本地那套 PostgreSQL 上演练。
// 先 pnpm infra:up 并给出 DATABASE_URL（CLAUDE.md 第 9 节）；连不上即失败，不跳过。
// 只建、删自己的两个库 lyx_test_infra_grants_<进程号> 与 …_bare。角色是整个实例共用的：这里不改角色的属性。

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
    for (const line of [
      "## 角色与授权",
      `- 库：\`${DB}\``,
      "- 角色：lyx_app、lyx_readonly 都在，不可登录，没有特权属性，不是别的角色的成员",
      "- lyx_app 的表级权限（166 张逻辑表）：DELETE,INSERT,SELECT,UPDATE 135 张；INSERT,SELECT 17 张；INSERT,SELECT,UPDATE 13 张；DELETE,INSERT,SELECT 1 张",
      "- 分区子表与 _prisma_migrations（6 张）：lyx_app 没有任何权限",
      "- 只增表 16 张：改、删、清空都没有权限；列级 UPDATE 只有 11 列（outbox_event.published_at、",
      "- file_object：INSERT,SELECT,UPDATE，没有 DELETE",
      "- 序列 15 个：lyx_app 都有 USAGE（取号），没有 UPDATE（改当前值）",
      "- 以属主身份执行的函数 1 个（lyx_03_purge_auth_event）：只有 lyx_app 可执行",
      "- lyx_readonly：172 张表（含分区子表与 _prisma_migrations）、15 个序列都只读；缺省授权 2 条",
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

  it("动一处手脚就不通过，并指到是哪一处", () => {
    tampered(
      "GRANT DELETE ON audit_log TO lyx_app",
      "REVOKE DELETE ON audit_log FROM lyx_app",
      "只增表上 lyx_app 的表级权限不是恰好 INSERT、SELECT：audit_log",
    );
    tampered(
      "GRANT UPDATE (payload) ON outbox_event TO lyx_app",
      "REVOKE UPDATE (payload) ON outbox_event FROM lyx_app",
      "只增表上 lyx_app 的列级 UPDATE 与清单不符：outbox_event",
    );
    tampered(
      "REVOKE UPDATE (cancelled_at) ON param_value FROM lyx_app",
      "GRANT UPDATE (cancelled_at) ON param_value TO lyx_app",
      "只增表上 lyx_app 的列级 UPDATE 与清单不符：param_value",
    );
    tampered(
      "GRANT DELETE ON file_object TO lyx_app",
      "REVOKE DELETE ON file_object FROM lyx_app",
      "file_object 上 lyx_app 有 DELETE",
    );
    tampered(
      "CREATE TABLE lyx_extra_table (id integer PRIMARY KEY)",
      "DROP TABLE lyx_extra_table",
      "lyx_app 少了 SELECT 或 INSERT 的表：lyx_extra_table",
    );
    tampered(
      "GRANT SELECT ON analytics_event_default TO lyx_app",
      "REVOKE SELECT ON analytics_event_default FROM lyx_app",
      "lyx_app 能直接碰的分区子表或 _prisma_migrations：analytics_event_default",
    );
    tampered(
      "GRANT TRUNCATE ON timer TO lyx_app",
      "REVOKE TRUNCATE ON timer FROM lyx_app",
      "lyx_app 多出 TRUNCATE、REFERENCES 或 TRIGGER 的表：timer",
    );
    tampered(
      "GRANT SELECT ON work_calendar_day TO PUBLIC",
      "REVOKE SELECT ON work_calendar_day FROM PUBLIC",
      "PUBLIC 有权限的表：work_calendar_day",
    );
    tampered(
      "REVOKE USAGE ON SEQUENCE audit_no_seq FROM lyx_app",
      "GRANT USAGE ON SEQUENCE audit_no_seq TO lyx_app",
      "lyx_app 的权限不是恰好 USAGE 的序列：audit_no_seq",
    );
    tampered(
      "GRANT EXECUTE ON FUNCTION lyx_03_purge_auth_event(timestamptz) TO PUBLIC",
      "REVOKE EXECUTE ON FUNCTION lyx_03_purge_auth_event(timestamptz) FROM PUBLIC",
      "PUBLIC 或 lyx_readonly 可执行的属主身份函数：lyx_03_purge_auth_event",
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
      "ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE SELECT ON TABLES FROM lyx_readonly",
      "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO lyx_readonly",
      "没有给 lyx_readonly 的缺省授权",
    );
    // 当月的分区摘掉：写入的行落进兜底分区
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
    expect(verify(urlOf(DB)).status).toBe(0);
    expect(lib.sqlOrThrow(DB, "select count(*) from analytics_event").trim()).toBe("0");
  });

  it("一张表都没有的空库、只跑了首版迁移而没有授权的库：都不通过，脚本不崩", () => {
    lib.recreateDb(BARE);
    const empty = verify(urlOf(BARE));
    expect(empty.stderr).toBe("");
    expect(empty.status).toBe(1);
    expect(empty.stdout).toContain(
      "只增表上 lyx_app 的表级权限不是恰好 INSERT、SELECT：outbox_event、",
    );
    expect(empty.stdout).toContain("分区表写入或查询没成：");
    const init = join(repoRoot, "packages/db/prisma/migrations/20261005000000_init/migration.sql");
    lib.sqlOrThrow(BARE, `begin;\n${readFileSync(init, "utf8")}\ncommit;`);
    const result = verify(urlOf(BARE));
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("lyx_app 少了 SELECT 或 INSERT 的表：");
    expect(result.stdout).toContain("没有给 lyx_readonly 的缺省授权");
    expect(result.stdout).toContain("结论：不通过。");
  });
});
