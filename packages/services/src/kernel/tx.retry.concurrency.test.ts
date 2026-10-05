import type { PrismaClient } from "@liyoxi/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { useTestDatabase } from "../testing/index.js";
import { barrier, bump, gate, openClient, put, rows } from "./__fixtures__/db.js";
import { AppError } from "./errors.js";
import {
  createTxRunner,
  sqlStateOf,
  TX_MAX_WAIT_MS,
  TX_RETRIES,
  TX_TIMEOUT_MAX_MS,
  TX_TIMEOUT_MS,
} from "./tx.js";
import type { Tx, TxRunner } from "./tx.js";

// 验收第 6 条（甲类的并发测试）：两条独立连接、栅栏对齐，各重复 ROUNDS 次。
// 死锁被重试后两方都成功；锁等待超时重试不超过上限，耗尽后抛 BUSY；语句超时不重试，抛 UPSTREAM_TIMEOUT。
// 重试是把用例函数体整个再跑一遍：每个场景都数函数体跑了几次。

const ROUNDS = 20;
const SLOW = 120_000;

const db = useTestDatabase("services");
let prisma: PrismaClient;
/** 造死锁的两条连接：锁等待给足 3 秒（与 api 主池一样），死锁检测调到 20 毫秒 */
let left: PrismaClient;
let right: PrismaClient;
/** 等锁的一方：锁等待 15 毫秒就超时 */
let waiter: PrismaClient;
/** 占着锁、占着连接的一方 */
let holder: PrismaClient;
let tx: TxRunner;

beforeAll(async () => {
  prisma = await db.prisma();
  [left, right, waiter, holder] = await Promise.all([
    openClient(db, { lockTimeoutMs: 3_000, deadlockTimeoutMs: 20 }),
    openClient(db, { lockTimeoutMs: 3_000, deadlockTimeoutMs: 20 }),
    openClient(db, { lockTimeoutMs: 15 }),
    openClient(db),
  ]);
  tx = createTxRunner({ prisma: waiter, appEnv: "test" });
}, SLOW);

afterAll(async () => {
  await Promise.all([left, right, waiter, holder].map((client) => client?.$disconnect()));
});

/** 记下这条语句失败时的 SQLSTATE，错误原样抛出 */
const noting =
  (states: string[]) =>
  (error: unknown): never => {
    states.push(String(sqlStateOf(error)));
    throw error;
  };

/** 让 holder 开一个事务占住某一行，直到调用 release。返回时锁已经拿到 */
async function holdRow(prefix: string): Promise<{ release: () => Promise<void> }> {
  const locked = gate();
  const done = gate();
  const holding = createTxRunner({ prisma: holder, appEnv: "test" }).run(
    async (handle) => {
      await bump(handle, prefix);
      locked.open();
      await done.opened;
    },
    { timeoutMs: 60_000 },
  );
  await locked.opened;
  return {
    release: async () => {
      done.open();
      await holding;
    },
  };
}

describe("tx.run：死锁与锁等待超时有限重试", () => {
  // 变异核对时发现：把重试次数改大，下面按 1 + TX_RETRIES 断言的用例照样绿。把取值钉在这里
  it("取值照 D7 第 8.3 节与任务书：重试 1 次；事务 10 秒、等连接 3 秒、批处理上限 60 秒", () => {
    expect({ TX_RETRIES, TX_TIMEOUT_MS, TX_MAX_WAIT_MS, TX_TIMEOUT_MAX_MS }).toEqual({
      TX_RETRIES: 1,
      TX_TIMEOUT_MS: 10_000,
      TX_MAX_WAIT_MS: 3_000,
      TX_TIMEOUT_MAX_MS: 60_000,
    });
  });

  it(
    `造死锁 ${ROUNDS} 次：每次恰有一方被数据库选中、重试一次，两方都成功`,
    async () => {
      await put(prisma, "DA");
      await put(prisma, "DB");
      const one = createTxRunner({ prisma: left, appEnv: "test" });
      const two = createTxRunner({ prisma: right, appEnv: "test" });
      for (let round = 0; round < ROUNDS; round += 1) {
        const aligned = barrier(2);
        const states: string[] = [];
        const calls = [0, 0];
        const body = (side: 0 | 1, first: string, second: string) => async (handle: Tx) => {
          calls[side] = (calls[side] ?? 0) + 1;
          const firstTime = calls[side] === 1;
          await bump(handle, first);
          // 两边各拿到第一把锁，再一起去要对方那一把：必然死锁。重试的那一遍不再等栅栏
          if (firstTime) await aligned();
          await bump(handle, second).catch(noting(states));
        };
        await Promise.all([one.run(body(0, "DA", "DB")), two.run(body(1, "DB", "DA"))]);
        expect(states, `第 ${round + 1} 轮`).toEqual(["40P01"]);
        expect((calls[0] ?? 0) + (calls[1] ?? 0), `第 ${round + 1} 轮`).toBe(3);
      }
      // 两方每轮都提交了：各加 ROUNDS 次，一次不丢
      expect(await rows(prisma)).toMatchObject({ DA: 1 + 2 * ROUNDS, DB: 1 + 2 * ROUNDS });
    },
    SLOW,
  );

  it(
    `造锁等待超时 ${ROUNDS} 次：重试不超过上限，耗尽后抛 BUSY`,
    async () => {
      await put(prisma, "LT");
      const held = await holdRow("LT");
      try {
        for (let round = 0; round < ROUNDS; round += 1) {
          let calls = 0;
          const error: unknown = await tx
            .run(async (handle) => {
              calls += 1;
              await bump(handle, "LT");
            })
            .catch((caught: unknown) => caught);
          expect(error, `第 ${round + 1} 轮`).toBeInstanceOf(AppError);
          expect(error).toMatchObject({ error: "BUSY" });
          expect(sqlStateOf((error as AppError).cause)).toBe("55P03");
          expect(calls, `第 ${round + 1} 轮`).toBe(1 + TX_RETRIES);
        }
      } finally {
        await held.release();
      }
      // 只有占锁的一方加了一次
      expect(await rows(prisma)).toMatchObject({ LT: 2 });
    },
    SLOW,
  );

  it("锁等待超时之后对方放了锁：重试的那一遍成功", async () => {
    await put(prisma, "LR");
    const held = await holdRow("LR");
    const states: string[] = [];
    let calls = 0;
    await tx.run(async (handle) => {
      calls += 1;
      await bump(handle, "LR").catch(async (error: unknown) => {
        await held.release();
        noting(states)(error);
      });
    });
    expect(states).toEqual(["55P03"]);
    expect(calls).toBe(2);
    expect(await rows(prisma)).toMatchObject({ LR: 3 });
  });

  it("序列化失败（40001）：重试一次后成功", async () => {
    await put(prisma, "SR");
    const states: string[] = [];
    let calls = 0;
    await tx.run(async (handle) => {
      calls += 1;
      await handle.$executeRawUnsafe("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
      await rows(handle); // 取快照
      if (calls === 1) await bump(prisma, "SR"); // 另一条连接抢先改掉并提交
      await bump(handle, "SR").catch(noting(states));
    });
    expect(states).toEqual(["40001"]);
    expect(calls).toBe(2);
    expect(await rows(prisma)).toMatchObject({ SR: 3 });
  });
});

describe("tx.run：不重试的错误怎么映射", () => {
  it(
    `语句超时 ${ROUNDS} 次：不重试，抛 UPSTREAM_TIMEOUT`,
    async () => {
      for (let round = 0; round < ROUNDS; round += 1) {
        let calls = 0;
        const error: unknown = await tx
          .run(async (handle) => {
            calls += 1;
            await handle.$executeRawUnsafe("SET LOCAL statement_timeout = '20ms'");
            await handle.$queryRawUnsafe("SELECT pg_sleep(1)");
          })
          .catch((caught: unknown) => caught);
        expect(error, `第 ${round + 1} 轮`).toBeInstanceOf(AppError);
        expect(error).toMatchObject({ error: "UPSTREAM_TIMEOUT" });
        expect(sqlStateOf((error as AppError).cause)).toBe("57014");
        expect(calls, `第 ${round + 1} 轮`).toBe(1);
      }
    },
    SLOW,
  );

  it("事务超时（Prisma 的 P2028）：不重试，抛 BUSY", async () => {
    let calls = 0;
    const error: unknown = await tx
      .run(
        async (handle) => {
          calls += 1;
          await new Promise((resolve) => setTimeout(resolve, 200));
          await bump(handle, "TO");
        },
        { timeoutMs: 50 },
      )
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject({ name: "AppError", error: "BUSY", cause: { code: "P2028" } });
    expect(calls).toBe(1);
  });

  it("等不到连接（maxWait，同是 P2028）：抛 BUSY，函数体一次都没跑", async () => {
    await put(prisma, "MW");
    const held = await holdRow("MW"); // holder 只有一条连接，被这个事务占着
    let calls = 0;
    try {
      const error: unknown = await createTxRunner({ prisma: holder, appEnv: "test" })
        .run(
          async () => {
            calls += 1;
          },
          { maxWaitMs: 50 },
        )
        .catch((caught: unknown) => caught);
      expect(error).toMatchObject({ name: "AppError", error: "BUSY", cause: { code: "P2028" } });
      expect(calls).toBe(0);
    } finally {
      await held.release();
    }
  });

  it("业务错误、别的数据库错误：不重试，原样抛出", async () => {
    await put(prisma, "UQ");
    const refused = new AppError("STATE_NOT_ALLOWED");
    let calls = 0;
    await expect(
      tx.run(async () => {
        calls += 1;
        throw refused;
      }),
    ).rejects.toBe(refused);
    const error: unknown = await tx
      .run(async (handle) => {
        calls += 1;
        await put(handle, "UQ"); // 主键冲突
      })
      .catch((caught: unknown) => caught);
    expect(error).not.toBeInstanceOf(AppError);
    expect(sqlStateOf(error)).toBe("23505");
    expect(calls).toBe(2);
  });

  it("接住数据库错误又不用保存点：报“事务已被数据库中止”，原因挂在 cause 上", async () => {
    await put(prisma, "AB");
    const error: unknown = await tx
      .run(async (handle) => {
        await put(handle, "AB").catch(() => {});
      })
      .catch((caught: unknown) => caught);
    expect(error).not.toBeInstanceOf(AppError);
    expect((error as Error).message).toMatch(/事务已被数据库中止/);
    expect(sqlStateOf((error as Error).cause)).toBe("25P02");
  });
});
