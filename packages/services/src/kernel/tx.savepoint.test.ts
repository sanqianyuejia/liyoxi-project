import type { PrismaClient } from "@liyoxi/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { useTestDatabase } from "../testing/index.js";
import { BIZ_DATE, bump, openClient, probeRowLock, put, rows } from "./__fixtures__/db.js";
import { createTxRunner, savepoint } from "./tx.js";
import type { Tx, TxRunner } from "./tx.js";

// 验收第 5 条，也是 V4 的验证：Prisma 7 交互式事务里，原生保存点可用。
// 保存点内失败只回滚保存点：保存点外的写入随提交落库，保存点内的不落库；回滚后事务还能接着写；已持有的行锁还在。

const db = useTestDatabase("services");
let prisma: PrismaClient;
let other: PrismaClient;
let tx: TxRunner;

beforeAll(async () => {
  prisma = await db.prisma();
  other = await openClient(db);
  tx = createTxRunner({ prisma, appEnv: "test" });
}, 120_000);

afterAll(async () => {
  await other.$disconnect();
});

class FulfilFailed extends Error {}

const putRaw = (handle: Tx, prefix: string): Promise<number> =>
  handle.$executeRawUnsafe(
    "INSERT INTO biz_sequence (prefix, biz_date, next_val) VALUES ($1, $2::date, 1)",
    prefix,
    BIZ_DATE.toISOString().slice(0, 10),
  );

describe("savepoint：保存点内失败只回滚保存点（V4）", () => {
  it("保存点内抛业务错：外面的写入落库，里面的不落库，回滚后还能接着写", async () => {
    const outcome = await tx.run(async (handle) => {
      await put(handle, "BA");
      const fulfilled = await savepoint(handle, async () => {
        await put(handle, "BB");
        throw new FulfilFailed("履约失败");
      }).catch((error: unknown) => {
        if (!(error instanceof FulfilFailed)) throw error;
        return "受阻";
      });
      await put(handle, "BC");
      return fulfilled;
    });
    expect(outcome).toBe("受阻");
    const saved = await rows(prisma);
    expect(saved).toMatchObject({ BA: 1, BC: 1 });
    expect(saved).not.toHaveProperty("BB");
  });

  it.each([
    { via: "原生 SQL", insert: putRaw, first: "RA", inside: "RB", after: "RC" },
    { via: "模型接口", insert: put, first: "MA", inside: "MB", after: "MC" },
  ])(
    "保存点内触发数据库错（唯一约束冲突，$via）：外面的落库，里面的不落库，回滚后还能接着写",
    async ({ insert, first, inside, after }) => {
      let caught: unknown;
      await tx.run(async (handle) => {
        await insert(handle, first);
        await savepoint(handle, async () => {
          await insert(handle, inside);
          await insert(handle, first); // 主键冲突：23505
        }).catch((error: unknown) => {
          caught = error;
        });
        // 没有保存点的话，这里事务已被数据库中止，下一句会报 25P02
        await insert(handle, after);
      });
      expect(String((caught as Error).message)).toMatch(/23505|Unique constraint/);
      const saved = await rows(prisma);
      expect(saved).toMatchObject({ [first]: 1, [after]: 1 });
      expect(saved).not.toHaveProperty(inside);
    },
  );

  it("已持有的行锁还在：另一条连接拿不到；保存点里加的锁随回滚放掉", async () => {
    await put(prisma, "LK");
    await put(prisma, "LI");
    await tx.run(async (handle) => {
      await bump(handle, "LK"); // 保存点之前拿到 LK 的行锁
      await savepoint(handle, async () => {
        await bump(handle, "LI"); // 保存点里拿到 LI 的行锁
        expect(await probeRowLock(other, "LI")).toBe("held");
        throw new FulfilFailed("履约失败");
      }).catch(() => {});
      expect(await probeRowLock(other, "LK")).toBe("held");
      expect(await probeRowLock(other, "LI")).toBe("free");
      await bump(handle, "LK");
    });
    expect(await probeRowLock(other, "LK")).toBe("free");
    expect(await rows(prisma)).toMatchObject({ LK: 3, LI: 1 });
  });

  it("保存点正常结束：返回值原样给出，写入随事务提交；内层失败不带走外层", async () => {
    const value = await tx.run((handle) =>
      savepoint(handle, async () => {
        await put(handle, "NA");
        await savepoint(handle, async () => {
          await put(handle, "NB");
          throw new FulfilFailed("内层失败");
        }).catch(() => {});
        await put(handle, "NC");
        return "外层完成";
      }),
    );
    expect(value).toBe("外层完成");
    const saved = await rows(prisma);
    expect(saved).toMatchObject({ NA: 1, NC: 1 });
    expect(saved).not.toHaveProperty("NB");
  });

  it("保存点成功、事务随后失败：保存点里的写入一并回滚", async () => {
    await expect(
      tx.run(async (handle) => {
        await savepoint(handle, () => put(handle, "FA"));
        throw new FulfilFailed("后面失败");
      }),
    ).rejects.toBeInstanceOf(FulfilFailed);
    expect(await rows(prisma)).not.toHaveProperty("FA");
  });

  it("对照：不用保存点接住数据库错误，事务不能接着用，整个事务什么都不落库", async () => {
    await put(prisma, "XA");
    // 接住之后接着写：下一句被数据库拒绝
    await expect(
      tx.run(async (handle) => {
        await put(handle, "XB");
        await put(handle, "XA").catch(() => {});
        await put(handle, "XC");
      }),
    ).rejects.toThrow(/aborted|中止/);
    // 接住之后不再发语句：PostgreSQL 会把 COMMIT 悄悄当成 ROLLBACK，tx.run 在提交前探一句，照样报错
    await expect(
      tx.run(async (handle) => {
        await put(handle, "XB");
        await put(handle, "XA").catch(() => {});
        return "调用方以为成功";
      }),
    ).rejects.toThrow(/aborted|中止/);
    const saved = await rows(prisma);
    expect(saved).not.toHaveProperty("XB");
    expect(saved).not.toHaveProperty("XC");
  });
});
