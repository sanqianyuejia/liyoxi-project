import { PricingSnapshotSchema } from "@liyoxi/contract";
import type { PrismaClient } from "@liyoxi/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createIdentityContext, isAppError, uuidv7 } from "../../kernel/index.js";
import {
  assertSnapshotsEqual,
  captureHold,
  connectTestDatabase,
  createLedgerHarness,
  dramaHoldInput,
  dumpLedger,
  holdDrama,
  joinLedger,
  openTerm,
  ownerContext,
  priceDrama,
  releaseHold,
  snapshotTables,
  topUp,
  useSeededDatabase,
} from "../../testing/index.js";
import type { LedgerHarness } from "../../testing/index.js";
import { HoldStateError, LedgerError } from "./index.js";

// 验收 5：扣减顺序与分摊。PRD 2.9 例 5（冻结 2,160 取套餐 1,920、加购 240）；先入账的套餐批次先用，再取加购；
// 已到期的批次不取；capture 与 release 同时作用于一张冻结单恰有一个成功。
// 另：锁内计价与快照、四种拒绝（套餐未生效、退款处理中、报价已变、积分不足）、一单多部任一部不成整单回滚、
// 广告与超次修改、过期之后照常扣减。

const SLOW = 180_000;
const LEDGER_TABLES = [
  "billing_account",
  "point_lot",
  "point_hold",
  "point_hold_alloc",
  "ledger_operation",
  "point_ledger_entry",
  "outbox_event",
];
const at = (local: string): Date => new Date(`${local}+08:00`);

const db = useSeededDatabase("services");
let prisma: PrismaClient;
let h: LedgerHarness;
let other: Awaited<ReturnType<typeof joinLedger>>;
let staffId: string;

beforeAll(async () => {
  prisma = await db.prisma();
  h = createLedgerHarness(prisma);
  other = await joinLedger(h, await db.url());
  staffId = (await h.make.staff()).id;
}, SLOW);

afterAll(async () => {
  await other?.close();
});

/** 开通了套餐（缺省专业版月付：每月 6,600，9 折）的商家 */
async function subscribed(options: { planCode?: string; months?: number } = {}) {
  const { entity, store, user } = await h.make.merchant({ verified: true });
  const { term } = await openTerm(h, { entityId: entity.id, ...options });
  return { entityId: entity.id, storeId: store.id, userId: user.id, term };
}

/** 一部定了单剧积分价的剧 */
async function dramaPriced(points: number): Promise<string> {
  const drama = await h.make.drama({ heatTier: "A" });
  await priceDrama(h, { dramaId: drama.id, points, staffId });
  return drama.id;
}

/** 把套餐积分调减到只剩 left（走账本的调整扣减） */
const leavePlanPoints = (entityId: string, have: number, left: number) =>
  h.tx.run((tx) =>
    h.ledger.adjust(tx, {
      entityId,
      approvalRequestId: uuidv7(),
      requestNo: `TZ-${uuidv7()}`,
      pointAdjustmentRequestId: uuidv7(),
      direction: "decrease",
      lotKind: "plan",
      points: have - left,
      reasonCode: "correction",
      ctx: createIdentityContext({ actor: { type: "system", job: "lyxtest.adjust" }, entityId }),
    }),
  );

const refusalOf = (run: Promise<unknown>): Promise<unknown> =>
  run.then(
    () => "没有被拒",
    (error: unknown) =>
      isAppError(error) ? error.error : error instanceof LedgerError ? error.reason : error,
  );

describe("冻结 hold：扣减顺序与分摊（验收 5）", () => {
  it(
    "PRD 2.9 例 5：套餐可用 1,920、加购 1,000，冻结 2,160 → 套餐 1,920、加购 240，加购剩 760；快照、操作行、流水、事件",
    async () => {
      h.clock.set(at("2026-01-05T12:00:00"));
      const who = await subscribed();
      await topUp(h, { entityId: who.entityId, points: 1000 });
      await leavePlanPoints(who.entityId, 6600, 1920);
      const dramaId = await dramaPriced(2400);

      const held = await holdDrama(h, {
        ...who,
        dramaId,
        expectS: 2160,
        ctx: ownerContext(who.entityId, who.userId),
      });
      expect(held).toMatchObject({ points: 2160, replayed: false, now: h.clock.now() });
      expect(held.allocations.map(({ lotKind, qty }) => [lotKind, qty])).toEqual([
        ["plan", 1920],
        ["addon", 240],
      ]);
      // 快照：P、R、T、S、价格来源、下单时的取消扣除比例与退回去向；与库里存的是同一份
      expect(held.snapshot).toMatchObject({
        v: 1,
        kind: "drama",
        dramaId,
        P: 2400,
        priceSource: { mode: "custom", tier: "A", tierRevisionId: null },
        termId: who.term.id,
        planModel: "advanced",
        discountBp: 9000,
        topModelSelected: false,
        surchargeBp: 0,
        S: 2160,
        formula: { code: "drama", args: { P: 2400, R: 9000, T: 0 } },
        cancelDeductionBp: {
          planConfirm: 1000,
          adAndSample: 3000,
          samplePending: 5000,
          postSample: null,
        },
        expiredTermRefund: { merchant: "addon", platform: "addon", qualification: "addon" },
        quotedAt: h.clock.now().toISOString(),
      });
      const stored = await prisma.pointHold.findUniqueOrThrow({ where: { id: held.pointHoldId } });
      expect(PricingSnapshotSchema.parse(stored.pricingSnapshot)).toEqual(held.snapshot);
      expect(stored).toMatchObject({
        status: "held",
        qty: 2160,
        purpose: "order_item",
        refType: "order_item",
        refId: held.refId,
        storeId: who.storeId,
        subscriptionTermId: who.term.id,
        heldAt: h.clock.now(),
        actorType: "merchant",
        actorId: who.userId,
      });

      const state = await dumpLedger(prisma, who.entityId);
      expect(state.account).toMatchObject({
        planAvailableQty: 0,
        addonAvailableQty: 760,
        heldTotalQty: 2160,
      });
      expect(state.operations.at(-1)).toMatchObject({
        opType: "hold",
        refType: "order_item",
        planDeltaQty: -1920,
        addonDeltaQty: -240,
        spendableAfterQty: 760,
        heldAfterQty: 2160,
        titleCode: "order_hold",
        actorType: "merchant",
      });
      expect(state.entries.slice(-2)).toMatchObject([
        { lotKind: "plan", fromBucket: "available", toBucket: "held", qty: 1920 },
        { lotKind: "addon", fromBucket: "available", toBucket: "held", qty: 240 },
      ]);
      const operation = await prisma.ledgerOperation.findUniqueOrThrow({
        where: { id: held.operationId },
      });
      expect(operation).toMatchObject({
        opKey: `hold:order_item:${held.refId}`,
        pointHoldId: held.pointHoldId,
        storeId: who.storeId,
      });
      expect(
        await prisma.pointLedgerEntry.count({
          where: { ledgerOperationId: held.operationId, pointHoldId: held.pointHoldId },
        }),
      ).toBe(2);
      expect(
        await prisma.outboxEvent.findFirstOrThrow({
          where: { entityId: who.entityId, eventType: "billing.points.held" },
        }),
      ).toMatchObject({
        aggregateType: "billing_account",
        aggregateId: who.entityId,
        dedupeKey: `ledger:hold:order_item:${held.refId}`,
        payload: {
          v: 1,
          entityId: who.entityId,
          pointHoldId: held.pointHoldId,
          points: 2160,
          refType: "order_item",
          refId: held.refId,
        },
      });
    },
    SLOW,
  );

  it(
    "先入账的套餐批次先用，取满才取下一个；套餐取完才动加购",
    async () => {
      h.clock.set(at("2026-01-05T12:00:00"));
      const who = await subscribed({ months: 3 });
      await topUp(h, { entityId: who.entityId, points: 1000 });
      // 第 2 个月的发放到了：两个套餐批次各 6,600，到期相同，入账一先一后
      h.clock.set(at("2026-02-05T09:00:00"));
      const dramaId = await dramaPriced(3000);
      const lots = async () =>
        (await dumpLedger(prisma, who.entityId)).lots.map((lot) => [
          lot.kind,
          lot.availableQty,
          lot.heldQty,
        ]);

      // 2,700 × 3 = 8,100：第一批取满 6,600，第二批取 1,500，加购不动
      for (let n = 0; n < 3; n += 1) await holdDrama(h, { ...who, dramaId });
      expect(await lots()).toEqual([
        ["plan", 0, 6600],
        ["addon", 1000, 0],
        ["plan", 5100, 1500],
      ]);
      // 再冻结两部（5,400）：第二批剩的 5,100 取完，再取加购 300
      const fourth = await holdDrama(h, { ...who, dramaId });
      const fifth = await holdDrama(h, { ...who, dramaId });
      expect(fourth.allocations.map(({ lotKind, qty }) => [lotKind, qty])).toEqual([
        ["plan", 2700],
      ]);
      expect(fifth.allocations.map(({ lotKind, qty }) => [lotKind, qty])).toEqual([
        ["plan", 2400],
        ["addon", 300],
      ]);
      expect(await lots()).toEqual([
        ["plan", 0, 6600],
        ["addon", 700, 300],
        ["plan", 0, 6600],
      ]);
    },
    SLOW,
  );

  it(
    "已到期的批次不取：恰在止点冻结，上一期没用完的先清零，只取新一期的；没有续费则套餐未生效",
    async () => {
      h.clock.set(at("2026-03-05T12:00:00"));
      const renewed = await subscribed();
      await openTerm(h, { entityId: renewed.entityId, after: renewed.term });
      const lapsed = await subscribed();
      await topUp(h, { entityId: lapsed.entityId, points: 5000 });
      const dramaId = await dramaPriced(2000);
      await holdDrama(h, { ...renewed, dramaId });

      // 止点（04-05 00:00）这一刻：上一期剩的 4,800 清零，新一期首月 6,600 到账
      h.clock.set(renewed.term.endsAt);
      const held = await holdDrama(h, { ...renewed, dramaId });
      const state = await dumpLedger(prisma, renewed.entityId);
      expect(
        state.lots.map((lot) => [lot.termNo, lot.availableQty, lot.heldQty, lot.expiredQty]),
      ).toEqual([
        [1, 0, 1800, 4800],
        [2, 4800, 1800, 0],
      ]);
      expect(held.snapshot.termId).not.toBe(renewed.term.id);
      expect(state.account).toMatchObject({ planAvailableQty: 4800, heldTotalQty: 3600 });

      // 没有续费的：套餐过期，加购积分停用，冻结被拒（还有 5,000 加购积分也不行）
      const before = await snapshotTables(prisma, ["point_hold", "point_ledger_entry"]);
      expect(await refusalOf(holdDrama(h, { ...lapsed, dramaId }))).toBe("SUBSCRIPTION_INACTIVE");
      assertSnapshotsEqual(
        before,
        await snapshotTables(prisma, ["point_hold", "point_ledger_entry"]),
      );
      // 被拒的事务整个回滚，连它里面做的推进一起；过期由下一次进入或每分钟的扫描落库
      await h.tx.run((tx) => h.ledger.advance(tx, lapsed.entityId));
      expect((await dumpLedger(prisma, lapsed.entityId)).account).toMatchObject({
        subStatus: "expired",
        addonAvailableQty: 5000,
      });
    },
    SLOW,
  );

  it(
    "capture 与 release 同时作用于一张冻结单：恰有一个成功，另一个得到 HoldStateError（重复 10 次）",
    async () => {
      h.clock.set(at("2026-05-05T12:00:00"));
      const who = await subscribed();
      const dramaId = await dramaPriced(500);
      const winners: string[] = [];
      for (let round = 0; round < 10; round += 1) {
        const held = await holdDrama(h, { ...who, dramaId });
        // 两条独立连接；轮流谁先发
        const pair = [
          () => captureHold(h, held.pointHoldId),
          () => releaseHold(other, held.pointHoldId),
        ];
        if (round % 2 === 1) pair.reverse();
        const outcomes = await Promise.allSettled(pair.map((run) => run()));
        const won = outcomes.filter((outcome) => outcome.status === "fulfilled");
        const lost = outcomes.filter((outcome) => outcome.status === "rejected");
        expect(won).toHaveLength(1);
        expect(lost).toHaveLength(1);
        expect(lost[0]?.reason).toBeInstanceOf(HoldStateError);
        expect(lost[0]?.reason).toMatchObject({
          reason: "not_held",
          pointHoldId: held.pointHoldId,
        });
        const { status } = await prisma.pointHold.findUniqueOrThrow({
          where: { id: held.pointHoldId },
        });
        expect(["captured", "released"]).toContain(status);
        expect(lost[0]?.reason).toMatchObject({ status });
        winners.push(status);
      }
      // 账面与赢的一方一致：扣减的进了已消耗，释放的回到可用
      const captured = winners.filter((status) => status === "captured").length;
      const state = await dumpLedger(prisma, who.entityId);
      expect(state.account).toMatchObject({
        planAvailableQty: 6600 - 450 * captured,
        heldTotalQty: 0,
      });
      expect(state.lotBuckets[0]).toMatchObject({ consumedQty: 450 * captured });
    },
    SLOW,
  );
});

describe("冻结 hold：锁内计价与拒绝", () => {
  it(
    "顶级模型加扣只对没含顶级模型的套餐：专业版 2,400 × 0.9 × 1.2 = 2,592；旗舰版不加扣；按模板价的剧取等级价",
    async () => {
      h.clock.set(at("2026-06-01T12:00:00"));
      const pro = await subscribed();
      const flagship = await subscribed({ planCode: "flagship" });
      const dramaId = await dramaPriced(2400);
      const byTier = await h.make.drama({ heatTier: "S" });

      const surcharged = await holdDrama(h, { ...pro, dramaId, topModel: true });
      expect(surcharged.snapshot).toMatchObject({
        S: 2592,
        topModelSelected: true,
        surchargeBp: 2000,
        formula: { args: { P: 2400, R: 9000, T: 2000 } },
      });
      const included = await holdDrama(h, { ...flagship, dramaId, topModel: true });
      expect(included.snapshot).toMatchObject({
        S: 1920,
        planModel: "top",
        topModelSelected: true,
        surchargeBp: 0,
      });
      const template = await holdDrama(h, { ...pro, dramaId: byTier.id });
      expect(template.snapshot).toMatchObject({
        P: 3000,
        S: 2700,
        priceSource: { mode: "template", tier: "S", dramaPriceRevisionId: null },
      });
    },
    SLOW,
  );

  it(
    "报价已变 QUOTE_CHANGED（带锁内重算的值）；积分不足 POINTS_INSUFFICIENT（带缺口）；取不到价；都不落一行",
    async () => {
      h.clock.set(at("2026-06-02T12:00:00"));
      const who = await subscribed({ planCode: "basic" });
      const dramaId = await dramaPriced(2000);
      const before = await snapshotTables(prisma, LEDGER_TABLES);

      const changed = await holdDrama(h, { ...who, dramaId, expectS: 1800 }).catch(
        (error: unknown) => error,
      );
      expect(changed).toMatchObject({
        error: "QUOTE_CHANGED",
        details: {
          kind: "points",
          totalChargePoints: 2000,
          items: [{ dramaId, chargePoints: 2000 }],
        },
      });

      // 基础版 3,000：冻结一部 2,000 之后只剩 1,000
      assertSnapshotsEqual(before, await snapshotTables(prisma, LEDGER_TABLES));
      await holdDrama(h, { ...who, dramaId, expectS: 2000 });
      const short = await holdDrama(h, { ...who, dramaId }).catch((error: unknown) => error);
      expect(short).toMatchObject({
        error: "POINTS_INSUFFICIENT",
        details: { requiredPoints: 2000, spendablePoints: 1000, shortfallPoints: 1000 },
      });

      // 没有热度等级、也没有单剧定价的剧：取不到价（上架的剧不该这样，按内部错误）
      const unpriced = await h.make.drama();
      expect(await refusalOf(holdDrama(h, { ...who, dramaId: unpriced.id }))).toBe(
        "price_unavailable",
      );
      // 业务引用的类型与计价入参对不上
      expect(
        await refusalOf(
          h.tx.run((tx) =>
            h.ledger.hold(tx, {
              ...dramaHoldInput({ ...who, dramaId, refId: uuidv7() }),
              refType: "ad",
            }),
          ),
        ),
      ).toBe("guard");
      expect((await dumpLedger(prisma, who.entityId)).holds).toHaveLength(1);
    },
    SLOW,
  );

  it(
    "一单多部：同一事务里逐部冻结，用同一把锁与同一个时钟；任一部不成，整单回滚",
    async () => {
      h.clock.set(at("2026-06-03T12:00:00"));
      const who = await subscribed();
      const [cheap, dear] = [await dramaPriced(2000), await dramaPriced(6000)];
      const order = (dramaIds: string[]) =>
        h.tx.run(async (tx) => {
          const held = [];
          for (const dramaId of dramaIds) {
            held.push(
              await h.ledger.hold(tx, dramaHoldInput({ ...who, dramaId, refId: uuidv7() })),
            );
          }
          return held;
        });

      const before = await snapshotTables(prisma, LEDGER_TABLES);
      // 1,800 + 5,400 = 7,200 > 6,600：第二部不足，第一部也不留
      expect(await refusalOf(order([cheap, dear]))).toBe("POINTS_INSUFFICIENT");
      assertSnapshotsEqual(before, await snapshotTables(prisma, LEDGER_TABLES));

      const held = await order([cheap, cheap, cheap]);
      expect(held.map((item) => item.points)).toEqual([1800, 1800, 1800]);
      expect(new Set(held.map((item) => item.now.getTime())).size).toBe(1);
      expect((await dumpLedger(prisma, who.entityId)).account).toMatchObject({
        planAvailableQty: 1200,
        heldTotalQty: 5400,
      });
    },
    SLOW,
  );

  it(
    "退款处理中（主体级闸门）：冻结被拒；扣减与释放不受影响，操作行上的可花为 0",
    async () => {
      h.clock.set(at("2026-06-04T12:00:00"));
      const who = await subscribed();
      const dramaId = await dramaPriced(1000);
      const [first, second] = [
        await holdDrama(h, { ...who, dramaId }),
        await holdDrama(h, { ...who, dramaId }),
      ];
      // 套餐退款在 M4，退款申请没有工厂：摘掉外键，直接在周期上摆出标记
      const owner = await connectTestDatabase(db.name, { role: null });
      try {
        await owner.query(
          "ALTER TABLE subscription_term DROP CONSTRAINT fk_subscription_term_refund_request_id",
        );
        await owner.query(
          "UPDATE subscription_term SET refund_request_id = $2, refund_rule = 'window' WHERE id = $1",
          [who.term.id, uuidv7()],
        );
      } finally {
        await owner.end();
      }
      expect(await refusalOf(holdDrama(h, { ...who, dramaId }))).toBe("PLAN_REFUND_IN_PROGRESS");
      await captureHold(h, first.pointHoldId);
      await releaseHold(h, second.pointHoldId);
      const state = await dumpLedger(prisma, who.entityId);
      expect(state.operations.slice(-2)).toMatchObject([
        { opType: "capture", planDeltaQty: 0, spendableAfterQty: 0, heldAfterQty: 900 },
        { opType: "release", planDeltaQty: 900, spendableAfterQty: 0, heldAfterQty: 0 },
      ]);
      expect(state.account).toMatchObject({ planAvailableQty: 5700, heldTotalQty: 0 });
    },
    SLOW,
  );
});

describe("扣减 capture、广告与超次修改", () => {
  it(
    "扣减：冻结 → 已消耗，可用不变；再扣一次是重放；周期结束后照常扣减（冻结时已视为使用）",
    async () => {
      h.clock.set(at("2026-07-05T12:00:00"));
      const who = await subscribed();
      const dramaId = await dramaPriced(2000);
      const [now, later] = [
        await holdDrama(h, { ...who, dramaId }),
        await holdDrama(h, { ...who, dramaId }),
      ];

      const captured = await captureHold(h, now.pointHoldId);
      expect(captured).toMatchObject({ points: 1800, replayed: false });
      const before = await snapshotTables(prisma, LEDGER_TABLES);
      expect(await captureHold(h, now.pointHoldId)).toEqual({ ...captured, replayed: true });
      assertSnapshotsEqual(before, await snapshotTables(prisma, LEDGER_TABLES));
      let state = await dumpLedger(prisma, who.entityId);
      expect(state.account).toMatchObject({ planAvailableQty: 3000, heldTotalQty: 1800 });
      expect(state.holds[0]).toMatchObject({
        status: "captured",
        capturedAt: h.clock.now().toISOString(),
        closedAt: null,
      });
      expect(state.operations.at(-1)).toMatchObject({
        opType: "capture",
        planDeltaQty: 0,
        addonDeltaQty: 0,
        spendableAfterQty: 3000,
        heldAfterQty: 1800,
        titleCode: "capture",
      });
      expect(
        await prisma.outboxEvent.count({
          where: { entityId: who.entityId, eventType: "billing.points.captured" },
        }),
      ).toBe(1);

      // 周期结束、没有续费：可用的 3,000 清零，冻结的 1,800 留在原批次；之后开工照常扣减
      h.clock.set(at("2026-08-06T09:00:00"));
      await captureHold(h, later.pointHoldId);
      state = await dumpLedger(prisma, who.entityId);
      expect(state.account).toMatchObject({
        subStatus: "expired",
        planAvailableQty: 0,
        heldTotalQty: 0,
        lastExpiredQty: 3000,
      });
      expect(state.lots[0]).toMatchObject({ availableQty: 0, heldQty: 0, expiredQty: 3000 });
      expect(state.lotBuckets[0]).toMatchObject({ consumedQty: 3600 });
      expect(state.operations.at(-1)).toMatchObject({ opType: "capture", spendableAfterQty: 0 });
    },
    SLOW,
  );

  it(
    "广告：每条 50 × 9 折 = 45，快照带单价、免费修改次数与制作中取消的扣除比例；超次修改即扣即消耗",
    async () => {
      h.clock.set(at("2026-09-05T12:00:00"));
      const who = await subscribed();
      const ctx = ownerContext(who.entityId, who.userId);
      const ad = await h.tx.run((tx) =>
        h.ledger.hold(tx, {
          entityId: who.entityId,
          storeId: who.storeId,
          refType: "ad",
          refId: uuidv7(),
          groupRef: "GG-TEST",
          pricing: { kind: "ad" },
          expectS: 45,
          title: { code: "ad_hold", args: { adNo: "GG-TEST", unitPoints: 50, discountBp: 9000 } },
          ctx,
        }),
      );
      expect(ad.snapshot).toEqual({
        v: 1,
        kind: "ad",
        unitPoints: 50,
        freeRevisions: 2,
        termId: who.term.id,
        planId: who.term.planId,
        planRevisionId: who.term.planRevisionId,
        planModel: "advanced",
        discountBp: 9000,
        S: 45,
        formula: { code: "ad", args: { unitPoints: 50, R: 9000 } },
        cancelDeductionBp: { adInProduction: 10_000 },
        expiredTermRefund: { merchant: "addon", platform: "addon", qualification: "addon" },
        quotedAt: h.clock.now().toISOString(),
      });

      const revisionId = uuidv7();
      const charge = () =>
        h.tx.run((tx) =>
          h.ledger.charge(tx, {
            entityId: who.entityId,
            storeId: who.storeId,
            refType: "ad_revision",
            refId: revisionId,
            pricing: { kind: "ad_revision" },
            title: {
              code: "ad_revision_charge",
              args: { adNo: "GG-TEST", unitPoints: 50, discountBp: 9000 },
            },
            captureTitle: { refType: "ad_revision", refNo: "GG-TEST", count: 1 },
            ctx,
          }),
        );
      const charged = await charge();
      expect(charged.snapshot).toMatchObject({ kind: "ad_revision", S: 45 });
      expect(charged.snapshot).not.toHaveProperty("cancelDeductionBp");
      expect((await charge()).replayed).toBe(true);
      const state = await dumpLedger(prisma, who.entityId);
      expect(state.holds.map((hold) => [hold.refType, hold.status, hold.qty])).toEqual([
        ["ad", "held", 45],
        ["ad_revision", "captured", 45],
      ]);
      expect(state.operations.slice(-2).map((op) => [op.opType, op.titleCode])).toEqual([
        ["hold", "ad_revision_charge"],
        ["capture", "capture"],
      ]);
      expect(state.account).toMatchObject({ planAvailableQty: 6510, heldTotalQty: 45 });
    },
    SLOW,
  );
});
