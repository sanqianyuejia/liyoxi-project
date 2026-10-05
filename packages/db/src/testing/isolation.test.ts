import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "../index.js";
import { connectTestDatabase } from "./database.js";
import { useTestDatabase } from "./worker.js";

// 连库、连 Redis、起子进程的用例：实例忙的时候（别的会话同时在跑）会慢，时限放宽，不用缺省的 5 秒
vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

// 两个测试库互不影响（W0-05b 任务书 第 7 节第 3 条）：各自跑完全部迁移；
// 在甲库调用清理函数 lyx_03_purge_auth_event 只删甲库的行，乙库行数不变。
// 这个函数是 SECURITY DEFINER、写死 search_path = public：按 schema 隔离时它在哪个 schema 里调都落在 public 上，
// 所以隔离单位只能是库（计划 第 5.4 节）。

const a = useTestDatabase("db");
const b = useTestDatabase("db", { label: "b" });

const MIGRATIONS = readdirSync(new URL("../../prisma/migrations", import.meta.url), {
  withFileTypes: true,
})
  .flatMap((entry) => (entry.isDirectory() ? [entry.name] : []))
  .sort();

const DAY = 24 * 60 * 60 * 1000;

/** 往 auth_event 写几行：old 行早于 13 个月（清理函数删得掉），recent 行是现在的 */
async function seed(prisma: PrismaClient, old: number, recent: number): Promise<void> {
  const row = (createdAt: Date) => ({
    id: randomUUID(),
    createdAt,
    space: "staff",
    event: "login_fail",
  });
  await prisma.authEvent.createMany({
    data: [
      ...Array.from({ length: old }, () => row(new Date(Date.now() - 400 * DAY))),
      ...Array.from({ length: recent }, () => row(new Date())),
    ],
  });
}

describe("两个测试库互不影响", () => {
  it("是两个不同的库，各自跑完了全部迁移", { timeout: 120_000 }, async () => {
    expect(a.name).not.toBe(b.name);
    const seen: Array<{ db: string; oid: number; tables: number }> = [];
    for (const db of [a, b]) {
      const prisma = await db.prisma();
      // 迁移记录表要属主来读（role: null 不切角色）：缺省的应用角色在 _prisma_migrations 上什么权限都没有
      const owner = await connectTestDatabase(db.name, { role: null });
      try {
        const migrations = await owner.query<{ name: string; done: boolean }>(
          `select migration_name as name, finished_at is not null and rolled_back_at is null as done
             from _prisma_migrations order by migration_name`,
        );
        expect(migrations.rows).toEqual(MIGRATIONS.map((name) => ({ name, done: true })));
      } finally {
        await owner.end();
      }
      const [info] = await prisma.$queryRaw<Array<{ db: string; oid: number; tables: number }>>`
        select current_database()::text as db,
               (select oid::int from pg_database where datname = current_database()) as oid,
               (select count(*)::int from pg_tables where schemaname = 'public') as tables`;
      if (!info) throw new Error("没查到库的信息");
      expect(info.db).toBe(db.name);
      seen.push(info);
    }
    expect(seen[0]?.oid).not.toBe(seen[1]?.oid);
    // 166 张逻辑表加分区子表与 _prisma_migrations；两个库一样多
    expect(seen[0]?.tables).toBeGreaterThan(166);
    expect(seen[1]?.tables).toBe(seen[0]?.tables);
  });

  it("清理函数是 SECURITY DEFINER，写死 search_path = public", async () => {
    const prisma = await a.prisma();
    const [fn] = await prisma.$queryRaw<Array<{ definer: boolean; config: string[] }>>`
      select prosecdef as definer, proconfig as config from pg_proc where proname = 'lyx_03_purge_auth_event'`;
    expect(fn).toEqual({ definer: true, config: ["search_path=public, pg_temp"] });
  });

  it("在甲库调用清理函数只删甲库的行，乙库行数不变", { timeout: 120_000 }, async () => {
    const [prismaA, prismaB] = [await a.prisma(), await b.prisma()];
    await seed(prismaA, 3, 2);
    await seed(prismaB, 3, 2);
    expect(await prismaA.authEvent.count()).toBe(5);
    expect(await prismaB.authEvent.count()).toBe(5);

    const [purged] = await prismaA.$queryRaw<Array<{ n: bigint }>>`
      select lyx_03_purge_auth_event(now() - interval '13 months') as n`;
    expect(purged?.n).toBe(3n);

    expect(await prismaA.authEvent.count()).toBe(2);
    expect(await prismaB.authEvent.count()).toBe(5);
    // 乙库里 13 个月前的 3 行原样还在
    const cutoff = new Date(Date.now() - 395 * DAY);
    expect(await prismaB.authEvent.count({ where: { createdAt: { lt: cutoff } } })).toBe(3);
  });
});
