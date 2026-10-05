import type { PrismaClient } from "@liyoxi/db";
import { grantSchedule, termDates } from "@liyoxi/shared/period";
import { addDays, calendarDate, diffDays } from "@liyoxi/shared/time";
import fc from "fast-check";
import { beforeAll, describe, expect, it } from "vitest";

import {
  createFulfillHarness,
  dumpLedger,
  fulfillOrder,
  paidPlanOrder,
  useSeededDatabase,
} from "../../testing/index.js";
import type { FulfillHarness } from "../../testing/index.js";
import { billingInvariants } from "../invariants.js";
import { subscriptionInvariants } from "./invariants.js";

// 甲类的性质测试（验收 10 的前半；“任意并发度下入账结果相同”在付款侧）：
//   ① 任意实付、月数、起始日：发放计划 N 行，各行之和 = 实付，前 N−1 行相等、尾差在末行；发放日逐月递增、都在本期内。
//      不连库，固定种子、200 轮。
//   ② 任意实付、月数、开通时刻，前面有没有生效周期，重放任意多次：库里的发放计划合计 = 实付、尾差在末行，
//      首月批次成本 = 首行分摊；多调多少次结果与账本都不变；十条不变量 0 违规。连真库，缺省轮次少：
//   LYX_FC_RUNS=200 LYX_FC_SEED=42 pnpm --filter @liyoxi/services exec vitest run src/billing/subscription/schedule.property.test.ts
const seed = Number(process.env.LYX_FC_SEED ?? 20261006);
const pureRuns = { numRuns: Math.max(200, Number(process.env.LYX_FC_RUNS ?? 200)), seed };
const dbRuns = { numRuns: Number(process.env.LYX_FC_RUNS ?? 10), seed };

const SLOW = 600_000;
const DAY = 86_400_000;
const EPOCH = new Date("2026-01-01T00:00:00+08:00").getTime();

// 三年之内，偏向月末（锚定日 29、30、31 的周期）与闰年
const startDay = fc.oneof(
  fc.integer({ min: 0, max: 1095 }),
  fc.constantFrom(28, 29, 30, 58, 59, 364, 394, 423, 424, 789),
);

describe("发放计划的分摊（验收 10 的前半）", () => {
  it("任意实付、月数、起始日：各行之和 = 实付，尾差在末行，发放日逐月递增且都在本期内", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 2_000_000_000 }),
        fc.integer({ min: 1, max: 36 }),
        startDay,
        (payFen, months, day) => {
          const start = calendarDate(new Date(EPOCH + day * DAY));
          const term = termDates(start, months);
          const rows = grantSchedule(term, { monthlyPoints: 6600, payFen });
          const values = rows.map((row) => row.valueFen);
          const share = Math.floor(payFen / months);
          expect(rows).toHaveLength(months);
          expect(values.reduce((sum, value) => sum + value, 0)).toBe(payFen);
          expect(values.slice(0, -1).every((value) => value === share)).toBe(true);
          expect((values.at(-1) as number) - share).toBe(payFen - share * months);
          expect(rows[0]?.dueDate).toBe(start);
          for (const [index, row] of rows.entries()) {
            expect(row.monthNo).toBe(index);
            if (index > 0) {
              expect(diffDays(row.dueDate, rows[index - 1]?.dueDate as string)).toBeGreaterThan(0);
            }
            expect(diffDays(term.endDate, row.dueDate)).toBeGreaterThanOrEqual(0);
          }
          // 本期止于下一个边界的前一天：再续一个月，新一期从止日的次日起
          expect(termDates(addDays(term.endDate, 1), 1, term.anchorDay).startDate).toBe(
            addDays(term.endDate, 1),
          );
        },
      ),
      pureRuns,
    );
  });
});

describe("履约的性质（连库）", () => {
  const db = useSeededDatabase("services");
  let prisma: PrismaClient;
  let h: FulfillHarness;

  beforeAll(async () => {
    prisma = await db.prisma();
    h = createFulfillHarness(prisma);
  }, SLOW);

  it(
    "任意实付、月数、开通时刻、前面有没有生效周期：计划合计 = 实付，尾差在末行；重放多少次结果与账本都不变",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            day: startDay,
            minute: fc.integer({ min: 0, max: 1439 }),
            planCode: fc.constantFrom("basic", "pro", "flagship"),
            months: fc.constantFrom(1, 3, 12),
            payFen: fc.integer({ min: 1, max: 20_000_000 }),
            queued: fc.boolean(),
            replays: fc.integer({ min: 1, max: 3 }),
          }),
          async ({ day, minute, planCode, months, payFen, queued, replays }) => {
            const now = new Date(EPOCH + day * DAY + minute * 60_000);
            h.clock.set(now);
            const { entity } = await h.make.merchant({ verified: true });
            if (queued) await fulfillOrder(h, await paidPlanOrder(h, { entityId: entity.id }));
            const order = await paidPlanOrder(h, {
              entityId: entity.id,
              planCode,
              months,
              payFen,
              type: queued ? "plan_renew" : "plan_new",
            });

            const first = await fulfillOrder(h, order);
            expect(first).toMatchObject({
              replayed: false,
              result: { status: "done", queuedBehindActive: queued },
            });
            const term = await prisma.subscriptionTerm.findUniqueOrThrow({
              where: { sourceBillingOrderId: order.id },
            });
            const schedules = await prisma.grantSchedule.findMany({
              where: { subscriptionTermId: term.id },
              orderBy: { monthNo: "asc" },
            });
            const values = schedules.map((row) => row.valueFen);
            const share = Math.floor(payFen / months);
            expect(values).toHaveLength(months);
            expect(values.reduce((sum, value) => sum + value, 0)).toBe(payFen);
            expect(values.slice(0, -1).every((value) => value === share)).toBe(true);
            expect(term.priceTotalFen).toBe(payFen);
            expect(term.monthlyEquivFen).toBe(share);
            if (!queued) {
              // 起点与首月的应发时刻 = 账本时钟；首月批次的成本 = 首行分摊
              expect(term.startsAt).toEqual(now);
              expect(schedules[0]?.dueAt).toEqual(now);
              const lot = await prisma.pointLot.findUniqueOrThrow({
                where: { id: schedules[0]?.pointLotId as string },
              });
              expect(lot.costBasisFen).toBe(values[0]);
            } else {
              expect(schedules.every((row) => row.status === "pending")).toBe(true);
            }

            const settled = await dumpLedger(prisma, entity.id);
            for (let again = 0; again < replays; again += 1) {
              expect(await fulfillOrder(h, order)).toEqual({
                result: first.result,
                replayed: true,
              });
            }
            expect(await dumpLedger(prisma, entity.id)).toEqual(settled);

            for (const check of [...billingInvariants, ...subscriptionInvariants]) {
              const found = await h.tx.run((tx) =>
                check.run?.(tx, { entityIds: [entity.id] }, { now: h.clock.now() }),
              );
              expect(found, check.code).toEqual([]);
            }
          },
        ),
        dbRuns,
      );
    },
    SLOW,
  );
});
