import type { PrismaClient } from "@liyoxi/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { connectTestDatabase, useTestDatabase } from "../testing/index.js";
import { bump, put, rows } from "./__fixtures__/db.js";
import { AppError } from "./errors.js";
import { isUniqueViolation } from "./idempotency-tools.js";
import { createTxRunner, dbErrorCause, isRetryableDbError, sqlStateOf, TX_RETRIES } from "./tx.js";
import type { Tx, TxRunner } from "./tx.js";

// 数据库错误出在 COMMIT 那一刻（KF-1 第 ① 条）：延迟约束到提交时才检查；可串行化事务的读写冲突到提交时才判出来。
// Prisma 7.9.1 加 pg 适配器，这时 $transaction 抛出来的是适配器的 DriverAdapterError 本身，不是包过一层的 Prisma 错误：
// SQLSTATE 在 error.cause.originalCode，不在 error.meta.driverAdapterError.cause.originalCode。
// 下面连真库把两种场景各造出来：形状钉住，重试与错误映射照常。

const SLOW = 120_000;
const PROBE = "lyx_probe_commit";
const PROBE_UNIQUE = "uq_lyx_probe_commit_n";

const db = useTestDatabase("services");
let prisma: PrismaClient;
/** 抢先提交的另一方：自己的一条连接（直接用 pg 的连接：它的事务不经 tx.run，在别人的函数体里也开得了） */
let rival: Awaited<ReturnType<typeof connectTestDatabase>>;
let tx: TxRunner;

beforeAll(async () => {
  prisma = await db.prisma();
  rival = await connectTestDatabase(db.name);
  tx = createTxRunner({ prisma, appEnv: "test" });
  // 探针表：一条延迟到提交时检查的唯一约束。建表要属主身份；授权给应用角色后，用例照常走缺省的连接
  const owner = await connectTestDatabase(db.name, { role: null });
  try {
    await owner.query(`
      CREATE TABLE ${PROBE} (
        id integer PRIMARY KEY,
        n integer NOT NULL,
        CONSTRAINT ${PROBE_UNIQUE} UNIQUE (n) DEFERRABLE INITIALLY DEFERRED
      );
      GRANT SELECT, INSERT ON ${PROBE} TO lyx_app;
      INSERT INTO ${PROBE} VALUES (1, 1);`);
  } finally {
    await owner.end();
  }
}, SLOW);

afterAll(async () => {
  await rival?.end();
});

const SERIALIZABLE = "SET TRANSACTION ISOLATION LEVEL SERIALIZABLE";

/**
 * 可串行化事务的写偏：本事务读全表、改 mine 那一行；对方（另一条连接、另一个可串行化事务）读全表、改 theirs 那一行并先提交。
 * 两边互为读写依赖，后提交的一方（本事务）在 COMMIT 时被判序列化失败。本事务的每一句都成功，错只出在提交。
 */
async function skewAgainstRival(handle: Tx, mine: string, theirs: string): Promise<void> {
  await handle.$executeRawUnsafe(SERIALIZABLE);
  await rows(handle);
  await bump(handle, mine);
  await rival.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
  await rival.query("SELECT prefix, next_val FROM biz_sequence");
  await rival.query("UPDATE biz_sequence SET next_val = next_val + 1 WHERE prefix = $1", [theirs]);
  await rival.query("COMMIT");
}

describe("tx.run：数据库错误出在提交那一刻", () => {
  it(
    "延迟的唯一约束在提交时违反：函数体每一句都成功，run 抛出的错误读得出 23505 与约束名，不重试",
    async () => {
      let calls = 0;
      let reachedEnd = false;
      const error: unknown = await tx
        .run(async (handle) => {
          calls += 1;
          await handle.$executeRawUnsafe(`INSERT INTO ${PROBE} VALUES (2, 1)`);
          reachedEnd = true;
        })
        .catch((caught: unknown) => caught);
      expect(reachedEnd).toBe(true);
      // 形状：适配器的错误本身，没有 Prisma 的 code 与 meta
      expect(error).toMatchObject({ name: "DriverAdapterError" });
      expect((error as { meta?: unknown }).meta).toBeUndefined();
      expect(sqlStateOf(error)).toBe("23505");
      expect(String(dbErrorCause(error)?.originalMessage)).toContain(PROBE_UNIQUE);
      expect(isUniqueViolation(error, [PROBE_UNIQUE])).toBe(true);
      expect(isUniqueViolation(error, ["uq_other"])).toBe(false);
      expect(isRetryableDbError(error)).toBe(false);
      expect(calls).toBe(1);
      // 整个事务回滚了，连接也还回去了
      expect(await prisma.$queryRawUnsafe(`SELECT count(*)::int AS rows FROM ${PROBE}`)).toEqual([
        { rows: 1 },
      ]);
    },
    SLOW,
  );

  it(
    "可串行化事务提交时判出序列化失败（40001）：整个重试一次后成功",
    async () => {
      await put(prisma, "CA");
      await put(prisma, "CB");
      let calls = 0;
      await tx.run(async (handle) => {
        calls += 1;
        if (calls === 1) return skewAgainstRival(handle, "CA", "CB");
        await bump(handle, "CA");
      });
      expect(calls).toBe(2);
      // 第一遍的写入随提交失败回滚；对方加了一次，重试的那一遍加了一次
      expect(await rows(prisma)).toMatchObject({ CA: 2, CB: 2 });
    },
    SLOW,
  );

  it(
    "每一遍都在提交时序列化失败：重试不超过上限，耗尽后抛 BUSY，原始错误在 cause",
    async () => {
      await put(prisma, "CC");
      await put(prisma, "CD");
      let calls = 0;
      const error: unknown = await tx
        .run(async (handle) => {
          calls += 1;
          await skewAgainstRival(handle, "CC", "CD");
        })
        .catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({ error: "BUSY", cause: { name: "DriverAdapterError" } });
      expect(sqlStateOf((error as AppError).cause)).toBe("40001");
      expect(calls).toBe(1 + TX_RETRIES);
      // 本事务一次都没写进去；对方每一遍各加一次
      expect(await rows(prisma)).toMatchObject({ CC: 1, CD: 1 + calls });
    },
    SLOW,
  );
});

describe("sqlStateOf：两种形状都认，别的不认", () => {
  const cause = { originalCode: "40P01", originalMessage: "deadlock detected" };

  it("语句执行时的（包在 meta.driverAdapterError 里）与提交时的（适配器的错误本身）都读得出", () => {
    const wrapped = { code: "P2010", meta: { driverAdapterError: { cause } } };
    const bare = Object.assign(new Error("TransactionWriteConflict"), {
      name: "DriverAdapterError",
      cause,
    });
    expect([wrapped, bare].map(sqlStateOf)).toEqual(["40P01", "40P01"]);
    expect([wrapped, bare].map(isRetryableDbError)).toEqual([true, true]);
    expect(dbErrorCause(bare)).toBe(cause);
  });

  it("名字不是 DriverAdapterError 的错误，cause 里碰巧有 originalCode 也不当成数据库错误", () => {
    const lookalike = new Error("别的错误", { cause });
    const mapped = new AppError("BUSY", { cause: Object.assign(new Error("x"), { cause }) });
    const others = [lookalike, mapped, { cause }, "40001", null, undefined];
    expect(others.map(sqlStateOf)).toEqual(others.map(() => undefined));
    expect(others.map(isRetryableDbError)).toEqual(others.map(() => false));
  });

  it("originalCode 不是字符串：读不出", () => {
    const odd = { name: "DriverAdapterError", cause: { originalCode: 40001 } };
    expect(sqlStateOf(odd)).toBeUndefined();
  });
});
