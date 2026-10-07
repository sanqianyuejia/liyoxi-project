import { orderStatus, phaseFromTicket } from "@liyoxi/shared/aggregate";
import { getTicketStateBriefsByOrderItems } from "../delivery/index.js";
import { AppError, lockRows, savepoint } from "../kernel/index.js";
import type { InvariantScope, InvariantViolation, Tx } from "../kernel/index.js";
import { boundOrder } from "./binding.js";
import { deriveOrder, rederive } from "./rederive.js";

export const DERIVED_INVARIANT_CODES = ["I1", "I2", "I3"] as const;
export async function findDerivedViolations(
  tx: Tx,
  code: (typeof DERIVED_INVARIANT_CODES)[number],
  scope: InvariantScope = {},
): Promise<InvariantViolation[]> {
  const result: InvariantViolation[] = [];
  const initial = await tx.dramaOrder.findMany({
    where: scope.entityIds ? { entityId: { in: [...scope.entityIds] } } : {},
    orderBy: { id: "asc" },
    include: {
      orderItems: { orderBy: { id: "asc" } },
      openCancelRequest: { include: { cancelRequestLines: true } },
    },
  });
  // 自愈多订单仍遵守全部父160 → 全部项170；不能逐项170之后再首次锁下一父160。
  if (code !== "I1") {
    await lockRows(
      tx,
      "drama_order",
      initial.map((o) => o.id),
    );
    if (code === "I3")
      await lockRows(
        tx,
        "order_item",
        initial.flatMap((o) => o.orderItems.map((i) => i.id)),
      );
  }
  // 父锁取得后重新读同一初始集合，保留并发修正的事实；不逐单产生 N+1 查询。
  const rows =
    code === "I1"
      ? initial
      : await tx.dramaOrder.findMany({
          where: { id: { in: initial.map((o) => o.id) } },
          orderBy: { id: "asc" },
          include: {
            orderItems: { orderBy: { id: "asc" } },
            openCancelRequest: { include: { cancelRequestLines: true } },
          },
        });
  const states = new Map<string, { orderItemId: string; step: string }>();
  if (code !== "I2") {
    const ids = rows.flatMap((o) => o.orderItems.map((i) => i.id));
    for (let start = 0; start < ids.length; start += 1000)
      for (const ticket of await getTicketStateBriefsByOrderItems(
        tx,
        ids.slice(start, start + 1000),
      ))
        states.set(ticket.orderItemId, ticket);
  }
  async function heal(fn: () => Promise<void>) {
    try {
      await savepoint(tx, fn);
      return { action: "按真实状态机重新推导", at: boundOrder().clock.now() };
    } catch (error) {
      // 无合法机器迁移的污染保留告警，不能直接写phase绕过flow。
      if (error instanceof AppError && error.error === "STATE_NOT_ALLOWED") return undefined;
      throw error;
    }
  }
  for (const o of rows) {
    if (code === "I2") {
      if (!o.orderItems.length) {
        result.push({
          subject: { type: "drama_order", id: o.id },
          entityId: o.entityId,
          detail: { status: o.status, missingOrderItems: true },
        });
        continue;
      }
      const expected = orderStatus(o.orderItems, o.openCancelRequestId !== null);
      const request = o.openCancelRequest;
      const invalidRequest =
        request !== null &&
        (request.closedAt !== null ||
          request.entityId !== o.entityId ||
          request.storeId !== o.storeId ||
          !o.orderItems.every((i) =>
            request.cancelRequestLines.some(
              (l) =>
                l.targetType === "order_item" &&
                l.targetId === i.id &&
                l.entityId === o.entityId &&
                l.storeId === o.storeId,
            ),
          ));
      if (o.status !== expected || invalidRequest) {
        const healed = invalidRequest
          ? undefined
          : await heal(() => deriveOrder(tx, boundOrder(), o.id));
        result.push({
          subject: { type: "drama_order", id: o.id },
          entityId: o.entityId,
          detail: { status: o.status, expected, invalidOpenCancelRequest: invalidRequest },
          ...(healed ? { healed } : {}),
        });
      }
    } else
      for (const i of o.orderItems) {
        const ticket = states.get(i.id);
        if (code === "I1") {
          const expected = !["pending_start", "cancelled"].includes(i.phase);
          if (!!ticket !== expected)
            result.push({
              subject: { type: "order_item", id: i.id },
              entityId: i.entityId,
              detail: {
                phase: i.phase,
                expectedTicketCount: expected ? 1 : 0,
                actualTicketCount: ticket ? 1 : 0,
              },
            });
        } else if (ticket) {
          const expected = phaseFromTicket(
            ticket.step,
            i.usageStartDate !== null,
            i.returnedPoints + i.convertedPoints,
          );
          if (i.phase !== expected) {
            const healed = await heal(() => rederive(tx, boundOrder(), { orderItemIds: [i.id] }));
            result.push({
              subject: { type: "order_item", id: i.id },
              entityId: i.entityId,
              detail: { phase: i.phase, expected, ticketStep: ticket.step },
              ...(healed ? { healed } : {}),
            });
          }
        }
      }
  }
  return result;
}
