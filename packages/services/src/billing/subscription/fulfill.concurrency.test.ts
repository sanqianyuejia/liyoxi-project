import type { PrismaClient } from "@liyoxi/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createFulfillHarness,
  fulfillOrder,
  joinFulfillment,
  paidPlanOrder,
  useSeededDatabase,
} from "../../testing/index.js";
import type { FulfillHarness } from "../../testing/index.js";
import { billingInvariants } from "../invariants.js";
import { subscriptionInvariants } from "./invariants.js";

// 甲类的并发测试（履约这一层；同一笔收款经入账函数的并发在付款侧）：
//   ① 同一张付款单四条连接同时履约：恰履约一次——周期 1 个、首月批次 1 个、fulfill 操作 1 行、两个事件各 1 条，
//      其余三方拿到的是第一次的结果（replayed）。
//   ② 同一主体的两张付款单同时履约：账户锁把它们排成先后，一张生效、一张排在后面，首尾相接。
//   ③ 履约与到点的推进扫描交错：没有死锁，结果与先后顺序无关地自洽（不变量 0 违规）。

const SLOW = 240_000;
const at = (local: string): Date => new Date(`${local}+08:00`);
const ROUNDS = 5;

const db = useSeededDatabase("services");
let prisma: PrismaClient;
let sides: FulfillHarness[];
let joined: Awaited<ReturnType<typeof joinFulfillment>>[];

beforeAll(async () => {
  prisma = await db.prisma();
  const first = createFulfillHarness(prisma);
  const url = await db.url();
  joined = [
    await joinFulfillment(first, url),
    await joinFulfillment(first, url),
    await joinFulfillment(first, url),
  ];
  sides = [first, ...joined];
}, SLOW);

afterAll(async () => {
  await Promise.all((joined ?? []).map((side) => side.close()));
});

const h = (): FulfillHarness => sides[0] as FulfillHarness;

async function expectClean(entityId: string): Promise<void> {
  for (const check of [...billingInvariants, ...subscriptionInvariants]) {
    const found = await h().tx.run((tx) =>
      check.run?.(tx, { entityIds: [entityId] }, { now: h().clock.now() }),
    );
    expect(found, check.code).toEqual([]);
  }
}

const counts = async (entityId: string) => ({
  terms: await prisma.subscriptionTerm.count({ where: { entityId } }),
  schedules: await prisma.grantSchedule.count({ where: { entityId } }),
  lots: await prisma.pointLot.count({ where: { entityId } }),
  fulfills: await prisma.ledgerOperation.count({ where: { entityId, opType: "fulfill" } }),
  grants: await prisma.ledgerOperation.count({ where: { entityId, opType: "grant" } }),
  activated: await prisma.outboxEvent.count({
    where: { entityId, eventType: "billing.subscription.activated" },
  }),
  queued: await prisma.outboxEvent.count({
    where: { entityId, eventType: "billing.subscription.renewal_scheduled" },
  }),
  fulfilled: await prisma.outboxEvent.count({
    where: { entityId, eventType: "billing.order_fulfilled" },
  }),
});

describe("履约的并发", () => {
  it(
    `同一张付款单四条连接同时履约，重复 ${ROUNDS} 轮：恰履约一次，其余拿到第一次的结果`,
    async () => {
      h().clock.set(at("2026-01-05T12:00:00"));
      for (let round = 0; round < ROUNDS; round += 1) {
        const { entity } = await h().make.merchant({ verified: true });
        const order = await paidPlanOrder(h(), { entityId: entity.id, months: 3 });
        const outcomes = await Promise.all(sides.map((side) => fulfillOrder(side, order)));

        expect(outcomes.filter((outcome) => !outcome.replayed)).toHaveLength(1);
        for (const outcome of outcomes) expect(outcome.result).toEqual(outcomes[0]?.result);
        expect(outcomes[0]?.result).toMatchObject({ status: "done", queuedBehindActive: false });
        expect(await counts(entity.id), `第 ${round + 1} 轮`).toEqual({
          terms: 1,
          schedules: 3,
          lots: 1,
          fulfills: 1,
          grants: 1,
          activated: 1,
          queued: 0,
          fulfilled: 1,
        });
        await expectClean(entity.id);
      }
    },
    SLOW,
  );

  it(
    `同一主体的两张付款单同时履约，重复 ${ROUNDS} 轮：一张生效、一张排在后面，首尾相接`,
    async () => {
      h().clock.set(at("2026-01-05T12:00:00"));
      for (let round = 0; round < ROUNDS; round += 1) {
        const { entity } = await h().make.merchant({ verified: true });
        const orders = [
          await paidPlanOrder(h(), { entityId: entity.id }),
          await paidPlanOrder(h(), { entityId: entity.id, type: "plan_renew" }),
        ];
        const outcomes = await Promise.all(
          orders.map((order, index) => fulfillOrder(sides[index] as FulfillHarness, order)),
        );
        expect(
          outcomes
            .map((outcome) => outcome.result.status === "done" && outcome.result.queuedBehindActive)
            .sort(),
        ).toEqual([false, true]);
        const terms = await prisma.subscriptionTerm.findMany({
          where: { entityId: entity.id },
          orderBy: { termNo: "asc" },
        });
        expect(terms.map((term) => term.status)).toEqual(["active", "scheduled"]);
        expect(terms[1]?.startsAt).toEqual(terms[0]?.endsAt);
        expect(await counts(entity.id)).toMatchObject({
          lots: 1,
          fulfills: 2,
          activated: 1,
          queued: 1,
        });
        await expectClean(entity.id);
      }
    },
    SLOW,
  );

  it(
    `履约与到点的推进交错，重复 ${ROUNDS} 轮：没有死锁；续费落在本期之后或成为重新开通，两种结果都自洽`,
    async () => {
      for (let round = 0; round < ROUNDS; round += 1) {
        h().clock.set(at("2026-01-05T12:00:00"));
        const { entity } = await h().make.merchant({ verified: true });
        await fulfillOrder(h(), await paidPlanOrder(h(), { entityId: entity.id }));
        // 02-05 00:00 到期：同一刻，一边是每分钟扫描的推进（被占着就跳过），一边是续费的履约
        h().clock.set(at("2026-02-05T00:00:30"));
        const order = await paidPlanOrder(h(), { entityId: entity.id, type: "plan_renew" });
        const sweeper = sides[1] as FulfillHarness;
        const [outcome] = await Promise.all([
          fulfillOrder(h(), order),
          sweeper.tx.run((tx) => sweeper.ledger.advance(tx, entity.id, { wait: "skip" })),
        ]);
        // 本期已到止点：不管谁先，续费都成了“过期后重新开通”，从履约时刻起算
        expect(outcome.result).toMatchObject({ status: "done", queuedBehindActive: false });
        const terms = await prisma.subscriptionTerm.findMany({
          where: { entityId: entity.id },
          orderBy: { termNo: "asc" },
        });
        expect(terms.map((term) => [term.status, term.origin])).toEqual([
          ["ended", "new"],
          ["active", "resume"],
        ]);
        expect(
          await prisma.ledgerOperation.count({ where: { entityId: entity.id, opType: "expire" } }),
        ).toBe(1);
        await expectClean(entity.id);
      }
    },
    SLOW,
  );
});
