import type { PrismaClient } from "@liyoxi/db";
import { beforeAll, describe, expect, it } from "vitest";

import { uuidv7 } from "../kernel/index.js";
import type { InvariantViolation } from "../kernel/index.js";
import {
  assembleForTest,
  captureHold,
  connectTestDatabase,
  createLedgerHarness,
  holdDrama,
  openTerm,
  refundHold,
  releaseHold,
  topUp,
  useSeededDatabase,
} from "../testing/index.js";
import { billingInvariants } from "./invariants.js";
import type { LedgerHarness } from "../testing/index.js";

// 验收 10（不变量的一半）：账本内核的九条——各造一条违规都能查出；空库加种子、正常记账之后全量 0 违规。
// 经 ops 的框架跑全量的用例在 ops/invariants（billing 是 L2，不引 L4 的 ops）。
// 每条违规造在各自的主体上，按主体缩小范围来断言：同一个库里别的主体不受影响。

const SLOW = 180_000;
const MINUTE = 60_000;
const at = (local: string): Date => new Date(`${local}+08:00`);

const db = useSeededDatabase("services");
let prisma: PrismaClient;
let h: LedgerHarness;

beforeAll(async () => {
  prisma = await db.prisma();
  h = createLedgerHarness(prisma);
}, SLOW);

/** 跑一条检查；给了主体就只看它 */
async function run(
  code: string,
  entityId?: string,
  now = h.clock.now(),
): Promise<readonly InvariantViolation[]> {
  const check = billingInvariants.find((item) => item.code === code)?.run;
  if (check === undefined) throw new Error(`没有登记 ${code}`);
  return h.tx.run((tx) =>
    check(tx, entityId === undefined ? {} : { entityIds: [entityId] }, { now }),
  );
}
const runAll = async (now = h.clock.now()): Promise<Record<string, number>> => {
  const counts: Record<string, number> = {};
  for (const check of billingInvariants)
    counts[check.code] = (await run(check.code, undefined, now)).length;
  return counts;
};
const CLEAN = {
  "billing.I1": 0,
  "billing.I2": 0,
  "billing.I3": 0,
  "billing.I4": 0,
  "billing.I5": 0,
  "billing.I6": 0,
  "billing.I7": 0,
  "billing.I8": 0,
  "billing.I16": 0,
};

/** 一个记过账的主体：月付一期（首月已发），加购 1,000 */
async function merchantWithLedger(months = 1) {
  const { entity } = await h.make.merchant({ verified: true });
  const { term, schedules } = await openTerm(h, { entityId: entity.id, months });
  await topUp(h, { entityId: entity.id, points: 1000 });
  const planLot = await prisma.pointLot.findFirstOrThrow({
    where: { entityId: entity.id, kind: "plan" },
  });
  return { entityId: entity.id, term, schedules, planLot };
}

describe("billing 的不变量：账本内核的九条（验收 10）", () => {
  it("登记的是 I1–I8、I16：都只在 full 里跑、不自愈；关系数量的 P1，漏跑与顺序 P2", () => {
    expect(
      billingInvariants.map((check) => [check.code, check.severity, check.modes, check.heal]),
    ).toEqual([
      ["billing.I1", "P1", ["full"], "none"],
      ["billing.I2", "P1", ["full"], "none"],
      ["billing.I3", "P1", ["full"], "none"],
      ["billing.I4", "P1", ["full"], "none"],
      ["billing.I5", "P1", ["full"], "none"],
      ["billing.I6", "P2", ["full"], "none"],
      ["billing.I7", "P1", ["full"], "none"],
      ["billing.I8", "P2", ["full"], "none"],
      ["billing.I16", "P2", ["full"], "none"],
    ]);
  });

  it(
    "空库加种子 0 违规；发放、加购、冻结、扣减、释放、退回、清零、接续、过期之后仍是 0 违规；装配结果里收得到这九条",
    async () => {
      expect(await runAll()).toEqual(CLEAN);

      h.clock.set(at("2026-01-05T12:00:00"));
      const { entity, store } = await h.make.merchant({ verified: true });
      const first = await openTerm(h, { entityId: entity.id, months: 3 });
      await openTerm(h, { entityId: entity.id, after: first.term });
      await topUp(h, { entityId: entity.id, points: 500 });
      // 冻结三张（A 级模板价 2,000，专业版 9 折 = 1,800）：一张释放，一张扣减后部分退回，一张冻结着跨过期末再扣减
      const drama = await h.make.drama({ heatTier: "A" });
      const order = { entityId: entity.id, storeId: store.id, dramaId: drama.id };
      const [released, refunded, carried] = [
        await holdDrama(h, order),
        await holdDrama(h, order),
        await holdDrama(h, order),
      ];
      await releaseHold(h, released.pointHoldId);
      await captureHold(h, refunded.pointHoldId);
      await refundHold(h, { pointHoldId: refunded.pointHoldId, qty: 700 });
      expect(await runAll()).toEqual(CLEAN);
      for (const moment of ["2026-02-05T00:01:00", "2026-04-05T00:01:00", "2026-05-05T00:01:00"]) {
        h.clock.set(at(moment));
        await h.tx.run((tx) => h.ledger.advance(tx, entity.id));
      }
      // 原周期已结束：扣减照常；再退回的部分转为加购积分
      await captureHold(h, carried.pointHoldId);
      await refundHold(h, { pointHoldId: carried.pointHoldId, qty: 1800, reasonClass: "platform" });
      expect(await runAll()).toEqual(CLEAN);

      // 装配结果里收得到这九条（ops 的 invariant.full 按它调度；框架本身的用例在 ops/invariants）
      const registered = assembleForTest({ entry: "worker" }).invariants.map((check) => check.code);
      expect(registered).toEqual(
        expect.arrayContaining(billingInvariants.map((check) => check.code)),
      );
    },
    SLOW,
  );

  it(
    "I2：批次的桶被改过而没有流水——回放对不上；I3：账户缓存与批次对不上",
    async () => {
      h.clock.set(at("2026-06-01T12:00:00"));
      const a = await merchantWithLedger();
      await prisma.pointLot.update({
        where: { id: a.planLot.id },
        data: { availableQty: { decrement: 5 }, expiredQty: { increment: 5 } },
      });
      expect(await run("billing.I2", a.entityId)).toMatchObject([
        { subject: { type: "point_lot", id: a.planLot.id }, entityId: a.entityId },
      ]);
      // 桶改了、缓存没跟着改：I3 也报这个主体
      expect(await run("billing.I3", a.entityId)).toMatchObject([
        {
          subject: { type: "billing_account", id: a.entityId },
          detail: { cached: [6600, 1000, 0], recomputed: [6595, 1000, 0] },
        },
      ]);

      const b = await merchantWithLedger();
      await prisma.billingAccount.update({
        where: { entityId: b.entityId },
        data: { addonAvailableQty: { increment: 3 } },
      });
      expect(await run("billing.I3", b.entityId)).toMatchObject([
        { subject: { type: "billing_account", id: b.entityId }, entityId: b.entityId },
      ]);
      expect(await run("billing.I2", b.entityId)).toEqual([]);
    },
    SLOW,
  );

  it(
    "I6、I8：过了止点 10 分钟还没推进——批次还有可用、账户落后；I8：到了发放日 10 分钟还没发",
    async () => {
      h.clock.set(at("2026-06-02T12:00:00"));
      const a = await merchantWithLedger();
      const late = new Date(a.term.endsAt.getTime() + 11 * MINUTE);
      // 宽限之内不报
      expect(
        await run("billing.I6", a.entityId, new Date(a.term.endsAt.getTime() + 9 * MINUTE)),
      ).toEqual([]);
      expect(await run("billing.I6", a.entityId, late)).toMatchObject([
        { subject: { type: "point_lot", id: a.planLot.id }, detail: { availableQty: 6600 } },
      ]);
      expect(await run("billing.I8", a.entityId, late)).toMatchObject([
        {
          subject: { type: "billing_account", id: a.entityId },
          detail: { problem: "advance_overdue" },
        },
      ]);

      const b = await merchantWithLedger(3);
      const second = b.schedules[1];
      const overdue = new Date((second?.dueAt.getTime() ?? 0) + 11 * MINUTE);
      const found = await run("billing.I8", b.entityId, overdue);
      expect(found.map((item) => [item.subject, item.detail["problem"]])).toEqual(
        expect.arrayContaining([
          [{ type: "grant_schedule", id: second?.id }, "grant_overdue"],
          [{ type: "billing_account", id: b.entityId }, "advance_overdue"],
        ]),
      );
      expect(found).toHaveLength(2);
      // 推进之后就不报了
      h.clock.set(overdue);
      await h.tx.run((tx) => h.ledger.advance(tx, b.entityId));
      expect(await run("billing.I8", b.entityId, overdue)).toEqual([]);
    },
    SLOW,
  );

  it(
    "I7：套餐批次的到期 ≠ 周期止点；已到期的周期还留着待发放的计划",
    async () => {
      h.clock.set(at("2026-06-03T12:00:00"));
      const a = await merchantWithLedger();
      await prisma.pointLot.update({
        where: { id: a.planLot.id },
        data: { expiresAt: new Date(a.term.endsAt.getTime() + 86_400_000) },
      });
      expect(await run("billing.I7", a.entityId)).toMatchObject([
        { subject: { type: "point_lot", id: a.planLot.id }, detail: { problem: "lot_expiry" } },
      ]);

      const b = await merchantWithLedger();
      h.clock.set(new Date(b.term.endsAt.getTime() + MINUTE));
      await h.tx.run((tx) => h.ledger.advance(tx, b.entityId));
      expect(await run("billing.I7", b.entityId)).toEqual([]);
      await prisma.grantSchedule.update({
        where: { id: b.schedules[0]?.id as string },
        data: { status: "pending", pointLotId: null, grantedAt: null },
      });
      expect(await run("billing.I7", b.entityId)).toMatchObject([
        {
          subject: { type: "subscription_term", id: b.term.id },
          detail: { problem: "pending_schedule", status: "ended", pending: 1 },
        },
      ]);
    },
    SLOW,
  );

  it(
    "I16：流水的时刻比前一条早；流水的业务日不是它时刻的北京时间日期",
    async () => {
      h.clock.set(at("2026-06-04T12:00:00"));
      const insertEntry = async (
        target: Awaited<ReturnType<typeof merchantWithLedger>>,
        occurredAt: Date,
        bizDate: string,
      ): Promise<string> => {
        const operation = await prisma.ledgerOperation.findFirstOrThrow({
          where: { entityId: target.entityId },
          orderBy: { seq: "desc" },
        });
        const id = uuidv7();
        await prisma.pointLedgerEntry.create({
          data: {
            id,
            ledgerOperationId: operation.id,
            entityId: target.entityId,
            pointLotId: target.planLot.id,
            lotKind: "plan",
            planId: target.planLot.planId,
            fromBucket: "available",
            toBucket: "expired",
            qty: 1,
            occurredAt,
            bizDate: new Date(`${bizDate}T00:00:00.000Z`),
            createdAt: h.clock.now(),
          },
        });
        return id;
      };

      const a = await merchantWithLedger();
      const early = await insertEntry(a, at("2026-06-04T11:00:00"), "2026-06-04");
      expect(await run("billing.I16", a.entityId)).toMatchObject([
        {
          subject: { type: "billing_account", id: a.entityId },
          entityId: a.entityId,
          detail: { problem: "occurred_at_decreased", table: "point_ledger_entry", id: early },
        },
      ]);

      const b = await merchantWithLedger();
      const wrongDay = await insertEntry(b, at("2026-06-04T12:00:00"), "2026-06-03");
      expect(await run("billing.I16", b.entityId)).toMatchObject([
        { detail: { problem: "biz_date_mismatch", id: wrongDay } },
      ]);
    },
    SLOW,
  );

  it(
    "I4：冻结单与分摊对不上、批次的冻结与在冻结状态的分摊对不上；I5：已扣减的冻结单留在已消耗的数量对不上",
    async () => {
      h.clock.set(at("2026-06-04T18:00:00"));
      const drama = await h.make.drama({ heatTier: "A" });
      const merchant = async () => {
        const { entity, store } = await h.make.merchant({ verified: true });
        await openTerm(h, { entityId: entity.id });
        const held = await holdDrama(h, {
          entityId: entity.id,
          storeId: store.id,
          dramaId: drama.id,
        });
        const lot = await prisma.pointLot.findFirstOrThrow({ where: { entityId: entity.id } });
        return { entityId: entity.id, storeId: store.id, held, lot };
      };

      // 分摊行被改大：冻结单一侧（应扣 ≠ 分摊之和）与批次一侧（冻结 ≠ 在冻结状态的分摊之和）各报一条
      const a = await merchant();
      expect(await run("billing.I4", a.entityId)).toEqual([]);
      await prisma.pointHoldAlloc.update({
        where: { pointHoldId_allocNo: { pointHoldId: a.held.pointHoldId, allocNo: 1 } },
        data: { qty: { increment: 3 } },
      });
      const found = await run("billing.I4", a.entityId);
      expect(found).toHaveLength(2);
      expect(found).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            subject: { type: "point_hold", id: a.held.pointHoldId },
            entityId: a.entityId,
            detail: { problem: "alloc_sum", hold: [1800, 0, 0], allocs: [1803, 0, 0] },
          }),
          expect.objectContaining({
            subject: { type: "point_lot", id: a.lot.id },
            detail: { problem: "lot_held", heldQty: 1800, allocated: 1803 },
          }),
        ]),
      );

      // 工厂直接插的冻结单没有分摊、没动批次：只有冻结单一侧报
      const b = await merchant();
      const bare = await h.make.pointHold({
        entityId: b.entityId,
        storeId: b.storeId,
        subscriptionTermId: b.held.snapshot.termId,
        qty: 40,
      });
      expect(await run("billing.I4", b.entityId)).toMatchObject([
        { subject: { type: "point_hold", id: bare.id }, detail: { problem: "alloc_sum" } },
      ]);

      // 已扣减的冻结单多了一条“已消耗 → 可用”的流水，冻结单上却没记退回
      const c = await merchant();
      await captureHold(h, c.held.pointHoldId);
      expect(await run("billing.I5", c.entityId)).toEqual([]);
      const operation = await prisma.ledgerOperation.findFirstOrThrow({
        where: { entityId: c.entityId },
        orderBy: { seq: "desc" },
      });
      await prisma.pointLedgerEntry.create({
        data: {
          id: uuidv7(),
          ledgerOperationId: operation.id,
          entityId: c.entityId,
          pointLotId: c.lot.id,
          pointHoldId: c.held.pointHoldId,
          lotKind: "plan",
          planId: c.lot.planId,
          fromBucket: "consumed",
          toBucket: "available",
          qty: 25,
          occurredAt: h.clock.now(),
          bizDate: new Date("2026-06-04T00:00:00.000Z"),
          createdAt: h.clock.now(),
        },
      });
      expect(await run("billing.I5", c.entityId)).toMatchObject([
        {
          subject: { type: "point_hold", id: c.held.pointHoldId },
          entityId: c.entityId,
          detail: { status: "captured", expected: 1800, consumed: 1775 },
        },
      ]);
    },
    SLOW,
  );

  it(
    "I1：七个桶之和 ≠ 入账数量（库的 CHECK 平时拦着，摘掉约束才造得出来）",
    async () => {
      h.clock.set(at("2026-06-05T12:00:00"));
      const a = await merchantWithLedger();
      expect(await run("billing.I1", a.entityId)).toEqual([]);
      const owner = await connectTestDatabase(db.name, { role: null });
      try {
        await owner.query("ALTER TABLE point_lot DROP CONSTRAINT ck_point_lot_buckets_sum");
        await owner.query("UPDATE point_lot SET available_qty = available_qty + 7 WHERE id = $1", [
          a.planLot.id,
        ]);
      } finally {
        await owner.end();
      }
      expect(await run("billing.I1", a.entityId)).toMatchObject([
        {
          subject: { type: "point_lot", id: a.planLot.id },
          entityId: a.entityId,
          detail: { originalQty: 6600, buckets: [6607, 0, 0, 0, 0, 0, 0] },
        },
      ]);
      // 这一处也让自检拦下后续的账本操作：坏数据不会被继续记账盖过去
      await expect(topUp(h, { entityId: a.entityId, points: 1 })).rejects.toMatchObject({
        reason: "self_check",
      });
    },
    SLOW,
  );
});
