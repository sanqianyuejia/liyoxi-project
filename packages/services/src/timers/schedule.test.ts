import { calendarDate, dayOfWeek, minuteOfDay, parseLocalDate } from "@liyoxi/shared/time";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { RecurringSchedule } from "../kernel/index.js";
import { recurringKey, scheduleProblem, slotAfter, slotAtOrBefore, slotText } from "./index.js";

// 栅格时刻的纯函数：固定例子（x01 第 4.2 节的几种节奏，跨日、跨月、跨年）与性质。不连库。
// 轮次与种子的约定同 kernel 的性质测试：
//   LYX_FC_RUNS=5000 LYX_FC_SEED=42 pnpm --filter @liyoxi/services exec vitest run src/timers/schedule.test.ts
const runs = {
  numRuns: Number(process.env.LYX_FC_RUNS ?? 200),
  seed: Number(process.env.LYX_FC_SEED ?? 20261005),
};

/** 北京时间的钟点写法 → 时刻 */
const bj = (text: string): Date => new Date(`${text}+08:00`);

describe("栅格时刻：固定例子（时刻都是北京时间）", () => {
  it.each<{ name: string; schedule: RecurringSchedule; now: string; last: string; next: string }>([
    {
      name: "每 5 分钟",
      schedule: { every: "minutes", minutes: 5 },
      now: "2026-01-05T12:03:20",
      last: "2026-01-05T12:00:00",
      next: "2026-01-05T12:05:00",
    },
    {
      name: "每 5 分钟，跨日又跨月",
      schedule: { every: "minutes", minutes: 5 },
      now: "2026-01-31T23:58:00",
      last: "2026-01-31T23:55:00",
      next: "2026-02-01T00:00:00",
    },
    {
      name: "每 10 分钟，正好落在格上：这一格算已到",
      schedule: { every: "minutes", minutes: 10 },
      now: "2026-03-01T08:40:00",
      last: "2026-03-01T08:40:00",
      next: "2026-03-01T08:50:00",
    },
    {
      name: "每小时",
      schedule: { every: "hour" },
      now: "2026-12-31T23:59:59",
      last: "2026-12-31T23:00:00",
      next: "2027-01-01T00:00:00",
    },
    {
      name: "每小时的第 20 分",
      schedule: { every: "hour", minute: 20 },
      now: "2026-06-01T10:05:00",
      last: "2026-06-01T09:20:00",
      next: "2026-06-01T10:20:00",
    },
    {
      name: "每日 00:00（billing.sweep.daily）",
      schedule: { every: "day", at: "00:00" },
      now: "2026-02-28T15:00:00",
      last: "2026-02-28T00:00:00",
      next: "2026-03-01T00:00:00",
    },
    {
      name: "每日 10:30，还没到今天的点",
      schedule: { every: "day", at: "10:30" },
      now: "2026-03-01T09:00:00",
      last: "2026-02-28T10:30:00",
      next: "2026-03-01T10:30:00",
    },
    {
      name: "每周一 09:00（patrol.weekly_generate），周四问",
      schedule: { every: "week", weekday: 1, at: "09:00" },
      now: "2026-01-01T12:00:00",
      last: "2025-12-29T09:00:00",
      next: "2026-01-05T09:00:00",
    },
    {
      name: "每周一 09:00，周一 08:59 问",
      schedule: { every: "week", weekday: 1, at: "09:00" },
      now: "2026-01-05T08:59:00",
      last: "2025-12-29T09:00:00",
      next: "2026-01-05T09:00:00",
    },
    {
      name: "每月 1 日 10:00（calendar.coverage_check），跨年",
      schedule: { every: "month", day: 1, at: "10:00" },
      now: "2026-12-15T00:00:00",
      last: "2026-12-01T10:00:00",
      next: "2027-01-01T10:00:00",
    },
    {
      name: "每月 20 日 00:00（analytics.partitions），1 月上旬问：上一格在去年 12 月",
      schedule: { every: "month", day: 20, at: "00:00" },
      now: "2026-01-05T12:00:00",
      last: "2025-12-20T00:00:00",
      next: "2026-01-20T00:00:00",
    },
  ])("$name", ({ schedule, now, last, next }) => {
    expect(scheduleProblem(schedule)).toBeUndefined();
    expect(slotAtOrBefore(schedule, bj(now))).toEqual(bj(last));
    expect(slotAfter(schedule, bj(now))).toEqual(bj(next));
  });

  it("键里的栅格时刻是 UTC 的 ISO 8601，秒精度", () => {
    const slot = bj("2026-01-06T03:30:00");
    expect(slotText(slot)).toBe("2026-01-05T19:30:00Z");
    expect(recurringKey("invariant.full", slot)).toBe("invariant.full:2026-01-05T19:30:00Z");
  });
});

describe("节奏的写法", () => {
  it.each<{ schedule: unknown; problem: RegExp }>([
    { schedule: undefined, problem: /没有写节奏/ },
    { schedule: { every: "minutes", minutes: 0 }, problem: /minutes/ },
    { schedule: { every: "minutes", minutes: 2.5 }, problem: /minutes/ },
    { schedule: { every: "hour", minute: 60 }, problem: /minute/ },
    { schedule: { every: "day", at: "24:00" }, problem: /HH:mm/ },
    { schedule: { every: "day", at: "9:00" }, problem: /HH:mm/ },
    { schedule: { every: "week", weekday: 0, at: "09:00" }, problem: /weekday/ },
    { schedule: { every: "month", day: 29, at: "09:00" }, problem: /1 到 28/ },
    { schedule: { every: "year" }, problem: /every/ },
  ])("$schedule 不合法", ({ schedule, problem }) => {
    expect(scheduleProblem(schedule as RecurringSchedule)).toMatch(problem);
  });
});

const hm = fc
  .tuple(fc.integer({ min: 0, max: 23 }), fc.integer({ min: 0, max: 59 }))
  .map(([hour, minute]) => `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`);

const scheduleArb: fc.Arbitrary<RecurringSchedule> = fc.oneof(
  fc.record({ every: fc.constant("minutes" as const), minutes: fc.integer({ min: 1, max: 1440 }) }),
  fc.record({ every: fc.constant("hour" as const), minute: fc.integer({ min: 0, max: 59 }) }),
  fc.record({ every: fc.constant("day" as const), at: hm }),
  fc.record({
    every: fc.constant("week" as const),
    weekday: fc.integer({ min: 1, max: 7 }),
    at: hm,
  }),
  fc.record({
    every: fc.constant("month" as const),
    day: fc.integer({ min: 1, max: 28 }),
    at: hm,
  }),
);

/** 2020 年到 2040 年之间的任一毫秒 */
const instantArb = fc
  .integer({ min: Date.UTC(2020, 0, 1), max: Date.UTC(2040, 0, 1) })
  .map((ms) => new Date(ms));

describe("栅格时刻：性质", () => {
  it("最近一格不晚于现在，下一格晚于现在，两格之间没有别的格", () => {
    fc.assert(
      fc.property(scheduleArb, instantArb, (schedule, now) => {
        const last = slotAtOrBefore(schedule, now);
        const next = slotAfter(schedule, now);
        expect(last.getTime()).toBeLessThanOrEqual(now.getTime());
        expect(next.getTime()).toBeGreaterThan(now.getTime());
        // 格上的时刻是自己那一格；下一格的前一毫秒还属于上一格
        expect(slotAtOrBefore(schedule, last)).toEqual(last);
        expect(slotAfter(schedule, last)).toEqual(next);
        expect(slotAtOrBefore(schedule, new Date(next.getTime() - 1))).toEqual(last);
        expect(slotAtOrBefore(schedule, next)).toEqual(next);
      }),
      runs,
    );
  });

  it("同一格里任意两个时刻算出的是同一期：两个实例的键相同", () => {
    fc.assert(
      fc.property(
        scheduleArb,
        instantArb,
        fc.double({ min: 0, max: 1, noNaN: true }),
        (schedule, now, ratio) => {
          const last = slotAtOrBefore(schedule, now);
          const next = slotAfter(schedule, now);
          const width = next.getTime() - last.getTime();
          const other = new Date(last.getTime() + Math.min(width - 1, Math.floor(width * ratio)));
          expect(recurringKey("lyxtest.any", slotAfter(schedule, other))).toBe(
            recurringKey("lyxtest.any", next),
          );
          expect(slotAtOrBefore(schedule, other)).toEqual(last);
        },
      ),
      runs,
    );
  });

  it("格都落在节奏写的钟点上（北京时间）", () => {
    fc.assert(
      fc.property(scheduleArb, instantArb, (schedule, now) => {
        for (const slot of [slotAtOrBefore(schedule, now), slotAfter(schedule, now)]) {
          expect(slot.getTime() % 60_000).toBe(0);
          const date = calendarDate(slot);
          const minute = minuteOfDay(slot);
          if (schedule.every === "hour") expect(minute % 60).toBe(schedule.minute ?? 0);
          if (schedule.every === "minutes") {
            expect((slot.getTime() / 60_000) % schedule.minutes).toBe(0);
          }
          if (schedule.every === "day" || schedule.every === "week" || schedule.every === "month") {
            const [hour, min] = schedule.at.split(":").map(Number);
            expect(minute).toBe(hour! * 60 + min!);
          }
          if (schedule.every === "week") expect(dayOfWeek(date)).toBe(schedule.weekday);
          if (schedule.every === "month") expect(parseLocalDate(date).day).toBe(schedule.day);
        }
      }),
      runs,
    );
  });
});
