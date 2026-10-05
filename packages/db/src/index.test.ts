import { readdirSync } from "node:fs";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPrismaClient } from "./index.js";
import type { PrismaClient } from "./index.js";
import { testDatabaseUrl, useTestDatabase } from "./testing/index.js";

// 客户端工厂的用例（W0-05 任务书 第 7 节第 7 条）。连的是本 worker 自己的测试库：
// 由 W0-05b 的支架从本会话的模板库拷出来（模板库在每轮测试开始时建好并跑完全部迁移），跑完即删。
// 主机与账号取环境变量 DATABASE_URL（本地的写法见 CLAUDE.md 第 9 节）。连不上：整轮失败，不跳过。
// 支架给的连接缺省切到应用角色 lyx_app（W0-06a）：下面除了读迁移记录表的那一条，都是以应用角色的身份跑的。

const db = useTestDatabase("db");

// api 主池的三个超时（D7 第 8.3 节）：这里只用来验证工厂把它们下发到了会话上
const TIMEOUTS = {
  statementTimeoutMs: 8_000,
  lockTimeoutMs: 3_000,
  idleInTransactionSessionTimeoutMs: 15_000,
};
const SETTINGS_SQL = `select current_setting('statement_timeout') as statement,
  current_setting('lock_timeout') as lock,
  current_setting('idle_in_transaction_session_timeout') as idle`;
type Settings = Array<{ statement: string; lock: string; idle: string }>;

let connectionString: string;
let prisma: PrismaClient;

beforeAll(async () => {
  connectionString = await db.url();
  prisma = createPrismaClient({ connectionString, max: 2, ...TIMEOUTS });
}, 120_000);

afterAll(async () => {
  await prisma.$disconnect();
});

describe("createPrismaClient", () => {
  it("读一张表成功：普通表与按月分区的表", async () => {
    expect(Array.isArray(await prisma.idempotencyRecord.findMany({ take: 1 }))).toBe(true);
    expect(typeof (await prisma.analyticsEvent.count())).toBe("number");
  });

  it("交互式事务里 $queryRaw 可用；测试库上每个迁移恰一行且已完成", async () => {
    // 迁移记录表要属主来读：缺省的连接是应用角色 lyx_app，它在 _prisma_migrations 上什么权限都没有。
    // 这一条另起一个不切角色的客户端（role: null，用 DATABASE_URL 的账号）
    const owner = createPrismaClient({
      connectionString: testDatabaseUrl(db.name, { role: null }),
      max: 1,
    });
    try {
      const rows = await owner.$transaction(
        (tx) =>
          tx.$queryRaw<Array<{ name: string; done: boolean }>>`
          select migration_name as name, finished_at is not null and rolled_back_at is null as done
            from _prisma_migrations order by migration_name`,
      );
      // 任务书 第 7 节第 3 条：现在只有首版迁移一个目录，即“恰一行且已完成”；以后加了迁移，这里跟着目录走
      const migrations = readdirSync(new URL("../prisma/migrations", import.meta.url), {
        withFileTypes: true,
      }).flatMap((entry) => (entry.isDirectory() ? [entry.name] : []));
      expect(rows).toEqual(migrations.sort().map((name) => ({ name, done: true })));
    } finally {
      await owner.$disconnect();
    }
  });

  it("三个会话超时下发到了连接上，事务内外都生效", async () => {
    const expected = [{ statement: "8s", lock: "3s", idle: "15s" }];
    expect(await prisma.$queryRawUnsafe<Settings>(SETTINGS_SQL)).toEqual(expected);
    expect(await prisma.$transaction((tx) => tx.$queryRawUnsafe<Settings>(SETTINGS_SQL))).toEqual(
      expected,
    );
  });

  it("不给超时：沿用服务器的设置；连接数上限为 1 时所有查询走同一条连接", async () => {
    const single = createPrismaClient({ connectionString, max: 1 });
    try {
      const server = await single.$queryRawUnsafe<Settings>(SETTINGS_SQL);
      expect(server).toEqual([{ statement: "0", lock: "0", idle: "0" }]);
      const pids = await Promise.all(
        Array.from(
          { length: 5 },
          () => single.$queryRaw<Array<{ pid: number }>>`select pg_backend_pid() as pid`,
        ),
      );
      expect(new Set(pids.map((rows) => rows[0]?.pid)).size).toBe(1);
    } finally {
      await single.$disconnect();
    }
  });
});
