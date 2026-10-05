import type { PrismaClient } from "@liyoxi/db";
import { beforeAll, describe, expect, it } from "vitest";

import { uuidv7 } from "../../kernel/index.js";
import {
  assertSnapshotsEqual,
  createFulfillHarness,
  dumpLedger,
  financeContext,
  fulfillOrder,
  paidPlanOrder,
  snapshotTables,
  topUp,
  useSeededDatabase,
} from "../../testing/index.js";
import type { FulfillHarness } from "../../testing/index.js";
import { billingInvariants } from "../invariants.js";
import { LedgerError } from "../ledger/index.js";
import { subscriptionInvariants } from "./invariants.js";

// 验收 4、5：付清后的履约。无生效订阅 → 建生效周期并当场发首月；已有生效周期 → 接在链尾的预约周期，到点由 advance 接续；
// 过期后重新开通 → origin = resume 并写 addon_resume；重复调用只履约一次；受阻不留残留。
// 种子里的专业版：月费 6,000 元、每月 6,600 积分；基础版：月费 3,000 元、每月 3,000 积分。

const SLOW = 180_000;
const at = (local: string): Date => new Date(`${local}+08:00`);
const TABLES = [
  "billing_account",
  "subscription_term",
  "subscription_event",
  "grant_schedule",
  "plan_promo_claim",
  "point_lot",
  "ledger_operation",
  "point_ledger_entry",
  "outbox_event",
];

const db = useSeededDatabase("services");
let prisma: PrismaClient;
let h: FulfillHarness;

beforeAll(async () => {
  prisma = await db.prisma();
  h = createFulfillHarness(prisma);
}, SLOW);

const outbox = async (entityId: string) =>
  (await prisma.outboxEvent.findMany({ where: { entityId }, orderBy: { seq: "asc" } })).map(
    (event) => ({
      type: event.eventType,
      aggregateType: event.aggregateType,
      dedupeKey: event.dedupeKey,
      payload: event.payload,
    }),
  );
const termOf = (billingOrderId: string) =>
  prisma.subscriptionTerm.findUniqueOrThrow({ where: { sourceBillingOrderId: billingOrderId } });
const schedulesOf = (subscriptionTermId: string) =>
  prisma.grantSchedule.findMany({ where: { subscriptionTermId }, orderBy: { monthNo: "asc" } });
const day = (value: Date): string => value.toISOString().slice(0, 10);

/** 两组不变量在这个主体上都 0 违规 */
async function expectClean(entityId: string): Promise<void> {
  for (const check of [...billingInvariants, ...subscriptionInvariants]) {
    const found = await h.tx.run((tx) =>
      check.run?.(tx, { entityIds: [entityId] }, { now: h.clock.now() }),
    );
    expect(found, check.code).toEqual([]);
  }
}

describe("fulfill：无生效订阅时付清套餐（验收 4）", () => {
  it(
    "建生效周期：起点是账本时钟、锚定日是当天几号；首月当场发放，批次成本 = 该月分摊；账户生效；三个事件",
    async () => {
      const now = at("2026-09-13T09:15:00");
      h.clock.set(now);
      const { entity } = await h.make.merchant({ verified: true });
      const staff = await h.make.staff();
      const order = await paidPlanOrder(h, { entityId: entity.id });

      const { result, replayed } = await fulfillOrder(
        h,
        order,
        financeContext(entity.id, staff.id),
      );
      const term = await termOf(order.id);
      const [first] = await schedulesOf(term.id);
      expect(replayed).toBe(false);
      expect(result).toEqual({
        status: "done",
        effectiveAt: now.toISOString(),
        termId: term.id,
        lotIds: [first?.pointLotId],
        queuedBehindActive: false,
        notes: [],
      });
      expect(term).toMatchObject({
        entityId: entity.id,
        termNo: 1,
        origin: "new",
        status: "active",
        months: 1,
        priceTotalFen: 600_000,
        monthlyEquivFen: 600_000,
        monthlyPoints: 6600,
        discountBp: 9000,
        productionModel: "advanced",
        maxStores: 3,
        maxMembers: 10,
        schedulePriority: "priority",
        hasMonthlyReport: true,
        anchorDay: 13,
        startsAt: now,
        activatedAt: now,
        endsAt: at("2026-10-13T00:00:00"),
      });
      expect([day(term.startDate), day(term.endDate)]).toEqual(["2026-09-13", "2026-10-12"]);
      expect(term.planRevisionId).toBe(term.initialPlanRevisionId);
      expect(first).toMatchObject({ monthNo: 0, status: "granted", dueAt: now, valueFen: 600_000 });

      const state = await dumpLedger(prisma, entity.id);
      expect(state.account).toMatchObject({
        subStatus: "active",
        currentTermNo: 1,
        planAvailableQty: 6600,
        nextDueAt: "2026-10-12T16:00:00.000Z",
      });
      expect(state.lots).toMatchObject([
        {
          kind: "plan",
          sourceType: "grant_monthly",
          grantedAt: now.toISOString(),
          expiresAt: "2026-10-12T16:00:00.000Z",
          originalQty: 6600,
          costBasisFen: 600_000,
        },
      ]);
      // 首月发放与履约登记都记在入账的操作人（财务）名下；履约只做登记，不动积分
      expect(state.operations).toMatchObject([
        { opType: "grant", titleCode: "grant_open", actorType: "staff", planDeltaQty: 6600 },
        {
          opType: "fulfill",
          refType: "billing_order",
          titleCode: null,
          actorType: "staff",
          planDeltaQty: 0,
          addonDeltaQty: 0,
          spendableAfterQty: 6600,
          occurredAt: now.toISOString(),
        },
      ]);
      expect(
        await prisma.ledgerOperation.findUniqueOrThrow({
          where: { opKey: `fulfill:billing_order:${order.id}` },
        }),
      ).toMatchObject({ refId: order.id, actorId: staff.id, client: "admin" });
      expect(
        await prisma.subscriptionEvent.findMany({ where: { entityId: entity.id } }),
      ).toMatchObject([
        {
          type: "activated",
          subscriptionTermId: term.id,
          billingOrderId: order.id,
          toPlanId: term.planId,
          toPlanRevisionId: term.planRevisionId,
          fromPlanId: null,
          occurredAt: now,
          actorType: "staff",
          actorId: staff.id,
        },
      ]);

      // 载荷六个键齐全（另有 v）；W1-17 按主体 id 给门店分配交付经理
      expect(await outbox(entity.id)).toEqual([
        expect.objectContaining({ type: "billing.points.granted" }),
        {
          type: "billing.subscription.activated",
          aggregateType: "subscription_term",
          dedupeKey: `billing.subscription.activated:${term.id}`,
          payload: {
            v: 1,
            termId: term.id,
            entityId: entity.id,
            planId: term.planId,
            startsAt: now.toISOString(),
            endsAt: "2026-10-12T16:00:00.000Z",
            sourceBillingOrderId: order.id,
          },
        },
        {
          type: "billing.order_fulfilled",
          aggregateType: "billing_order",
          dedupeKey: `ledger:fulfill:billing_order:${order.id}`,
          payload: {
            v: 1,
            billingOrderId: order.id,
            entityId: entity.id,
            contentType: "plan_new",
            termId: term.id,
          },
        },
      ]);
      // fulfill 不改付款单：履约状态由入账函数按返回值写回
      expect(
        await prisma.billingOrder.findUniqueOrThrow({ where: { id: order.id } }),
      ).toMatchObject({ fulfillmentStatus: "none", fulfilledAt: null });
      await expectClean(entity.id);
    },
    SLOW,
  );

  // 03 第 2.3 节的四行，另加闰年两行；实付除不尽月数时尾差在末行
  it.each([
    ["2026-09-13", 1, "2026-10-12", ["2026-09-13"]],
    ["2026-09-20", 3, "2026-12-19", ["2026-09-20", "2026-10-20", "2026-11-20"]],
    ["2027-01-31", 1, "2027-02-27", ["2027-01-31"]],
    ["2027-01-31", 3, "2027-04-29", ["2027-01-31", "2027-02-28", "2027-03-31"]],
    ["2028-01-31", 1, "2028-02-28", ["2028-01-31"]],
    ["2028-01-31", 3, "2028-04-29", ["2028-01-31", "2028-02-29", "2028-03-31"]],
  ] as const)(
    "锚定日：%s 起 %i 个月，本期止于 %s，各月发放日 %j；发放计划合计 = 实付，尾差在末行",
    async (start, months, end, dueDates) => {
      const now = at(`${start}T23:59:30`);
      h.clock.set(now);
      const { entity } = await h.make.merchant({ verified: true });
      const payFen = 600_000 * months + (months > 1 ? 2 : 0);
      const order = await paidPlanOrder(h, { entityId: entity.id, months, payFen });

      const { result } = await fulfillOrder(h, order);
      expect(result.status).toBe("done");
      const term = await termOf(order.id);
      const schedules = await schedulesOf(term.id);
      expect([day(term.startDate), day(term.endDate), term.anchorDay]).toEqual([
        start,
        end,
        Number(start.slice(8)),
      ]);
      expect(schedules.map((row) => day(row.dueDate))).toEqual(dueDates);
      // 第 0 个月的应发时刻 = 周期起点；其余 = 当月发放日 00:00（北京时间）
      expect(schedules.map((row) => row.dueAt)).toEqual(
        dueDates.map((date, monthNo) => (monthNo === 0 ? now : at(`${date}T00:00:00`))),
      );
      const values = schedules.map((row) => row.valueFen);
      expect(values.reduce((sum, value) => sum + value, 0)).toBe(payFen);
      expect(values).toEqual(
        months === 1 ? [600_000] : [600_000, 600_000, 600_002].slice(0, months),
      );
      expect(schedules.map((row) => row.status)).toEqual(
        dueDates.map((_, monthNo) => (monthNo === 0 ? "granted" : "pending")),
      );
      expect(term.monthlyEquivFen).toBe(Math.floor(payFen / months));
      const lot = await prisma.pointLot.findFirstOrThrow({ where: { entityId: entity.id } });
      expect(lot.costBasisFen).toBe(values[0]);
      await expectClean(entity.id);
    },
    SLOW,
  );

  it(
    "过期后重新开通：推进先清零、停用；新周期 origin = resume、锚定日重置；另记 addon_resume，加购积分恢复可花",
    async () => {
      h.clock.set(at("2026-01-05T12:00:00"));
      const { entity } = await h.make.merchant({ verified: true });
      await fulfillOrder(h, await paidPlanOrder(h, { entityId: entity.id }));
      await topUp(h, { entityId: entity.id, points: 1000 });

      // 02-05 00:00 到期，没人推进；02-10 才续费：履约里的推进补上清零与停用，新周期自履约时刻起算
      const now = at("2026-02-10T10:00:00");
      h.clock.set(now);
      const order = await paidPlanOrder(h, { entityId: entity.id, type: "plan_renew" });
      const { result } = await fulfillOrder(h, order);
      const term = await termOf(order.id);
      expect(result).toMatchObject({ status: "done", queuedBehindActive: false, termId: term.id });
      expect(term).toMatchObject({
        termNo: 2,
        origin: "resume",
        status: "active",
        anchorDay: 10,
        startsAt: now,
      });
      expect([day(term.startDate), day(term.endDate)]).toEqual(["2026-02-10", "2026-03-09"]);

      const state = await dumpLedger(prisma, entity.id);
      expect(state.account).toMatchObject({
        subStatus: "active",
        currentTermNo: 2,
        planAvailableQty: 6600,
        addonAvailableQty: 1000,
      });
      expect(state.operations.map((op) => [op.opType, op.spendableAfterQty])).toEqual([
        ["grant", 6600],
        ["fulfill", 6600],
        ["purchase", 7600],
        ["expire", 0],
        ["addon_suspend", 0],
        ["grant", 7600],
        ["addon_resume", 7600],
        ["fulfill", 7600],
      ]);
      expect(
        await prisma.ledgerOperation.findFirstOrThrow({
          where: { entityId: entity.id, opType: "addon_resume" },
        }),
      ).toMatchObject({
        opKey: `resume:subscription_term:${term.id}:2026-03-09`,
        refType: "subscription_term",
        refId: term.id,
        titleCode: "addon_resume",
        titleArgs: { termEndDate: "2026-03-09" },
        occurredAt: now,
      });
      expect(state.subscriptionEvents.map((event) => [event.type, event.termNo])).toEqual([
        ["activated", 1],
        ["expired", 1],
        ["activated", 2],
      ]);
      await expectClean(entity.id);
    },
    SLOW,
  );
});

describe("fulfill：已有生效周期时付清套餐（验收 5）", () => {
  it(
    "建预约周期接在链尾、沿用锚定日、不发首月；换低版本记降级预约；到点由 advance 接续并发首月",
    async () => {
      h.clock.set(at("2026-01-05T12:00:00"));
      const { entity } = await h.make.merchant({ verified: true });
      const opened = await paidPlanOrder(h, { entityId: entity.id, months: 3 });
      await fulfillOrder(h, opened);
      const current = await termOf(opened.id);
      expect([day(current.startDate), day(current.endDate)]).toEqual(["2026-01-05", "2026-04-04"]);

      // 02-01 付清一张基础版的续费：排在本期之后，起点 = 本期止点，与付款时刻无关
      h.clock.set(at("2026-02-01T08:00:00"));
      const downgrade = await paidPlanOrder(h, {
        entityId: entity.id,
        planCode: "basic",
        type: "plan_renew",
      });
      const before = await dumpLedger(prisma, entity.id);
      const second = await fulfillOrder(h, downgrade);
      const queued = await termOf(downgrade.id);
      expect(second.result).toEqual({
        status: "done",
        effectiveAt: current.endsAt.toISOString(),
        termId: queued.id,
        lotIds: [],
        queuedBehindActive: true,
        notes: [],
      });
      expect(queued).toMatchObject({
        termNo: 2,
        origin: "renew",
        status: "scheduled",
        anchorDay: 5,
        startsAt: current.endsAt,
        endsAt: at("2026-05-05T00:00:00"),
        activatedAt: null,
        monthlyPoints: 3000,
        maxStores: 1,
      });
      expect([day(queued.startDate), day(queued.endDate)]).toEqual(["2026-04-05", "2026-05-04"]);
      expect(await schedulesOf(queued.id)).toMatchObject([
        { monthNo: 0, status: "pending", dueAt: current.endsAt, valueFen: 300_000, points: 3000 },
      ]);
      // 账本只多一条履约登记：没有新批次，账户还在第一期上
      const after = await dumpLedger(prisma, entity.id);
      expect(after.lots).toEqual(before.lots);
      expect(after.account).toEqual(before.account);
      expect(after.operations.slice(before.operations.length)).toMatchObject([
        { opType: "fulfill", planDeltaQty: 0, spendableAfterQty: 6600 },
      ]);
      expect(
        await prisma.subscriptionEvent.findFirstOrThrow({
          where: { subscriptionTermId: queued.id },
        }),
      ).toMatchObject({
        type: "downgrade_scheduled",
        fromPlanId: current.planId,
        toPlanId: queued.planId,
        billingOrderId: downgrade.id,
      });
      expect((await outbox(entity.id)).slice(-2)).toEqual([
        {
          type: "billing.subscription.renewal_scheduled",
          aggregateType: "subscription_term",
          dedupeKey: `billing.subscription.renewal_scheduled:${queued.id}`,
          payload: {
            v: 1,
            termId: queued.id,
            entityId: entity.id,
            startsAt: current.endsAt.toISOString(),
            endsAt: "2026-05-04T16:00:00.000Z",
          },
        },
        expect.objectContaining({
          type: "billing.order_fulfilled",
          payload: expect.objectContaining({ contentType: "plan_renew", termId: queued.id }),
        }),
      ]);

      // 再付一张专业版：接在第二期后面（链尾），记续费预约
      const third = await paidPlanOrder(h, { entityId: entity.id, type: "plan_renew" });
      expect((await fulfillOrder(h, third)).result).toMatchObject({ queuedBehindActive: true });
      const tail = await termOf(third.id);
      expect(tail).toMatchObject({ termNo: 3, status: "scheduled", startsAt: queued.endsAt });
      expect([day(tail.startDate), day(tail.endDate)]).toEqual(["2026-05-05", "2026-06-04"]);
      expect(
        await prisma.subscriptionEvent.findFirstOrThrow({ where: { subscriptionTermId: tail.id } }),
      ).toMatchObject({ type: "renewal_scheduled", fromPlanId: queued.planId });
      await expectClean(entity.id);

      // 到点：第一期清零，第二期接续并发首月（基础版 3,000，成本 = 它的分摊）；再到点第三期接续
      h.clock.set(at("2026-04-05T00:01:00"));
      await h.tx.run((tx) => h.ledger.advance(tx, entity.id));
      expect((await dumpLedger(prisma, entity.id)).account).toMatchObject({
        subStatus: "active",
        currentTermNo: 2,
        planAvailableQty: 3000,
      });
      expect(await schedulesOf(queued.id)).toMatchObject([{ status: "granted" }]);
      h.clock.set(at("2026-05-05T00:01:00"));
      await h.tx.run((tx) => h.ledger.advance(tx, entity.id));
      expect((await dumpLedger(prisma, entity.id)).account).toMatchObject({
        currentTermNo: 3,
        planAvailableQty: 6600,
      });
      await expectClean(entity.id);
    },
    SLOW,
  );
});

describe("fulfill：只履约一次，受阻不留残留", () => {
  it(
    "同一张付款单再调：什么都不写，返回第一次的结果（生效周期与预约周期两种）",
    async () => {
      h.clock.set(at("2026-03-10T10:00:00"));
      const { entity } = await h.make.merchant({ verified: true });
      const first = await paidPlanOrder(h, { entityId: entity.id });
      const second = await paidPlanOrder(h, { entityId: entity.id, type: "plan_renew" });
      const results = [await fulfillOrder(h, first), await fulfillOrder(h, second)];

      // 过了几天再来（中间没有别的操作）：结果不变，九张表一行不多
      h.clock.set(at("2026-03-15T10:00:00"));
      const before = await snapshotTables(prisma, TABLES);
      for (const [index, order] of [first, second].entries()) {
        const again = await fulfillOrder(h, order);
        expect(again).toEqual({ result: results[index]?.result, replayed: true });
      }
      assertSnapshotsEqual(before, await snapshotTables(prisma, TABLES));
    },
    SLOW,
  );

  it(
    "首期优惠：快照带了才占用；已被另一张单占了照常履约并标注，重放时标注还在",
    async () => {
      h.clock.set(at("2026-03-10T10:00:00"));
      const { entity } = await h.make.merchant({ verified: true });
      const plain = await paidPlanOrder(h, { entityId: entity.id });
      const revisionId = (plain.contentSnapshot as { planRevisionId: string }).planRevisionId;
      const first = await paidPlanOrder(h, {
        entityId: entity.id,
        promoClaimRevisionId: revisionId,
      });
      const second = await paidPlanOrder(h, {
        entityId: entity.id,
        type: "plan_renew",
        promoClaimRevisionId: revisionId,
      });

      expect((await fulfillOrder(h, first)).result).toMatchObject({ status: "done", notes: [] });
      expect((await fulfillOrder(h, second)).result).toMatchObject({
        status: "done",
        queuedBehindActive: true,
        notes: ["promo_already_claimed"],
      });
      expect((await fulfillOrder(h, second)).result).toMatchObject({
        notes: ["promo_already_claimed"],
      });
      expect((await fulfillOrder(h, first)).result).toMatchObject({ notes: [] });
      expect(
        await prisma.planPromoClaim.findMany({ where: { entityId: entity.id } }),
      ).toMatchObject([{ planRevisionId: revisionId, billingOrderId: first.id }]);
    },
    SLOW,
  );

  it(
    "受阻：实收与应付不符、加购与升级的内容（M4 才履约）、快照指的修订不属于那个套餐、快照不合结构——都不留残留",
    async () => {
      h.clock.set(at("2026-03-10T10:00:00"));
      const { entity } = await h.make.merchant({ verified: true });
      const good = await paidPlanOrder(h, { entityId: entity.id });
      const content = good.contentSnapshot as Record<string, unknown>;
      const orders = {
        AMOUNT_MISMATCH: await paidPlanOrder(h, { entityId: entity.id, paidAmountFen: 599_999 }),
        topup: await h.make.billingOrder({
          entityId: entity.id,
          type: "topup",
          amountFen: 100_000,
          fulfillmentStatus: "none",
          fulfilledAt: null,
          contentSnapshot: { v: 1, kind: "topup", packId: uuidv7(), points: 1000, payFen: 100_000 },
        }),
        revision: await h.make.billingOrder({
          entityId: entity.id,
          amountFen: 600_000,
          fulfillmentStatus: "none",
          fulfilledAt: null,
          contentSnapshot: { ...content, planId: uuidv7() },
        }),
        malformed: await h.make.billingOrder({
          entityId: entity.id,
          amountFen: 600_000,
          fulfillmentStatus: "none",
          fulfilledAt: null,
        }),
      };
      const before = await snapshotTables(prisma, TABLES);
      const blocked = async (order: (typeof orders)[keyof typeof orders]) => {
        const outcome = await fulfillOrder(h, order);
        assertSnapshotsEqual(before, await snapshotTables(prisma, TABLES));
        return outcome.result;
      };
      expect(await blocked(orders.AMOUNT_MISMATCH)).toEqual({
        status: "blocked",
        reasonCode: "AMOUNT_MISMATCH",
        detail: { paidAmountFen: 599_999, payFen: 600_000 },
      });
      expect(await blocked(orders.topup)).toEqual({
        status: "blocked",
        reasonCode: "UNEXPECTED",
        detail: { problem: "content_kind_not_supported", kind: "topup" },
      });
      expect(await blocked(orders.revision)).toMatchObject({
        status: "blocked",
        reasonCode: "UNEXPECTED",
        detail: { problem: "plan_revision_mismatch" },
      });
      expect(await blocked(orders.malformed)).toMatchObject({
        status: "blocked",
        reasonCode: "UNEXPECTED",
        detail: { error: "ZodError" },
      });
      // 受阻之后账户锁、账本都没坏：正常的那张照常履约
      expect((await fulfillOrder(h, good)).result.status).toBe("done");
    },
    SLOW,
  );

  it(
    "没付清的付款单不履约：抛内部错误，整个事务回滚",
    async () => {
      const { entity } = await h.make.merchant({ verified: true });
      const order = await h.make.billingOrder({ entityId: entity.id, status: "pending_payment" });
      const before = await snapshotTables(prisma, TABLES);
      const error = await fulfillOrder(h, order).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(LedgerError);
      expect((error as LedgerError).reason).toBe("guard");
      assertSnapshotsEqual(before, await snapshotTables(prisma, TABLES));
    },
    SLOW,
  );
});
