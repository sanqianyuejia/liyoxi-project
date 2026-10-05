import type { PrismaClient } from "@liyoxi/db";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { createTxRunner, defineRegistration } from "../kernel/index.js";
import type { TxRunner } from "../kernel/index.js";
import { assembleForTest, createClock, useTestDatabase } from "../testing/index.js";
import { bindOps } from "./binding.js";
import { runScheduledInvariants, runScheduledRetention } from "./jobs.js";

// 三个周期任务的处理器（薄壳）：没绑运行时即抛错；不变量运行出错即抛错，交给定时器重试与告警。
// 经任务进程把它们跑起来的那一条在 apps/worker/test/ops-jobs.test.ts。

const SLOW = 180_000;

const db = useTestDatabase("services");
const clock = createClock();
const state = { boom: false };
const assembly = assembleForTest({
  entry: "worker",
  isolated: true,
  extra: [
    defineRegistration("ops", {
      invariants: [
        {
          code: "lyxtest.flaky",
          severity: "P2",
          modes: ["full", "quick"],
          run: async () => {
            if (state.boom) throw new Error("样例：检查项坏了");
            return [{ subject: { key: "lyxtest.flaky_key" }, detail: {} }];
          },
        },
      ],
    }),
  ],
});
/** 清理的那一条用真实模块的装配（告警端口要有模块声明过），另加一个样例清理项 */
const withCleanup = assembleForTest({
  entry: "worker",
  extra: [
    defineRegistration("lyxtest_ops_jobs", {
      cleanups: [{ name: "lyxtest.nothing", every: "hour", run: async () => 3 }],
    }),
  ],
});
let prisma: PrismaClient;
let tx: TxRunner;
let unbind: (() => void) | undefined;

beforeAll(async () => {
  prisma = await db.prisma();
  tx = createTxRunner({ prisma, appEnv: "test" });
}, SLOW);

afterEach(() => {
  unbind?.();
  unbind = undefined;
  state.boom = false;
});

const scheduledFor = new Date("2026-01-05T12:00:00+08:00");

describe("周期任务的处理器", () => {
  it("没绑运行时：抛错，说明要在进程装配时绑定", async () => {
    await expect(runScheduledInvariants("full", { scheduledFor })).rejects.toThrow(
      /invariant\.full：ops 还没有绑定运行时/,
    );
    await expect(runScheduledRetention({ scheduledFor })).rejects.toThrow(/ops\.retention：/);
  });

  it(
    "不变量：跑完返回摘要（写进定时器行）；运行记了 failed 即抛错，带运行号与出错的检查项",
    async () => {
      unbind = bindOps({ db: prisma, tx, clock, assembly });
      const done = await runScheduledInvariants("quick", { scheduledFor });
      expect(done).toEqual({
        runId: expect.any(String),
        checksRun: 1,
        violationsFound: 1,
        created: 1,
        autoClosed: 0,
      });

      state.boom = true;
      await expect(runScheduledInvariants("full", { scheduledFor })).rejects.toThrow(
        /不变量运行 [0-9a-f-]{36} 出错：lyxtest\.flaky：.*样例：检查项坏了/,
      );
      const runs = await prisma.$queryRawUnsafe<{ mode: string; status: string }[]>(
        "SELECT mode, status FROM invariant_run WHERE trigger = 'schedule' ORDER BY id",
      );
      expect(runs).toEqual([
        { mode: "quick", status: "succeeded" },
        { mode: "full", status: "failed" },
      ]);
    },
    SLOW,
  );

  it(
    "清理：在本期的事务里执行，返回各项处理的行数；没拿到事务即抛错",
    async () => {
      unbind = bindOps({ db: prisma, tx, clock, assembly: withCleanup });
      await expect(runScheduledRetention({ scheduledFor })).rejects.toThrow(/tx 模式/);
      const result = await tx.run((handle) => runScheduledRetention({ scheduledFor, tx: handle }));
      expect(result).toEqual({
        daily: false,
        rows: { "kernel.idempotency_record": 0, "lyxtest.nothing": 3 },
        failed: {},
      });
    },
    SLOW,
  );
});
