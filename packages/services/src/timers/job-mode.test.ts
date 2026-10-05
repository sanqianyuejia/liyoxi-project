import type { PrismaClient } from "@liyoxi/db";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { isInTransaction } from "../kernel/index.js";
import {
  bumpWorkerSample,
  SAMPLE_JOB_KINDS,
  useTestDatabase,
  workerSampleCounts,
} from "../testing/index.js";
import { SLOW, timerRows } from "./__fixtures__/db.js";
import { workerTimers } from "./__fixtures__/worker.js";
import { armRecurringSlot, recurringKey, runTimer } from "./index.js";

// 任务书 第 7 节验收 9：长任务模式。样例 daily 登记为 job 模式，租期 3 秒（每 1 秒续租一次）、至多 6 次。
// 续租那两条要等真的定时器：等的是“看到了什么”，不是卡秒数，时限都留足。

const { daily } = SAMPLE_JOB_KINDS;
const LEASE_SEC = 3;
/** 等一件事发生的上限：机器忙时也够 */
const PATIENCE_MS = 60_000;

const db = useTestDatabase("services");
const t = workerTimers({ longJob: { leaseSec: LEASE_SEC, maxAttempts: 6 } });
const { control } = t.workers;
let prisma: PrismaClient;
let nextDay = 0;

beforeAll(async () => {
  prisma = await db.prisma();
  t.attach(prisma);
}, SLOW);
beforeEach(() => t.reset(), SLOW);

/** 登记 daily 的一期（每次换一天）并认领 */
async function claimDaily() {
  nextDay += 1;
  const slot = new Date(Date.UTC(2026, 3, nextDay, 19, 30));
  await t.deps.tx.run((tx) => armRecurringSlot(tx, daily, slot));
  const [row] = await timerRows(prisma, recurringKey(daily, slot));
  const id = row?.id as string;
  return { id, slot, ref: await t.claim(id) };
}
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
async function until(what: string, check: () => boolean | Promise<boolean>): Promise<void> {
  const deadline = Date.now() + PATIENCE_MS;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`等了 ${PATIENCE_MS} 毫秒也没等到：${what}`);
    await sleep(100);
  }
}
const leaseUntil = async (id: string): Promise<number> => {
  const [row] = await prisma.$queryRawUnsafe<Array<{ at: Date }>>(
    "SELECT lease_until AS at FROM timer WHERE id = $1::uuid",
    id,
  );
  return (row?.at as Date).getTime();
};

describe("长任务模式（验收 9）", () => {
  it(
    "认领确认后在事务外执行，租约换成登记的租期；处理器自己开小事务写库；result 写入",
    async () => {
      const before = (await workerSampleCounts(prisma))[daily];
      const { id, slot, ref } = await claimDaily();
      expect((await t.state(id)).leaseSec).toBe(300);
      const seen: Record<string, unknown> = {};
      control.long = async (ctx) => {
        seen.inTransaction = isInTransaction();
        seen.scheduledFor = ctx.scheduledFor.toISOString();
        seen.leaseSec = (await t.state(id)).leaseSec;
        await ctx.runTx?.((tx) => bumpWorkerSample(tx, daily));
        return { rows: 7 };
      };
      expect(await runTimer(t.deps, ref)).toBe("fired");
      expect(seen).toEqual({
        inTransaction: false,
        scheduledFor: slot.toISOString(),
        leaseSec: LEASE_SEC,
      });
      expect(await t.state(id)).toMatchObject({
        status: "fired",
        fired: true,
        attempts: 0,
        result: { rows: 7 },
      });
      expect((await workerSampleCounts(prisma))[daily]).toBe(before + 1);
    },
    SLOW,
  );

  it(
    "按租期的三分之一续租：处理器跑着的时候租约一次次往后推",
    async () => {
      const { id, ref } = await claimDaily();
      const leases = new Set<number>();
      control.long = async () => {
        await until("租约被续了两次", async () => leases.add(await leaseUntil(id)).size >= 3);
      };
      expect(await runTimer(t.deps, ref)).toBe("fired");
      expect(leases.size).toBeGreaterThanOrEqual(3);
      expect([...leases]).toEqual([...leases].sort((a, b) => a - b));
    },
    SLOW,
  );

  it(
    "续租影响 0 行（已被新一次认领接管）：经 signal 通知处理器中止，这一次不落结果",
    async () => {
      const { id, ref } = await claimDaily();
      let aborted = false;
      control.long = async (ctx) => {
        await prisma.$executeRawUnsafe(
          "UPDATE timer SET dispatch_no = dispatch_no + 1 WHERE id = $1::uuid",
          id,
        );
        await until("收到中止信号", () => ctx.signal?.aborted === true);
        aborted = true;
        return { rows: 1 };
      };
      expect(await runTimer(t.deps, ref)).toBe("stale");
      expect(aborted).toBe(true);
      expect(await t.state(id)).toMatchObject({
        status: "dispatched",
        dispatchNo: ref.dispatchNo + 1,
        fired: false,
        result: null,
      });
    },
    SLOW,
  );

  it(
    "抛错后行保持 dispatched，租约按 1、5、15、30、60 分钟后移；达到 maxAttempts 置 failed 并告警",
    async () => {
      const { id } = await claimDaily();
      control.failing.add(daily);
      const backoffs: Array<number | null> = [];
      for (let n = 1; n <= 6; n += 1) {
        await t.hasten(id);
        const outcome = await runTimer(t.deps, await t.claim(id));
        const state = await t.state(id);
        // 失败由执行这一次记；之后租约到期被重新认领时不再重复记
        expect(state.attempts).toBe(n);
        if (n < 6) {
          expect([outcome, state.status, state.isEnqueued]).toEqual(["retry", "dispatched", false]);
          backoffs.push(state.leaseSec);
        } else {
          expect([outcome, state.status, state.leaseSec]).toEqual(["failed", "failed", null]);
        }
      }
      expect(backoffs).toEqual([60, 300, 900, 1800, 3600]);
      expect(t.ports.alerts.map((alert) => [alert.rule, alert.dimension, alert.severity])).toEqual([
        ["timer.failed", daily, "P2"],
      ]);
    },
    SLOW,
  );
});
