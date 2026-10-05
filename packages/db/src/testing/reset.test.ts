import { randomUUID } from "node:crypto";

import pg from "pg";
import { describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "../index.js";
import { connectTestDatabase, templateDatabaseName } from "./database.js";
import { useTestDatabase } from "./worker.js";

// 连库、连 Redis、起子进程的用例：实例忙的时候（别的会话同时在跑）会慢，时限放宽，不用缺省的 5 秒
vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

// 重置是删库重建（W0-05b 任务书 第 7 节第 5 条）：往只增表写入后重置，表为空；全程没有 TRUNCATE。
// 只增表上清不了表（应用角色没有 DELETE 与 TRUNCATE 的权限，属主有权限也被触发器拦），所以重置只能是删库、再从模板库拷一份。

const db = useTestDatabase("db");

const databaseOid = async (prisma: PrismaClient): Promise<number> => {
  const rows = await prisma.$queryRaw<Array<{ oid: number }>>`
    select oid::int as oid from pg_database where datname = current_database()`;
  return rows[0]?.oid ?? -1;
};

const writeAudit = (prisma: PrismaClient) =>
  prisma.auditLog.create({
    data: {
      id: randomUUID(),
      stream: "ops",
      category: "测试支架",
      action: "reset.selftest",
      summary: "重置用例写的一行",
      actorType: "system",
      actorName: "测试支架",
      actorRole: "system",
    },
  });

/** pg 的 query 可以收字符串、配置对象：统一取出 SQL 文本 */
const sqlText = (arg: unknown): string =>
  typeof arg === "string" ? arg : String((arg as { text?: unknown }).text);

describe("重置测试库", () => {
  it("往只增表写入后重置，表为空；全程没有 TRUNCATE", { timeout: 120_000 }, async () => {
    let prisma = await db.prisma();
    const first = await writeAudit(prisma);
    await writeAudit(prisma);
    expect(await prisma.auditLog.count()).toBe(2);
    expect(first.seq).toBe(1n);

    // 清表这条路走不通，两道都拦着。缺省的连接是应用角色 lyx_app：没有 TRUNCATE、DELETE 的权限
    await expect(prisma.$executeRawUnsafe("TRUNCATE audit_log")).rejects.toThrow(
      /permission denied for table audit_log/,
    );
    await expect(prisma.$executeRawUnsafe("DELETE FROM audit_log")).rejects.toThrow(
      /permission denied for table audit_log/,
    );
    // 表的属主（role: null 不切角色，就是支架建库、删库用的那个账号）有权限：只增表的触发器把 TRUNCATE 与 DELETE 都拒了
    const owner = await connectTestDatabase(db.name, { role: null });
    try {
      await expect(owner.query("TRUNCATE audit_log")).rejects.toThrow(
        /append-only: TRUNCATE not allowed/,
      );
      await expect(owner.query("DELETE FROM audit_log")).rejects.toThrow(
        /append-only: DELETE not allowed/,
      );
    } finally {
      await owner.end();
    }
    expect(await prisma.auditLog.count()).toBe(2);
    const oidBefore = await databaseOid(prisma);

    const query = vi.spyOn(pg.Client.prototype, "query");
    await db.reset();
    const statements = query.mock.calls.map((call) => sqlText(call[0]));
    query.mockRestore();

    // 重置发出的全部 SQL 就这两句：删库、从模板库重建
    expect(statements).toEqual([
      `DROP DATABASE IF EXISTS "${db.name}" WITH (FORCE)`,
      `CREATE DATABASE "${db.name}" TEMPLATE "${templateDatabaseName()}"`,
    ]);
    expect(statements.join("\n")).not.toMatch(/truncate/i);

    // 重置之后客户端要重新取；库是新建的（对象编号变了），表是空的，自增序号从头开始
    prisma = await db.prisma();
    expect(await databaseOid(prisma)).not.toBe(oidBefore);
    expect(await prisma.auditLog.count()).toBe(0);
    expect((await writeAudit(prisma)).seq).toBe(1n);
  });

  it("重置前取的客户端已经断开，不会连到旧库上", { timeout: 120_000 }, async () => {
    const stale = await db.prisma();
    await db.reset();
    const fresh = await db.prisma();
    expect(fresh).not.toBe(stale);
    expect(await fresh.auditLog.count()).toBe(0);
  });
});
