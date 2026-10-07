import { chainKey, machinePort, rowKey } from "../flow/index.js";
import {
  defineRegistration,
  implement,
  implementKeyed,
  implementMerchantFacts,
  lockRows,
} from "../kernel/index.js";
import { orderManagerPort } from "../profile/index.js";
import type { SyncStoreManager } from "../profile/index.js";
import { orderSidePort } from "../delivery/index.js";
import { boundOrder } from "./binding.js";
import { applyConfirmedPlan } from "./plan.js";
import { rederive, isDerivationChecked } from "./rederive.js";
import { DERIVED_INVARIANT_CODES, findDerivedViolations } from "./derived-invariants.js";
import { findOrderViolations, ORDER_INVARIANT_CODES } from "./invariants.js";
import { orderMerchantFacts } from "./counts.js";
import { handleOrderStart, isStartChecked } from "./start.js";
import { handleQualificationDecided, handleSubscriptionActivated } from "./subscribers.js";
import { runPendingStartSweep } from "./sweep.js";
export const syncOrderManager: SyncStoreManager = async (tx, input) => {
  const rows = await tx.dramaOrder.findMany({
    where: {
      storeId: input.storeId,
      entityId: input.entityId,
      status: { notIn: ["ended", "cancelled", "refunded"] },
    },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  await lockRows(
    tx,
    "drama_order",
    rows.map((r) => r.id),
  );
  // profile 已实际持有 store130，端口锁本域160；账户420之前完成，显式目标员工独立于旧 store 列。
  return (
    await tx.dramaOrder.updateMany({
      where: {
        id: { in: rows.map((r) => r.id) },
        OR: [{ deliveryManagerId: null }, { deliveryManagerId: { not: input.staffId } }],
      },
      data: { deliveryManagerId: input.staffId },
    })
  ).count;
};
export const registration = defineRegistration("order", {
  timerHandlers: [
    { kind: "order.start", critical: true, rearmAfterSkip: true, handle: handleOrderStart },
  ],
  subscribers: [
    {
      name: "order.onQualificationDecided",
      critical: true,
      events: ["store.qualification.approved", "store.qualification.rejected"],
      handle: handleQualificationDecided,
    },
    {
      name: "order.onSubscriptionActivated",
      critical: true,
      events: ["billing.subscription.activated"],
      handle: handleSubscriptionActivated,
    },
  ],
  recurringJobs: [
    {
      kind: "order.pending_start_sweep",
      schedule: { every: "minutes", minutes: 5 },
      mode: "tx",
      missSeverity: "P2",
      catchUp: true,
      run: runPendingStartSweep,
    },
  ],
  portImplementations: [
    implement(orderSidePort, {
      applyConfirmedPlan: (tx, input) => applyConfirmedPlan(tx, boundOrder(), input),
      rederive: (tx, input) => rederive(tx, boundOrder(), input),
    }),
    implementMerchantFacts("order", orderMerchantFacts),
    implement(orderManagerPort, syncOrderManager),
    implementKeyed(machinePort, chainKey("drama_order", "status"), {
      companions: ["sub_status", "status_changed_at", "closed_at", "started_at"],
      guards: {
        [rowKey("09:197", "order.start")]: async (_tx, facts) => isStartChecked(facts.args),
      },
      activity: (facts) => ({
        category: "flow",
        action: `order.order.${facts.event === "order.start" ? "start" : "submit"}`,
        summary: facts.event === "order.start" ? "开始交付短剧" : "确认订购短剧",
      }),
    }),
    implementKeyed(machinePort, chainKey("order_item", "phase"), {
      companions: ["phase_changed_at", "usage_start_date", "live_episode_count", "captured_at"],
      activity: (facts) => ({
        category: "flow",
        action: `order.item.${facts.event === "order.start" ? "start" : "submit"}`,
        summary: facts.event === "order.start" ? "扣减订单项积分并开工" : "冻结订单项积分",
      }),
      guards: {
        [rowKey("09:352", "order.start")]: async (_tx, facts) => isStartChecked(facts.args),
        [rowKey("09:355", "package.pushed")]: async (_tx, facts) => isDerivationChecked(facts.args),
        [rowKey("09:356", "launch.changed")]: async (_tx, facts) => isDerivationChecked(facts.args),
        [rowKey("09:351", "order.submit")]: async (tx, facts) => {
          const [row] = await tx.$queryRaw<{ ok: boolean }[]>`
            SELECT EXISTS (
              SELECT 1 FROM order_item i
              JOIN point_hold h ON h.id = i.point_hold_id
              JOIN drama_order o ON o.id = i.drama_order_id
              WHERE i.id = ${facts.subjectId}::uuid
                AND i.phase = 'pending_start' AND h.status = 'held'
                AND h.ref_type = 'order_item' AND h.ref_id = i.id
                AND h.qty = i.charge_points
                AND i.entity_id = o.entity_id AND i.store_id = o.store_id
                AND EXISTS (SELECT 1 FROM order_item_account a WHERE a.order_item_id = i.id)
            ) AS ok`;
          return row?.ok === true;
        },
      },
    }),
  ],
  invariants: [
    ...ORDER_INVARIANT_CODES.map((code) => ({
      code: `order.${code}`,
      severity: "P1" as const,
      modes: ["full" as const],
      heal: "none" as const,
      run: (
        tx: Parameters<typeof findOrderViolations>[0],
        scope: Parameters<typeof findOrderViolations>[2],
      ) => findOrderViolations(tx, code, scope),
    })),
    ...DERIVED_INVARIANT_CODES.map((code) => ({
      code: `order.${code}`,
      severity: "P2" as const,
      modes: ["full" as const],
      heal: code === "I1" ? ("none" as const) : ("heal_and_alert" as const),
      run: (
        tx: Parameters<typeof findDerivedViolations>[0],
        scope: Parameters<typeof findDerivedViolations>[2],
      ) => findDerivedViolations(tx, code, scope),
    })),
  ],
});
