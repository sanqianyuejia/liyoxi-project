import type { PrismaClient } from "@liyoxi/db";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { defineRegistration } from "../kernel/index.js";
import {
  deliverRepeatedly,
  SAMPLE_JOB_KINDS,
  SAMPLE_TIMER_KINDS,
  useTestDatabase,
  workerSampleCounts,
} from "../testing/index.js";
import { SLOW, timerRows } from "./__fixtures__/db.js";
import { workerTimers } from "./__fixtures__/worker.js";
import {
  armRecurringSlot,
  claimTimers,
  recurringKey,
  runTimer,
  scanDue,
  timerJobId,
  TIMER_MAX_ATTEMPTS,
  TIMER_QUEUE,
} from "./index.js";
import type { Timers } from "./index.js";

// 任务书 第 7 节验收 8（定时器执行）；另：扫描认领、入队失败的三条出路、周期任务的 tx 模式、
// 同一次认领被重复触发（D7 第 10.3 节 C8，甲类的并发测试）。
// 时间都是数据库时间：退避量用同一条语句写下的 retry_at − updated_at 量。

const { plain, revivable } = SAMPLE_TIMER_KINDS;
const { every5 } = SAMPLE_JOB_KINDS;

const db = useTestDatabase("services");
const t = workerTimers();
const { control } = t.workers;
let prisma: PrismaClient;

beforeAll(async () => {
  prisma = await db.prisma();
  t.attach(prisma);
}, SLOW);
beforeEach(() => t.reset(), SLOW);

const counts = () => workerSampleCounts(prisma);
const boom = async (): Promise<void> => {
  throw new Error("样例：业务写之后出错");
};

describe("runTimer：处理器结果与业务写同事务（验收 8）", () => {
  it(
    "返回 fired：业务写与完成标记一起提交；返回 skipped：不做业务写",
    async () => {
      const before = (await counts())[plain];
      const fired = await t.arm(plain);
      expect(await runTimer(t.deps, await t.claim(fired.id))).toBe("fired");
      expect(await t.state(fired.id)).toMatchObject({ status: "fired", fired: true, attempts: 0 });
      expect((await counts())[plain]).toBe(before + 1);

      control.skipping.add(plain);
      const skipped = await t.arm(plain);
      expect(await runTimer(t.deps, await t.claim(skipped.id))).toBe("skipped");
      expect(await t.state(skipped.id)).toMatchObject({ status: "skipped", fired: true });
      expect((await counts())[plain]).toBe(before + 1);
    },
    SLOW,
  );

  it(
    "处理器在业务写之后抛错：业务写随事务回滚，另记一次失败；重试成功后只有一次业务写",
    async () => {
      const before = (await counts())[plain];
      const { id } = await t.arm(plain);
      control.after = boom;
      expect(await runTimer(t.deps, await t.claim(id))).toBe("retry");
      expect(await t.state(id)).toMatchObject({
        status: "scheduled",
        attempts: 1,
        retrySec: 60,
        leaseSec: null,
        fired: false,
      });
      expect((await t.state(id)).lastError).toContain("业务写之后出错");
      expect((await counts())[plain]).toBe(before);

      delete control.after;
      await t.hasten(id);
      expect(await runTimer(t.deps, await t.claim(id))).toBe("fired");
      expect((await counts())[plain]).toBe(before + 1);
    },
    SLOW,
  );

  it(
    "失败退避 1、2、5、15、30 分钟；非关键类第 6 次置 failed 并告警",
    async () => {
      control.failing.add(plain);
      const { id } = await t.arm(plain);
      const backoffs: Array<number | null> = [];
      for (let n = 1; n <= TIMER_MAX_ATTEMPTS; n += 1) {
        await t.hasten(id);
        const outcome = await runTimer(t.deps, await t.claim(id));
        const state = await t.state(id);
        expect(state.attempts).toBe(n);
        if (n < TIMER_MAX_ATTEMPTS) {
          expect([outcome, state.status]).toEqual(["retry", "scheduled"]);
          backoffs.push(state.retrySec);
        } else {
          expect([outcome, state.status]).toEqual(["failed", "failed"]);
        }
      }
      expect(backoffs).toEqual([60, 120, 300, 900, 1800]);
      expect(t.ports.alerts).toEqual([
        {
          rule: "timer.failed",
          dimension: plain,
          severity: "P2",
          detail: expect.objectContaining({ timerId: id }),
        },
      ]);
      // failed 不再被扫描认领
      await t.hasten(id);
      expect(await t.claim(id)).toBeUndefined();
    },
    SLOW,
  );

  it(
    "关键类不进终态：次数耗尽后回到 scheduled、每 30 分钟重试，并升级告警",
    async () => {
      control.failing.add(revivable);
      const { id } = await t.arm(revivable);
      for (let n = 1; n <= TIMER_MAX_ATTEMPTS + 2; n += 1) {
        await t.hasten(id);
        expect(await runTimer(t.deps, await t.claim(id))).toBe("retry");
        const state = await t.state(id);
        expect(state).toMatchObject({ status: "scheduled", attempts: n });
        if (n >= 5) expect(state.retrySec).toBe(1800);
      }
      expect(t.ports.alerts.map((alert) => [alert.rule, alert.dimension, alert.severity])).toEqual(
        Array.from({ length: 3 }, () => ["timer.critical_retrying", revivable, "P1"]),
      );
    },
    SLOW,
  );

  it(
    "dispatch_no 不符、已取消：直接结束，不调处理器",
    async () => {
      const { id, subject } = await t.arm(plain);
      const old = await t.claim(id);
      await t.hasten(id);
      const current = await t.claim(id);
      expect([old.dispatchNo, current.dispatchNo]).toEqual([1, 2]);
      expect(await runTimer(t.deps, old)).toBe("stale");
      expect(control.calls).toEqual([]);

      await t.deps.tx.run((tx) => t.timers.cancel(tx, { subject }));
      expect(await runTimer(t.deps, current)).toBe("stale");
      expect(control.calls).toEqual([]);
      expect(await t.state(id)).toMatchObject({ status: "cancelled", attempts: 0 });
    },
    SLOW,
  );

  it(
    "同一次认领被并发触发 6 次（C8）：到期动作恰好一次，行落在 fired",
    async () => {
      for (let round = 0; round < 5; round += 1) {
        const before = (await counts())[plain];
        const { id } = await t.arm(plain);
        const ref = await t.claim(id);
        const fired = await deliverRepeatedly((one) => runTimer(t.deps, one), ref, {
          times: 6,
          mode: "concurrent",
        });
        expect(fired.rejected).toEqual([]);
        expect(fired.fulfilled.filter((one) => one === "fired")).toHaveLength(1);
        expect(new Set(fired.fulfilled)).toEqual(
          new Set(["fired", ...fired.fulfilled.filter((one) => one !== "fired")]),
        );
        expect(fired.fulfilled.every((one) => ["fired", "skipped", "stale"].includes(one))).toBe(
          true,
        );
        expect(await t.state(id)).toMatchObject({ status: "fired", attempts: 0 });
        expect((await counts())[plain]).toBe(before + 1);
      }
    },
    SLOW,
  );
});

describe("处理器的登记字段", () => {
  // 处理器要用到 timers，而 timers 要等装配完才有：先留个位置，装配后填上
  const late: { timers?: Timers } = {};
  const custom = workerTimers({
    extra: [
      defineRegistration("lyxtest_worker", {
        timerHandlers: [
          // 晚了 10 分钟以上就跳过
          { kind: plain, maxLateMinutes: 10, handle: async () => "fired" },
          // 处理器里取消同一主体上未完成的定时器：正在执行的这一条要被跳过
          {
            kind: revivable,
            critical: true,
            handle: async (tx, timer) => {
              const subject = { type: timer.subjectType as string, id: timer.subjectId as string };
              await late.timers?.cancel(tx, { subject });
              return "fired";
            },
          },
        ],
      }),
    ],
  });
  late.timers = custom.timers;

  beforeAll(async () => custom.attach(await db.prisma()), SLOW);
  beforeEach(() => custom.reset(), SLOW);

  it(
    "maxLateMinutes：触发时已晚于上限即 skipped，不调处理器；没晚的照常",
    async () => {
      const onTime = await custom.arm(plain);
      custom.clock.advance(10 * 60_000);
      expect(await runTimer(custom.deps, await custom.claim(onTime.id))).toBe("fired");
      const late = await custom.arm(plain);
      custom.clock.advance(10 * 60_000 + 1);
      expect(await runTimer(custom.deps, await custom.claim(late.id))).toBe("skipped");
      expect(await custom.state(late.id)).toMatchObject({ status: "skipped", fired: true });
    },
    SLOW,
  );

  it(
    "处理器里的 cancel 跳过正在执行的这一条：它照常落在 fired",
    async () => {
      const { id } = await custom.arm(revivable);
      expect(await runTimer(custom.deps, await custom.claim(id))).toBe("fired");
      expect(await custom.state(id)).toMatchObject({ status: "fired" });
    },
    SLOW,
  );
});

describe("扫描认领", () => {
  it(
    "租约过期重新认领：上一次已入队的记一次失败，没入队的不记；非关键类耗尽即 failed 并告警，关键类照常认领",
    async () => {
      const enqueued = await t.arm(plain);
      const notEnqueued = await t.arm(plain);
      const critical = await t.arm(revivable);
      expect(await scanDue(t.deps)).toMatchObject({ claimed: 3, enqueued: 3 });
      expect(t.channel.jobs.map((job) => [job.queue, job.jobId])).toContainEqual([
        TIMER_QUEUE,
        timerJobId({ timerId: enqueued.id, dispatchNo: 1, kind: plain }),
      ]);
      expect(await t.state(enqueued.id)).toMatchObject({
        status: "dispatched",
        isEnqueued: true,
        leaseSec: 300,
      });
      await prisma.$executeRawUnsafe(
        "UPDATE timer SET is_enqueued = false WHERE id = $1::uuid",
        notEnqueued.id,
      );

      await Promise.all([enqueued, notEnqueued, critical].map((one) => t.hasten(one.id)));
      await t.deps.tx.run((tx) => claimTimers(tx, t.timers.registry, t.clock.now()));
      expect(await t.state(enqueued.id)).toMatchObject({ dispatchNo: 2, attempts: 1 });
      expect(await t.state(notEnqueued.id)).toMatchObject({ dispatchNo: 2, attempts: 0 });

      // 处理器失联到第 6 次：非关键类在认领时就置 failed；关键类不设上限
      await prisma.$executeRawUnsafe(
        `UPDATE timer SET attempts = 5, is_enqueued = true, lease_until = now() - interval '1 second'
          WHERE id = ANY($1::uuid[])`,
        [enqueued.id, critical.id],
      );
      expect(await scanDue(t.deps)).toMatchObject({ claimed: 1, failed: 1 });
      expect(await t.state(enqueued.id)).toMatchObject({ status: "failed", attempts: 6 });
      expect(await t.state(critical.id)).toMatchObject({ status: "dispatched", attempts: 6 });
      expect(t.ports.alerts.map((alert) => [alert.rule, alert.dimension])).toEqual([
        ["timer.failed", plain],
      ]);
    },
    SLOW,
  );

  it(
    "入队失败：关键类在进程内执行；非关键类放回 scheduled、不计次数；连续不可用满 60 秒后非关键类也在进程内执行",
    async () => {
      const before = await counts();
      const critical = await t.arm(revivable);
      const normal = await t.arm(plain);
      Object.assign(t.channel, { down: true, downMs: 59_999 });
      expect(await scanDue(t.deps)).toMatchObject({
        claimed: 2,
        enqueued: 0,
        inProcess: 1,
        released: 1,
      });
      expect(await t.state(critical.id)).toMatchObject({ status: "fired", attempts: 0 });
      expect(await t.state(normal.id)).toMatchObject({
        status: "scheduled",
        attempts: 0,
        leaseSec: null,
        isEnqueued: false,
      });
      expect(await counts()).toMatchObject({
        [revivable]: before[revivable] + 1,
        [plain]: before[plain],
      });

      t.channel.downMs = 60_000;
      expect(await scanDue(t.deps)).toMatchObject({ claimed: 1, inProcess: 1, released: 0 });
      expect(await t.state(normal.id)).toMatchObject({ status: "fired", attempts: 0 });
      expect((await counts())[plain]).toBe(before[plain] + 1);
    },
    SLOW,
  );
});

describe("周期任务：tx 模式", () => {
  it(
    "认领本期时登记下一期；处理器从 ctx.tx 写库，运行摘要写进 result；抛错时业务写回滚并按定时器的规则重试",
    async () => {
      const before = (await counts())[every5];
      // 本期是很久以前漏下的一格；业务时钟的“现在”是 2026-03-01 08:02（北京时间）
      const slot = new Date("2026-02-20T00:00:00Z");
      t.clock.set(new Date("2026-03-01T00:02:00Z"));
      await t.deps.tx.run((tx) => armRecurringSlot(tx, every5, slot));
      const [row] = await timerRows(prisma, recurringKey(every5, slot));
      const id = row?.id as string;

      control.after = boom;
      const ref = await t.claim(id);
      // 下一期在认领时就有了，不等本期执行完；它是“现在”之后的第一格，中间漏掉的格不逐个补
      const next = recurringKey(every5, new Date("2026-03-01T00:05:00Z"));
      expect((await timerRows(prisma, next)).map((one) => one.status)).toEqual(["scheduled"]);
      expect(await timerRows(prisma, `${every5}:2026-02-20T00:05`)).toEqual([]);
      expect(await runTimer(t.deps, ref)).toBe("retry");
      expect((await counts())[every5]).toBe(before);

      delete control.after;
      await t.hasten(id);
      expect(await runTimer(t.deps, await t.claim(id))).toBe("fired");
      expect(await t.state(id)).toMatchObject({
        status: "fired",
        attempts: 1,
        result: { bumped: 1 },
      });
      expect((await counts())[every5]).toBe(before + 1);
      expect(
        control.calls.filter((call) => call === `${every5}:${slot.toISOString()}`),
      ).toHaveLength(2);
    },
    SLOW,
  );
});
