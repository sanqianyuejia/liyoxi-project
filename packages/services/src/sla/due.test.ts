import type { PrismaClient } from "@liyoxi/db";
import { beforeAll, describe, expect, it } from "vitest";

import { createTxRunner } from "../kernel/index.js";
import type { TxRunner } from "../kernel/index.js";
import { useTestDatabase } from "../testing/index.js";
import { bj, HOURS, sampleSla, seed2026, SLOW } from "./__fixtures__/calendar.js";
import { loadWorkCalendar, SLA_UNITS } from "./index.js";
import type { SlaUnit } from "./index.js";

// 任务书 第 7 节验收 6：跨节假日的时限。日历读自 work_calendar_day（2026 年：国庆 10-01 至 10-07 放假，
// 10-10 周六调休上班），工作时段 09:00–18:00。口径出自 D3 第 22.2 节的两个原型示例。时刻都是北京时间。

const db = useTestDatabase("services");
const { sla, ports } = sampleSla();
let prisma: PrismaClient;
let tx: TxRunner;

beforeAll(async () => {
  prisma = await db.prisma();
  tx = createTxRunner({ prisma, appEnv: "test" });
  await seed2026(prisma);
}, SLOW);

const due = (from: string, amount: number, unit: SlaUnit): Promise<Date> =>
  tx.run(async (handle) => {
    const result = await sla.dueAt(handle, {
      policy: "lyxtest.policy",
      amount,
      unit,
      from: bj(from),
      workHours: HOURS,
    });
    return result.dueAt;
  });

describe("跨节假日的时限", () => {
  it.each<{ name: string; from: string; amount: number; unit: SlaUnit; expected: string }>([
    {
      name: "09-30 08:15 加 1 个工作日 = 10-08 08:15（跨国庆；原型 admin/Verify）",
      from: "2026-09-30T08:15",
      amount: 1,
      unit: "work_days",
      expected: "2026-10-08T08:15",
    },
    {
      name: "09-29 11:40 加 1 个工作日 = 次日 11:40（原型 admin/Review）",
      from: "2026-09-29T11:40",
      amount: 1,
      unit: "work_days",
      expected: "2026-09-30T11:40",
    },
    {
      name: "调休上班日算工作日：10-09（周五）加 1 个工作日 = 10-10（周六）",
      from: "2026-10-09T10:00",
      amount: 1,
      unit: "work_days",
      expected: "2026-10-10T10:00",
    },
    {
      name: "放假当天提交：从节后第一个工作日的上班时刻起算",
      from: "2026-10-03T15:00",
      amount: 1,
      unit: "work_days",
      expected: "2026-10-09T09:00",
    },
    {
      name: "工作分钟跨国庆：09-30 17:00 加 120 分钟 = 10-08 10:00",
      from: "2026-09-30T17:00",
      amount: 120,
      unit: "work_minutes",
      expected: "2026-10-08T10:00",
    },
    {
      name: "工作分钟：下班后提交，从次日上班时刻起算",
      from: "2026-09-28T20:00",
      amount: 30,
      unit: "work_minutes",
      expected: "2026-09-29T09:30",
    },
    {
      name: "自然小时不看日历：09-30 08:15 加 24 小时 = 10-01 08:15（放假日）",
      from: "2026-09-30T08:15",
      amount: 24,
      unit: "natural_hours",
      expected: "2026-10-01T08:15",
    },
    {
      name: "自然日不看日历：09-30 08:15 加 3 天 = 10-03 08:15",
      from: "2026-09-30T08:15",
      amount: 3,
      unit: "natural_days",
      expected: "2026-10-03T08:15",
    },
    {
      name: "当日截止 18:00：没过截止时刻，落在当日",
      from: "2026-10-09T17:00",
      amount: 1080,
      unit: "same_day_cutoff",
      expected: "2026-10-09T18:00",
    },
    {
      name: "当日截止 18:00：过了截止时刻，落到下一个工作日（调休上班的周六）",
      from: "2026-10-09T18:30",
      amount: 1080,
      unit: "same_day_cutoff",
      expected: "2026-10-10T18:00",
    },
    {
      name: "当日截止 18:00：节前最后一天过了点，落到节后第一个工作日",
      from: "2026-09-30T18:00",
      amount: 1080,
      unit: "same_day_cutoff",
      expected: "2026-10-08T18:00",
    },
  ])(
    "$name",
    async ({ from, amount, unit, expected }) => {
      expect(await due(from, amount, unit)).toEqual(bj(expected));
    },
    SLOW,
  );

  it("五种单位各至少一例；日历范围之内不兜底，没有告警", () => {
    expect([...SLA_UNITS].sort()).toEqual(
      ["natural_days", "natural_hours", "same_day_cutoff", "work_days", "work_minutes"].sort(),
    );
    expect(ports.alerts).toEqual([]);
  });

  it(
    "工作分钟数：09-30 17:00 到 10-08 10:00 之间是 120 个工作分钟",
    async () => {
      const minutes = await tx.run((handle) =>
        sla.workMinutesBetween(handle, {
          from: bj("2026-09-30T17:00"),
          to: bj("2026-10-08T10:00"),
          workHours: HOURS,
        }),
      );
      expect(minutes).toBe(120);
    },
    SLOW,
  );

  it(
    "入参把关：policy 为空、单位不认识、工作时段写错都抛错",
    async () => {
      const call = (input: Record<string, unknown>): Promise<unknown> =>
        tx.run((handle) =>
          sla.dueAt(handle, {
            policy: "lyxtest.policy",
            amount: 1,
            unit: "work_days",
            from: bj("2026-09-29T11:40"),
            workHours: HOURS,
            ...input,
          }),
        );
      await expect(call({ policy: "" })).rejects.toThrow(/policy/);
      await expect(call({ unit: "work_weeks" })).rejects.toThrow(/时限单位/);
      await expect(call({ workHours: { start: "18:00", end: "09:00" } })).rejects.toThrow(
        /工作时段/,
      );
      await expect(call({ amount: -1 })).rejects.toThrow(RangeError);
    },
    SLOW,
  );

  it(
    "读日历：库里有的日期照库里的，没有的日期给 undefined（由纯函数兜底）",
    async () => {
      const calendar = await tx.run((handle) =>
        loadWorkCalendar(handle, { from: "2026-12-30", to: "2027-01-02" }, HOURS),
      );
      expect(calendar.isWorkday("2026-12-30")).toBe(true);
      expect(calendar.isWorkday("2026-10-10")).toBeUndefined(); // 不在读的这一段里
      expect(calendar.isWorkday("2027-01-01")).toBeUndefined(); // 库里没有
      expect([calendar.workStartMinute, calendar.workEndMinute]).toEqual([540, 1080]);
    },
    SLOW,
  );
});
