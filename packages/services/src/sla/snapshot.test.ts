import type { PrismaClient } from "@liyoxi/db";
import { beforeAll, describe, expect, it } from "vitest";

import { createTxRunner } from "../kernel/index.js";
import type { TxRunner } from "../kernel/index.js";
import { seedWorkCalendar, useTestDatabase } from "../testing/index.js";
import { bj, HOURS, sampleSla, seed2026, SLOW } from "./__fixtures__/calendar.js";
import { CALENDAR_FALLBACK_RULE, currentCalendarVersion } from "./index.js";
import type { DueInput, DueResult } from "./index.js";

// 任务书 第 7 节验收 7：时限快照的五个键；calendarVersion 等于全表最大批次号；
// 日期超出已有日历时按周一至周五兜底，并调一次 alerts.raise。

const db = useTestDatabase("services");
const { sla, ports, clock } = sampleSla();
let prisma: PrismaClient;
let tx: TxRunner;

beforeAll(async () => {
  prisma = await db.prisma();
  tx = createTxRunner({ prisma, appEnv: "test" });
}, SLOW);

const due = (input: Partial<DueInput> & Pick<DueInput, "from">): Promise<DueResult> =>
  tx.run((handle) =>
    sla.dueAt(handle, {
      policy: "review.qualification",
      amount: 1,
      unit: "work_days",
      workHours: HOURS,
      ...input,
    }),
  );

describe("时限快照", () => {
  it(
    "表为空：全部按周一至周五兜底，批次号记 0，告警一次",
    async () => {
      const result = await due({ from: bj("2026-09-29T11:40") });
      expect(result.dueAt).toEqual(bj("2026-09-30T11:40"));
      expect(result.snapshot.calendarVersion).toBe(0);
      expect(result.fallbackDates).toEqual(["2026-09-29", "2026-09-30"]);
      expect(ports.alerts).toHaveLength(1);
      ports.alerts.length = 0;
    },
    SLOW,
  );

  it(
    "返回的快照恰有 policy、amount、unit、calendarVersion、computedAt 五个键；computedAt 取注入的时钟",
    async () => {
      await seed2026(prisma);
      clock.set(bj("2026-09-29T11:41"));
      const { snapshot, dueAt } = await due({ from: bj("2026-09-29T11:40") });
      expect(dueAt).toEqual(bj("2026-09-30T11:40"));
      expect(snapshot).toEqual({
        policy: "review.qualification",
        amount: 1,
        unit: "work_days",
        calendarVersion: 1,
        computedAt: "2026-09-29T03:41:00.000Z",
      });
      // same_day_cutoff 的 amount 是截止时刻距零点的分钟数，原样进快照
      const cutoff = await due({
        policy: "ticket.delivering",
        amount: 1080,
        unit: "same_day_cutoff",
        from: bj("2026-09-29T11:40"),
      });
      expect(cutoff.snapshot).toMatchObject({ policy: "ticket.delivering", amount: 1080 });
      expect(ports.alerts).toEqual([]);
    },
    SLOW,
  );

  it(
    "calendarVersion 等于全表最大的批次号，不是算到的那几天的批次号",
    async () => {
      // 一次后来的导入只改了春节那一天，批次号 3
      await seedWorkCalendar(prisma, {
        from: "2026-02-17",
        to: "2026-02-17",
        holidays: ["2026-02-17"],
        version: 3,
      });
      expect(await tx.run((handle) => currentCalendarVersion(handle))).toBe(3);
      const { snapshot } = await due({ from: bj("2026-09-29T11:40") });
      expect(snapshot.calendarVersion).toBe(3);
      // 自然单位不读日历，快照里照样带批次号
      const natural = await due({
        amount: 24,
        unit: "natural_hours",
        from: bj("2026-09-29T11:40"),
      });
      expect(natural.snapshot.calendarVersion).toBe(3);
    },
    SLOW,
  );
});

describe("日期超出已有日历", () => {
  it(
    "按周一至周五兜底，并调一次告警；带上用了兜底的日期",
    async () => {
      // 日历只铺到 2026-12-31（周四）。加 2 个工作日：2027-01-01（周五）、01-04（周一）都靠兜底
      const result = await due({ amount: 2, from: bj("2026-12-31T10:00") });
      expect(result.dueAt).toEqual(bj("2027-01-04T10:00"));
      expect(result.fallbackDates).toEqual([
        "2027-01-01",
        "2027-01-02",
        "2027-01-03",
        "2027-01-04",
      ]);
      expect(ports.alerts).toEqual([
        {
          rule: CALENDAR_FALLBACK_RULE,
          severity: "P2",
          detail: {
            policy: "review.qualification",
            count: 4,
            dates: ["2027-01-01", "2027-01-02", "2027-01-03", "2027-01-04"],
          },
        },
      ]);
      expect(result.snapshot.calendarVersion).toBe(3);
    },
    SLOW,
  );

  it(
    "自然单位不看日历：算到日历之外也不告警；日历之内的工作日时限也不告警",
    async () => {
      ports.alerts.length = 0;
      const natural = await due({ amount: 30, unit: "natural_days", from: bj("2026-12-31T10:00") });
      expect(natural.dueAt).toEqual(bj("2027-01-30T10:00"));
      await due({ from: bj("2026-09-30T08:15") });
      expect(ports.alerts).toEqual([]);
    },
    SLOW,
  );

  it(
    "算的范围比先读的那一段长：放大再读，结果照库里的日历，不把没读到的日期当成缺行",
    async () => {
      await seedWorkCalendar(prisma, { from: "2027-01-01", to: "2027-12-31", version: 3 });
      // 造一段 53 天的长假：2027-02-01 到 03-25 全放假。01-29（周五）加 1 个工作日 = 03-26（周五）
      const longBreak = Array.from({ length: 53 }, (_, index) => {
        const day = new Date(Date.UTC(2027, 1, 1 + index));
        return day.toISOString().slice(0, 10);
      });
      await seedWorkCalendar(prisma, {
        from: "2027-02-01",
        to: "2027-03-25",
        holidays: longBreak,
        version: 4,
      });
      ports.alerts.length = 0;
      const result = await due({ from: bj("2027-01-29T17:00") });
      expect(result.dueAt).toEqual(bj("2027-03-26T17:00"));
      expect(result.fallbackDates).toEqual([]);
      expect(result.snapshot.calendarVersion).toBe(4);
      // 200 个工作日：一次读够，同样不兜底
      const far = await due({ amount: 200, from: bj("2026-01-05T09:30") });
      expect(far.fallbackDates).toEqual([]);
      expect(ports.alerts).toEqual([]);
    },
    SLOW,
  );
});
