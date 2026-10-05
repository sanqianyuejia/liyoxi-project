import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { runNestedVitest } from "./__fixtures__/nested.js";
import {
  connectTestDatabase,
  createTestDatabase,
  dropTestDatabase,
  listTestDatabases,
  resolveTestSession,
  resolveTestWorker,
  TEST_DEFAULT_ROLE,
  testDatabaseName,
  testDatabaseUrl,
} from "./database.js";
import { TestDatabaseHandle, useTestDatabase } from "./worker.js";

// 连库、连 Redis、起子进程的用例：实例忙的时候（别的会话同时在跑）会慢，时限放宽，不用缺省的 5 秒
vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

// 按 worker 建库（W0-05b 任务书 第 10 节第 3 项）：worker 编号取 Vitest 给的环境变量；首次取连接时建库；
// 用例全过即删库，有失败就留库并打印库名。

const session = resolveTestSession();
const exists = async (name: string) => (await listTestDatabases({ session })).includes(name);
const own = useTestDatabase("db");
/**
 * 不切角色，用 DATABASE_URL 的账号（管理账号，表的属主）。下面建探针表、读探针表的几处要它：
 * 缺省的应用角色 lyx_app 没有模式的 CREATE，属主另建的表它也读不到。
 */
const OWNER = { role: null } as const;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useTestDatabase", () => {
  it("库名带本会话与本 worker 的编号；首次取连接时才建库", { timeout: 120_000 }, async () => {
    expect(own.name).toBe(`lyx_test_db_${session}_${resolveTestWorker()}`);
    expect(own.name).toBe(`lyx_test_db_${session}_${process.env.VITEST_POOL_ID}`);
    expect(await exists(own.name)).toBe(false);
    const prisma = await own.prisma();
    expect(await exists(own.name)).toBe(true);
    const rows = await prisma.$queryRaw<
      Array<{ db: string }>
    >`select current_database()::text as db`;
    expect(rows).toEqual([{ db: own.name }]);
    // 一个库一个客户端实例
    expect(await own.prisma()).toBe(prisma);
  });

  it("嵌套跑一轮：全过的文件删库，有失败的文件留库并打印库名", { timeout: 120_000 }, async () => {
    const result = runNestedVitest("hooks-", { maxWorkers: 2 });
    expect(result.status, result.output).toBe(1);
    expect(result.output).toMatch(/Test Files\s+1 failed \| 1 passed \(2\)/);
    const kept = new RegExp(
      `有用例或钩子失败，测试库留着没删：(lyx_test_db_${session}_\\d+_hookfail_k[a-z0-9]+)`,
    ).exec(result.output)?.[1];
    expect(kept, result.output).toBeDefined();
    if (!kept) return;
    try {
      const left = (await listTestDatabases({ session })).filter((name) => name.includes("_hook"));
      expect(left).toEqual([kept]);
      // 留下的库里，失败之前写的数据还在
      const client = await connectTestDatabase(kept, OWNER);
      try {
        expect((await client.query("select outcome from lyx_hooks_probe")).rows).toEqual([
          { outcome: "fail" },
        ]);
      } finally {
        await client.end();
      }
    } finally {
      await dropTestDatabase(kept);
    }
  });
});

describe("useTestDatabase：钩子里失败也算失败", () => {
  it(
    "嵌套跑一轮：beforeAll 失败、别的 afterAll 失败、里层 describe 的 beforeAll 失败，库都留着",
    { timeout: 120_000 },
    async () => {
      const result = runNestedVitest("suite-", { maxWorkers: 3 });
      expect(result.status, result.output).toBe(1);
      expect(result.output).toMatch(/Test Files\s+3 failed \(3\)/);
      const kept = [
        ...result.output.matchAll(
          new RegExp(`测试库留着没删：(lyx_test_db_${session}_\\d+_(s[a-z]+)_k[a-z0-9]+)`, "g"),
        ),
      ].map((match) => ({ name: match[1] ?? "", label: match[2] ?? "" }));
      try {
        expect(kept.map((entry) => entry.label).sort(), result.output).toEqual([
          "safter",
          "sbefore",
          "snested",
        ]);
        // 原名都腾出来了，留下的只有改了名的三个
        const left = (await listTestDatabases({ session })).filter((name) =>
          /_s(before|after|nested)(_|$)/.test(name),
        );
        expect(left.sort()).toEqual(kept.map((entry) => entry.name).sort());
        // 留下的库里，失败之前写的数据还在
        const outcomes: string[] = [];
        for (const { name } of kept) {
          const client = await connectTestDatabase(name, OWNER);
          try {
            const rows = (
              await client.query<{ outcome: string }>("select outcome from lyx_hooks_probe")
            ).rows;
            outcomes.push(...rows.map((row) => row.outcome));
          } finally {
            await client.end();
          }
        }
        expect(outcomes.sort()).toEqual(["after-all", "before-all", "nested"]);
      } finally {
        const leftovers = (await listTestDatabases({ session })).filter((name) =>
          /_s(before|after|nested)(_|$)/.test(name),
        );
        for (const name of leftovers) await dropTestDatabase(name);
      }
    },
  );
});

describe("useTestDatabase：本项目要挂 globalSetup", () => {
  it(
    "嵌套跑一轮、不给它 globalSetup 的并行数：文件一加载就报错，库没建",
    { timeout: 120_000 },
    async () => {
      const result = runNestedVitest("hooks-pass", { maxWorkers: 1, attached: false });
      expect(result.status, result.output).toBe(1);
      expect(result.output).toContain("本包的 vitest.config.ts 没有挂测试支架的 globalSetup");
      expect(result.output).toMatch(/Test Files\s+1 failed \(1\)/);
      const left = (await listTestDatabases({ session })).filter((name) => name.includes("_hook"));
      expect(left).toEqual([]);
    },
  );
});

describe("TestDatabaseHandle", () => {
  it("没取过连接的收尾什么都不做，库没建过", async () => {
    const handle = new TestDatabaseHandle(testDatabaseName("db", { label: "never" }));
    expect(handle.created).toBe(false);
    expect(await handle.dispose({ failed: true })).toBeUndefined();
    expect(await exists(handle.name)).toBe(false);
  });

  it("有用例失败：库改名留下并打印库名；原名腾出来", { timeout: 120_000 }, async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const handle = new TestDatabaseHandle(testDatabaseName("db", { label: "bad" }), OWNER);
    const prisma = await handle.prisma();
    await prisma.$executeRawUnsafe("create table lyx_keep_probe as select 1 as n");
    const kept = await handle.dispose({ failed: true });
    try {
      expect(kept).toMatch(new RegExp(`^${handle.name}_k[a-z0-9]+$`));
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(`测试库留着没删：${kept}`));
      expect(await exists(handle.name)).toBe(false);
      const client = await connectTestDatabase(kept ?? "", OWNER);
      try {
        expect((await client.query("select n from lyx_keep_probe")).rows).toEqual([{ n: 1 }]);
      } finally {
        await client.end();
      }
    } finally {
      if (kept) await dropTestDatabase(kept);
    }
  });

  it(
    "上一轮没收尾留下的同名库：删掉重建，不带旧数据；用例全过，收尾即删库",
    { timeout: 120_000 },
    async () => {
      const name = testDatabaseName("db", { label: "stale" });
      await dropTestDatabase(name);
      await createTestDatabase(name);
      const before = await connectTestDatabase(name, OWNER);
      await before.query("create table lyx_stale_probe as select 1 as n");
      await before.end();

      const handle = new TestDatabaseHandle(name);
      const prisma = await handle.prisma();
      const rows = await prisma.$queryRaw<Array<{ found: boolean }>>`
      select to_regclass('public.lyx_stale_probe') is not null as found`;
      expect(rows).toEqual([{ found: false }]);
      expect(await exists(name)).toBe(true);
      expect(await handle.dispose({ failed: false })).toBeUndefined();
      expect(await exists(name)).toBe(false);
    },
  );

  interface Who {
    current: string;
    session: string;
  }
  const who = "select current_user::text as current, session_user::text as session";
  /** DATABASE_URL 的账号：登录用的总是它，切角色只换 current_user */
  const login = decodeURIComponent(new URL(process.env.DATABASE_URL ?? "").username);
  const roleOf = (url: string) => new URL(url).searchParams.get("options");

  // W0-05b 任务书 第 11 节第 8 项、W0-06a 任务书 第 11 节第 8 项：授权迁移合并后，测试连接缺省切到应用角色。
  // 这一条把缺省钉住：谁把它改回“不切”，或改成别的角色，这里就红
  it(
    "缺省切到应用角色 lyx_app：只增表改不了、删不了（42501）；写 role: null 才是 DATABASE_URL 的账号",
    { timeout: 120_000 },
    async () => {
      expect(TEST_DEFAULT_ROLE).toBe("lyx_app");
      expect(login).not.toBe("lyx_app");
      const asApp = [{ current: "lyx_app", session: login }];

      // 三个入口的缺省都是它：Prisma 客户端、连接串、pg 连接
      const prisma = await own.prisma();
      expect(await prisma.$queryRawUnsafe<Who[]>(who)).toEqual(asApp);
      expect(roleOf(await own.url())).toBe("-c role=lyx_app");
      expect(roleOf(testDatabaseUrl(own.name))).toBe("-c role=lyx_app");
      // 写 null 是不切：连接串里不带 role
      expect(roleOf(testDatabaseUrl(own.name, OWNER))).toBeNull();

      const app = await connectTestDatabase(own.name);
      const owner = await connectTestDatabase(own.name, OWNER);
      try {
        expect((await app.query<Who>(who)).rows).toEqual(asApp);
        // 应用角色在只增表上：插得进、读得到；改、删、清空在权限那一道就被拒（42501），轮不到触发器
        await prisma.auditLog.create({
          data: {
            id: randomUUID(),
            stream: "ops",
            category: "测试支架",
            action: "role.selftest",
            summary: "缺省角色的用例写的一行",
            actorType: "system",
            actorName: "测试支架",
            actorRole: "system",
          },
        });
        expect((await app.query("select count(*)::int as n from audit_log")).rows).toEqual([
          { n: 1 },
        ]);
        for (const sql of [
          "update audit_log set summary = summary",
          "delete from audit_log",
          "truncate audit_log",
        ]) {
          await expect(app.query(sql), sql).rejects.toMatchObject({ code: "42501" });
        }
        // 建表也不行：应用角色没有模式的 CREATE
        await expect(app.query("create table lyx_role_probe (n int)")).rejects.toMatchObject({
          code: "42501",
        });

        // 显式要属主身份：current_user 就是登录的账号，表是它的
        expect((await owner.query<Who>(who)).rows).toEqual([{ current: login, session: login }]);
        expect(
          (
            await owner.query(
              "select tableowner::text as owner from pg_tables where schemaname = 'public' and tablename = 'audit_log'",
            )
          ).rows,
        ).toEqual([{ owner: login }]);
        // 属主有权限，拦它的是触发器那一道（23001）
        await expect(owner.query("update audit_log set summary = summary")).rejects.toMatchObject({
          code: "23001",
        });
        expect((await owner.query("select count(*)::int as n from audit_log")).rows).toEqual([
          { n: 1 },
        ]);
      } finally {
        await app.end();
        await owner.end();
      }

      // useTestDatabase、TestDatabaseHandle 的 role: null 同样不切
      const handle = new TestDatabaseHandle(testDatabaseName("db", { label: "owner" }), OWNER);
      try {
        expect(await (await handle.prisma()).$queryRawUnsafe<Who[]>(who)).toEqual([
          { current: login, session: login },
        ]);
        expect(roleOf(await handle.url())).toBeNull();
      } finally {
        await handle.dispose({ failed: false });
      }
    },
  );

  it("role 选项：连上之后切到指定的角色", { timeout: 120_000 }, async () => {
    // pg_read_all_data 是 PostgreSQL 自带的只读角色：切过去之后能读、不能写
    const handle = new TestDatabaseHandle(testDatabaseName("db", { label: "role" }), {
      role: "pg_read_all_data",
    });
    try {
      const prisma = await handle.prisma();
      expect(await prisma.$queryRawUnsafe<Who[]>(who)).toEqual([
        { current: "pg_read_all_data", session: login },
      ]);
      expect(await prisma.authEvent.count()).toBe(0);
      await expect(
        prisma.authEvent.create({
          data: { id: randomUUID(), createdAt: new Date(), space: "staff", event: "logout" },
        }),
      ).rejects.toThrow(/permission denied for table auth_event/);
    } finally {
      await handle.dispose({ failed: false });
    }
    // 角色名写错：构造时就抛错，不建库
    expect(() => new TestDatabaseHandle(handle.name, { role: "x; drop role y" })).toThrow(/角色名/);
    expect(await exists(handle.name)).toBe(false);
  });

  it("名字不是测试库：构造时就被守卫拒掉", () => {
    for (const name of ["postgres", "liyoxi", "lyx_schema_check", "test_x"]) {
      expect(() => new TestDatabaseHandle(name)).toThrow(/只动 lyx_test_ 开头的库/);
    }
  });
});
