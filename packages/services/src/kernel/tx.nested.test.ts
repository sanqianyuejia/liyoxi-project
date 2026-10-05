import type { PrismaClient } from "@liyoxi/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { useTestDatabase } from "../testing/index.js";
import { barrier, openClient, put, rows } from "./__fixtures__/db.js";
import {
  createTxRunner,
  isInTransaction,
  KernelViolation,
  TX_TIMEOUT_MAX_MS,
  txState,
} from "./tx.js";
import type { Tx, TxRunner } from "./tx.js";

// 验收第 4 条：tx.run 里再 tx.run 抛错；普通 Prisma 客户端传不进要 Tx 的函数（编译不过，由 pnpm typecheck 核对）。

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

/** 一个改库的服务函数：第一个参数是事务句柄 */
const writeRow = (handle: Tx, prefix: string): Promise<unknown> => put(handle, prefix);

describe("tx.run：只有一个开事务的入口", () => {
  it("回调正常返回即提交，返回值原样给出；抛错即回滚，错误原样抛出", async () => {
    expect(await tx.run((handle) => writeRow(handle, "OK").then(() => 42))).toBe(42);
    const boom = new Error("业务失败");
    await expect(
      tx.run(async (handle) => {
        await writeRow(handle, "NO");
        throw boom;
      }),
    ).rejects.toBe(boom);
    expect(Object.keys(await rows(prisma))).toEqual(["OK"]);
  });

  it("tx.run 里再 tx.run 抛错，外层的写入随之回滚", async () => {
    const attempt = tx.run(async (handle) => {
      await writeRow(handle, "NA");
      await tx.run((inner) => writeRow(inner, "NB"));
    });
    await expect(attempt).rejects.toBeInstanceOf(KernelViolation);
    await expect(attempt).rejects.toMatchObject({ kind: "nested_transaction" });
    expect(await rows(prisma)).not.toHaveProperty("NA");
    expect(await rows(prisma)).not.toHaveProperty("NB");
  });

  it("换一个客户端、换一个入口实例也算嵌套；stg、prod 下同样抛错", async () => {
    const second = createTxRunner({ prisma: other, appEnv: "prod", report: () => {} });
    await expect(tx.run(() => second.run(async () => "不该到这里"))).rejects.toMatchObject({
      kind: "nested_transaction",
    });
    await expect(second.run(() => second.run(async () => "不该到这里"))).rejects.toMatchObject({
      kind: "nested_transaction",
    });
  });

  it("嵌套失败之后标记已清掉：接着开事务照常；并排的两个事务不算嵌套", async () => {
    expect(isInTransaction()).toBe(false);
    const second = createTxRunner({ prisma: other, appEnv: "test" });
    const together = barrier(2);
    const both = await Promise.all([
      tx.run(async (handle) => {
        await together();
        await writeRow(handle, "PA");
        return isInTransaction();
      }),
      second.run(async (handle) => {
        await together();
        await writeRow(handle, "PB");
        return isInTransaction();
      }),
    ]);
    expect(both).toEqual([true, true]);
    expect(await rows(prisma)).toMatchObject({ PA: 1, PB: 1 });
  });

  it("超时显式设置：缺省 10 秒、等连接 3 秒，调用处给的上限照传给 Prisma", async () => {
    const passed: unknown[] = [];
    // 在客户端前面接一层，只为看 run 传给 $transaction 的选项；事务照常开
    const watched = new Proxy(prisma, {
      get(target, key) {
        if (key !== "$transaction") return Reflect.get(target, key) as unknown;
        return (fn: never, options: never) => {
          passed.push(options);
          return target.$transaction(fn, options);
        };
      },
    });
    const viaWatched = createTxRunner({ prisma: watched, appEnv: "test" });
    await viaWatched.run(async () => {});
    await viaWatched.run(async () => {}, { timeoutMs: TX_TIMEOUT_MAX_MS, maxWaitMs: 500 });
    expect(passed).toEqual([
      { timeout: 10_000, maxWait: 3_000 },
      { timeout: 60_000, maxWait: 500 },
    ]);
  });

  it("超时显式设置：超过 60 秒的上限、非正数都拒绝，一句 SQL 都不发", async () => {
    const never = (): Promise<never> => Promise.reject(new Error("不该开事务"));
    await expect(tx.run(never, { timeoutMs: TX_TIMEOUT_MAX_MS + 1 })).rejects.toThrow(RangeError);
    await expect(tx.run(never, { timeoutMs: 0 })).rejects.toThrow(RangeError);
    await expect(tx.run(never, { maxWaitMs: 0 })).rejects.toThrow(RangeError);
  });
});

describe("Tx 是带品牌的类型", () => {
  it("普通 Prisma 客户端传不进要 Tx 的函数：编译不过；硬转过去，运行时也认不出", async () => {
    // @ts-expect-error 普通客户端没有品牌：这一行编译得过的话，pnpm typecheck 会报“没用上的 @ts-expect-error”
    const compiled = (): Promise<unknown> => writeRow(prisma, "TY");
    expect(compiled).toBeTypeOf("function");
    expect(() => txState(prisma as unknown as Tx)).toThrow(TypeError);
  });

  it("事务结束之后句柄作废", async () => {
    let leaked: Tx | undefined;
    await tx.run(async (handle) => {
      leaked = handle;
      expect(txState(handle).open).toBe(true);
    });
    expect(() => txState(leaked as Tx)).toThrow(/已经结束/);
  });
});
