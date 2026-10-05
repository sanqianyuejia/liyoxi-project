// 写入时自检（W1-10）。依据：07 分组 第 2.8、2.15、5.6 节；D1 第 8.5 节。
// 每个账本操作提交前，对当前主体从批次重算一遍：批次各桶、账户缓存、在冻结状态的冻结单合计、刚写的操作行上的余额。
// 不一致直接抛错回滚：错误的状态落不了库。不上报、不自愈；每日的不变量校验是第二道防线。
import type { Tx } from "../../kernel/index.js";
import type { LedgerClock } from "./context.js";
import type { WrittenOperation } from "./operation.js";
import { LedgerError } from "./types.js";

interface Recomputed {
  sub_status: string;
  plan_cached: number;
  addon_cached: number;
  held_cached: number;
  plan_sum: number;
  addon_sum: number;
  held_sum: number;
  hold_sum: number;
  bad_lots: number;
  stale_lots: number;
  refund_marks: number;
}

interface HoldSums {
  qty: number;
  returned_qty: number;
  forfeited_qty: number;
  alloc_qty: number;
  alloc_returned: number;
  alloc_forfeited: number;
}

/**
 * 重算并比对。last 给了就连同它一起比：刚写的操作行上的“操作后可花、操作后冻结”要与重算的结果一致。
 * 前提：已持有账户锁、已 advance（所以已到期的套餐批次不该还有可用）。
 */
export async function selfCheck(
  tx: Tx,
  clock: LedgerClock,
  last?: Pick<WrittenOperation, "spendableAfterQty" | "heldAfterQty"> &
    Partial<Pick<WrittenOperation, "pointHoldId">>,
): Promise<void> {
  const [row] = await tx.$queryRaw<Recomputed[]>`
    SELECT a.sub_status,
           a.plan_available_qty AS plan_cached,
           a.addon_available_qty AS addon_cached,
           a.held_total_qty AS held_cached,
           COALESCE(sum(l.available_qty) FILTER (
             WHERE l.kind = 'plan' AND l.subscription_term_id = a.current_subscription_term_id), 0)::int AS plan_sum,
           COALESCE(sum(l.available_qty) FILTER (WHERE l.kind = 'addon'), 0)::int AS addon_sum,
           COALESCE(sum(l.held_qty), 0)::int AS held_sum,
           (SELECT COALESCE(sum(h.qty), 0)::int FROM point_hold h
             WHERE h.entity_id = a.entity_id AND h.status = 'held') AS hold_sum,
           (count(*) FILTER (WHERE l.available_qty + l.held_qty + l.consumed_qty + l.expired_qty + l.revoked_qty
             + l.converted_out_qty + l.adjusted_out_qty <> l.original_qty
             OR least(l.available_qty, l.held_qty, l.consumed_qty, l.expired_qty, l.revoked_qty,
                      l.converted_out_qty, l.adjusted_out_qty) < 0))::int AS bad_lots,
           (count(*) FILTER (WHERE l.kind = 'plan' AND l.available_qty > 0 AND l.expires_at <= ${clock.now}))::int
             AS stale_lots,
           (SELECT count(*)::int FROM subscription_term t
             WHERE t.entity_id = a.entity_id AND t.status IN ('scheduled', 'active')
               AND t.refund_request_id IS NOT NULL) AS refund_marks
    FROM billing_account a
    LEFT JOIN point_lot l ON l.entity_id = a.entity_id
    WHERE a.entity_id = ${clock.entityId}::uuid
    GROUP BY a.entity_id`;
  if (!row) throw new LedgerError("self_check", "计费账户不存在", { entityId: clock.entityId });

  const spendable =
    row.sub_status === "active" && row.refund_marks === 0 ? row.plan_sum + row.addon_sum : 0;
  const problems: string[] = [];
  if (row.bad_lots > 0) problems.push("有批次的七个桶为负或之和不等于入账数量");
  if (row.stale_lots > 0) problems.push("已到期的套餐批次还有可用");
  if (row.plan_cached !== row.plan_sum) problems.push("账户的套餐可用 ≠ 当前周期批次之和");
  if (row.addon_cached !== row.addon_sum) problems.push("账户的加购可用 ≠ 加购批次之和");
  if (row.held_cached !== row.held_sum) problems.push("账户的冻结合计 ≠ 批次冻结之和");
  if (row.hold_sum !== row.held_sum) problems.push("冻结中的冻结单合计 ≠ 批次冻结之和");
  if (last && last.heldAfterQty !== row.held_sum) problems.push("操作行的操作后冻结 ≠ 重算值");
  if (last && last.spendableAfterQty !== spendable) problems.push("操作行的操作后可花 ≠ 重算值");
  // 这次操作涉及的冻结单：应扣 = 分摊之和；累计退回、不予退回 = 分摊行对应列之和
  let holdRow: HoldSums | undefined;
  if (last?.pointHoldId) {
    [holdRow] = await tx.$queryRaw<HoldSums[]>`
      SELECT h.qty, h.returned_qty, h.forfeited_qty,
             COALESCE(sum(a.qty), 0)::int AS alloc_qty,
             COALESCE(sum(a.returned_qty), 0)::int AS alloc_returned,
             COALESCE(sum(a.forfeited_qty), 0)::int AS alloc_forfeited
      FROM point_hold h LEFT JOIN point_hold_alloc a ON a.point_hold_id = h.id
      WHERE h.id = ${last.pointHoldId}::uuid
      GROUP BY h.id`;
    if (
      !holdRow ||
      holdRow.qty !== holdRow.alloc_qty ||
      holdRow.returned_qty !== holdRow.alloc_returned ||
      holdRow.forfeited_qty !== holdRow.alloc_forfeited
    ) {
      problems.push("冻结单的应扣、累计退回、不予退回 ≠ 分摊行之和");
    }
  }
  if (problems.length > 0) {
    throw new LedgerError("self_check", `写入时自检不一致：${problems.join("；")}`, {
      entityId: clock.entityId,
      ...row,
      ...(last ? { last } : {}),
      ...(holdRow ? { hold: holdRow } : {}),
    });
  }
}
