import type { BillingOrder, PrismaClient } from "@liyoxi/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createIdentityContext, isAppError } from "../../kernel/index.js";
import {
  assertSnapshotsEqual,
  createFulfillHarness,
  dumpLedger,
  fulfillOrder,
  joinFulfillment,
  paidPlanOrder,
  snapshotTables,
  topUp,
  useSeededDatabase,
} from "../../testing/index.js";
import type { FulfillHarness } from "../../testing/index.js";
import { ACCOUNT_LOCK_WAIT_MS } from "../ledger/index.js";
import { FULFILL_STEPS } from "./types.js";
import type { FulfillStep } from "./types.js";

// 甲类的故障注入（任务书验收 2、3 在履约这一层的一半；经入账函数的那一半在付款侧）：
//   ① 在 fulfill 每个写步骤之后抛错：事务照常提交（调用方在同一事务里写的东西还在），结果是 blocked，
//      周期、发放计划、批次、流水、账本操作、订阅事件、出站事件一行不多；去掉故障后同入参再调得到 done，
//      账本与没出过故障的对照主体逐项相同。
//   ② 唯一冲突、自检失败各造一例：同样是受阻、无残留、修好后重试成功。
//   ③ 可重试的数据库错误不算受阻：原样抛出，由 tx.run 整个重试；账户锁被占着得到 ACCOUNT_BUSY，整个事务回滚。
// 这一组同时验证“原生保存点在锁定的 Prisma 版本的交互式事务里可用”（ADR-0046）。

const SLOW = 240_000;
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

class Injected extends Error {}

const db = useSeededDatabase("services");
let prisma: PrismaClient;
let h: FulfillHarness;
let other: Awaited<ReturnType<typeof joinFulfillment>>;
/** 第几步之后抛什么；null 即只记不抛 */
let fault: { at: number; error: () => Error } | null = null;
let seen: FulfillStep[] = [];

beforeAll(async () => {
  prisma = await db.prisma();
  h = createFulfillHarness(prisma, {
    onStep: (step) => {
      seen.push(step);
      if (fault !== null && seen.length === fault.at) throw fault.error();
    },
  });
  other = await joinFulfillment(h, await db.url());
}, SLOW);

afterAll(async () => {
  await other?.close();
});

const systemCtx = (entityId: string) =>
  createIdentityContext({ actor: { type: "system", job: "lyxtest.fulfill" }, entityId });

/**
 * 入账函数的样子（付款侧的缩影）：同一事务里先在付款单上记一笔，再履约，再把履约状态写回去。
 * 返回履约的结果；事务提交与否看付款单上那一笔在不在。
 */
function applyLike(order: BillingOrder, mark: string) {
  return h.tx.run(async (tx) => {
    await tx.billingOrder.update({ where: { id: order.id }, data: { fulfillmentNote: mark } });
    const { result } = await h.fulfillment.fulfill(tx, {
      billingOrderId: order.id,
      ctx: systemCtx(order.entityId),
    });
    if (result.status === "blocked") {
      await tx.billingOrder.update({
        where: { id: order.id },
        data: { fulfillmentStatus: "blocked", fulfillmentResult: result },
      });
    }
    return result;
  });
}

/** 一个已过期、带加购积分的主体，与一张带首期优惠的续费付款单：履约时会走到全部步骤 */
async function expiredMerchantWithOrder() {
  h.clock.set(at("2026-01-05T12:00:00"));
  const { entity } = await h.make.merchant({ verified: true });
  await fulfillOrder(h, await paidPlanOrder(h, { entityId: entity.id }));
  await topUp(h, { entityId: entity.id, points: 1000 });
  const probe = await paidPlanOrder(h, { entityId: entity.id, type: "plan_renew", months: 3 });
  const revisionId = (probe.contentSnapshot as { planRevisionId: string }).planRevisionId;
  await prisma.billingOrder.update({
    where: { id: probe.id },
    data: {
      contentSnapshot: {
        ...(probe.contentSnapshot as object),
        promo: {
          claimRevisionId: revisionId,
          type: "previous_revision",
          appliedRevisionId: revisionId,
        },
      },
    },
  });
  return { entityId: entity.id, order: probe };
}

describe("履约的故障注入（验收 2、3 的履约一层）", () => {
  it(
    "每个写步骤之后抛错：事务仍提交、结果受阻、账本无残留；去掉故障后同入参得到 done，与对照主体逐项相同",
    async () => {
      const control = await expiredMerchantWithOrder();
      const victim = await expiredMerchantWithOrder();
      h.clock.set(at("2026-02-10T10:00:00"));
      expect((await fulfillOrder(h, control.order)).result.status).toBe("done");

      const before = await snapshotTables(prisma, TABLES);
      const reasons = new Set<string>();
      for (let step = 1; ; step += 1) {
        fault = { at: step, error: () => new Injected(`第 ${step} 步`) };
        seen = [];
        const result = await applyLike(victim.order, `第 ${step} 次`);
        const order = await prisma.billingOrder.findUniqueOrThrow({
          where: { id: victim.order.id },
        });
        // 调用方在同一事务里写的那一笔还在：入账事务提交了
        expect(order.fulfillmentNote, `第 ${step} 步`).toBe(`第 ${step} 次`);
        if (result.status === "done") break;
        reasons.add(result.reasonCode);
        expect(result.detail, `第 ${step} 步`).toMatchObject({ error: "Error" });
        expect(order.fulfillmentStatus).toBe("blocked");
        assertSnapshotsEqual(before, await snapshotTables(prisma, TABLES));
      }
      fault = null;
      // 最后一轮没有注入：seen 是一次完整履约走过的步骤
      const steps = seen;

      // 注入点覆盖了履约登记的全部步骤；错在推进那一段的归 ADVANCE_FAILED，其后的归 UNEXPECTED
      expect(new Set(steps)).toEqual(new Set(FULFILL_STEPS));
      expect(steps.length).toBeGreaterThan(20);
      expect(reasons).toEqual(new Set(["ADVANCE_FAILED", "UNEXPECTED"]));
      expect(await dumpLedger(prisma, victim.entityId)).toEqual(
        await dumpLedger(prisma, control.entityId),
      );
      expect(await prisma.planPromoClaim.count({ where: { entityId: victim.entityId } })).toBe(1);
    },
    SLOW,
  );

  it(
    "唯一冲突、自检失败：都是受阻、无残留；修好数据后同一张单履约成功",
    async () => {
      h.clock.set(at("2026-03-10T10:00:00"));

      // 唯一冲突：这张付款单名下已经有一个（作废了的）周期，撞“一张付款单至多建一个周期”
      const first = await h.make.merchant({ verified: true });
      const order = await paidPlanOrder(h, { entityId: first.entity.id });
      const stray = await h.make.subscriptionTerm({
        entityId: first.entity.id,
        termNo: 9,
        status: "cancelled",
        sourceBillingOrderId: order.id,
      });
      let before = await snapshotTables(prisma, TABLES);
      expect((await fulfillOrder(h, order)).result).toMatchObject({
        status: "blocked",
        reasonCode: "CONSTRAINT_VIOLATION",
        detail: { sqlState: "23505" },
      });
      assertSnapshotsEqual(before, await snapshotTables(prisma, TABLES));
      await prisma.subscriptionTerm.delete({ where: { id: stray.id } });
      expect((await fulfillOrder(h, order)).result.status).toBe("done");

      // 自检失败：主体名下有一张没经过账本的冻结单（冻结单合计 ≠ 批次冻结之和）
      const second = await h.make.merchant({ verified: true });
      const blocked = await paidPlanOrder(h, { entityId: second.entity.id });
      const drift = await h.make.subscribedMerchant();
      const hold = await h.make.pointHold({ entityId: drift.entity.id, storeId: drift.store.id });
      await prisma.pointHold.update({
        where: { id: hold.id },
        data: { entityId: second.entity.id, storeId: second.store.id },
      });
      before = await snapshotTables(prisma, TABLES);
      expect((await fulfillOrder(h, blocked)).result).toMatchObject({
        status: "blocked",
        reasonCode: "SELF_CHECK_FAILED",
        detail: { error: "LedgerError", reason: "self_check" },
      });
      assertSnapshotsEqual(before, await snapshotTables(prisma, TABLES));
      await prisma.pointHold.delete({ where: { id: hold.id } });
      expect((await fulfillOrder(h, blocked)).result.status).toBe("done");
    },
    SLOW,
  );

  it(
    "可重试的数据库错误不算受阻：原样抛出，tx.run 整个重试，第二遍履约成功且只履约一次",
    async () => {
      h.clock.set(at("2026-03-10T10:00:00"));
      const { entity } = await h.make.merchant({ verified: true });
      const order = await paidPlanOrder(h, { entityId: entity.id });
      // 驱动适配器报死锁时的形状（kernel 的 sqlStateOf 认它）
      const deadlock = (): Error =>
        Object.assign(new Error("deadlock detected"), {
          name: "DriverAdapterError",
          cause: { originalCode: "40P01", originalMessage: "deadlock detected" },
        });
      let bodies = 0;
      seen = [];
      fault = { at: 2, error: deadlock };
      const result = await h.tx.run(async (tx) => {
        bodies += 1;
        return (
          await h.fulfillment.fulfill(tx, { billingOrderId: order.id, ctx: systemCtx(entity.id) })
        ).result;
      });
      fault = null;
      expect(result.status).toBe("done");
      expect(bodies).toBe(2);
      expect(await prisma.subscriptionTerm.count({ where: { entityId: entity.id } })).toBe(1);
      expect(
        await prisma.ledgerOperation.count({ where: { entityId: entity.id, opType: "fulfill" } }),
      ).toBe(1);
    },
    SLOW,
  );

  it(
    "账户锁被占着：等 3 秒得到 ACCOUNT_BUSY，整个事务回滚（付款单上那一笔也没了）；放开后重试成功",
    async () => {
      h.clock.set(at("2026-03-10T10:00:00"));
      const { entity } = await h.make.merchant({ verified: true });
      const order = await paidPlanOrder(h, { entityId: entity.id });
      const before = await snapshotTables(prisma, [...TABLES, "billing_order"]);

      let locked!: () => void;
      let release!: () => void;
      const lockedAt = new Promise<void>((resolve) => (locked = resolve));
      const released = new Promise<void>((resolve) => (release = resolve));
      const holder = other.tx.run(
        async (tx) => {
          await other.ledger.lockAccount(tx, entity.id);
          locked();
          await released;
        },
        { timeoutMs: 30_000 },
      );
      await lockedAt;
      const startedAt = performance.now();
      const outcome = await applyLike(order, "被占着").catch((error: unknown) => error);
      const waitedMs = performance.now() - startedAt;
      release();
      await holder;

      expect(isAppError(outcome) && outcome.error).toBe("ACCOUNT_BUSY");
      expect(waitedMs).toBeGreaterThanOrEqual(ACCOUNT_LOCK_WAIT_MS - 100);
      assertSnapshotsEqual(before, await snapshotTables(prisma, [...TABLES, "billing_order"]));
      expect(await applyLike(order, "放开了")).toMatchObject({ status: "done" });
    },
    SLOW,
  );
});
