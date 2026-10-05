import type { PrismaClient } from "@liyoxi/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { useTestDatabase } from "../testing/index.js";
import { barrier, gate, openClient, put, rows } from "./__fixtures__/db.js";
import { assertNotInTransaction, createTxRunner, isInTransaction, KernelViolation } from "./tx.js";
import type { TxRunner } from "./tx.js";

// 验收第 3 条：事务回调里调用“不在事务中”断言即抛错；事务外通过；并发的两个事务互不串标记。
// Provider 的入口接上这个断言是 W0-19、W0-20 的事，这里只验断言本身。

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

/** 一个外部调用的入口：先过断言，再“发请求” */
async function callWechat(sent: string[]): Promise<void> {
  assertNotInTransaction("wechatPay.createOrder");
  sent.push("createOrder");
}

describe("外呼断言：事务内不调外部服务", () => {
  it("事务外通过", async () => {
    const sent: string[] = [];
    expect(isInTransaction()).toBe(false);
    await callWechat(sent);
    expect(sent).toEqual(["createOrder"]);
  });

  it("事务回调里调用即抛错，请求没发出去，事务回滚", async () => {
    const sent: string[] = [];
    const attempt = tx.run(async (handle) => {
      await put(handle, "EA"); // 真发过一句 SQL 之后，标记还跟着这条异步调用链
      await callWechat(sent);
    });
    await expect(attempt).rejects.toBeInstanceOf(KernelViolation);
    await expect(attempt).rejects.toMatchObject({
      kind: "external_call_in_transaction",
      message: expect.stringContaining("wechatPay.createOrder"),
    });
    expect(sent).toEqual([]);
    expect(await rows(prisma)).not.toHaveProperty("EA");
  });

  it("先调外部、再开事务：通过", async () => {
    const sent: string[] = [];
    await callWechat(sent);
    await tx.run((handle) => put(handle, "EB"));
    await callWechat(sent);
    expect(sent).toEqual(["createOrder", "createOrder"]);
  });

  it("并发的两个事务互不串标记：一个结束了，另一个还在事务中；事务外的调用链始终不在", async () => {
    const second = createTxRunner({ prisma: other, appEnv: "test" });
    const bothOpen = barrier(2);
    const firstDone = gate();
    const seen: Record<string, boolean> = {};

    const first = tx
      .run(async (handle) => {
        await put(handle, "CA");
        await bothOpen();
        seen.firstInside = isInTransaction();
      })
      .then(() => {
        // 第一个事务已提交，第二个还开着：这条调用链不在事务中
        seen.firstAfterCommit = isInTransaction();
        firstDone.open();
      });
    const secondRun = second.run(async (handle) => {
      await put(handle, "CB");
      await bothOpen();
      await firstDone.opened;
      // 第一个事务结束不影响第二个的标记
      seen.secondAfterFirstDone = isInTransaction();
      expect(() => assertNotInTransaction("sms.send")).toThrow(KernelViolation);
    });
    // 两个事务都开着的时候，事务外的调用链不受影响
    seen.outside = isInTransaction();
    assertNotInTransaction("outside");

    await Promise.all([first, secondRun]);
    expect(seen).toEqual({
      outside: false,
      firstInside: true,
      firstAfterCommit: false,
      secondAfterFirstDone: true,
    });
  });

  it("事务里起的调用链在事务结束之后不再算在事务中", async () => {
    const committed = gate();
    let later: Promise<boolean> | undefined;
    await tx.run(async () => {
      later = committed.opened.then(() => isInTransaction());
    });
    committed.open();
    expect(await later).toBe(false);
  });

  it("stg、prod：不抛错，记 error 并上报，调用照常进行", async () => {
    const reported: KernelViolation[] = [];
    const sent: string[] = [];
    const prod = createTxRunner({
      prisma,
      appEnv: "prod",
      report: (violation) => reported.push(violation),
    });
    await prod.run(async (handle) => {
      await put(handle, "PR");
      await callWechat(sent);
    });
    expect(sent).toEqual(["createOrder"]);
    expect(reported.map((violation) => violation.kind)).toEqual(["external_call_in_transaction"]);
    expect(await rows(prisma)).toHaveProperty("PR");

    // 没给上报函数：落到 console.error
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await createTxRunner({ prisma, appEnv: "stg" }).run(() => callWechat(sent));
      expect(logged).toHaveBeenCalledTimes(1);
      expect(logged.mock.calls[0]?.[0]).toBeInstanceOf(KernelViolation);
    } finally {
      logged.mockRestore();
    }
  });
});
