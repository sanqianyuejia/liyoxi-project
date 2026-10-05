// billing 的不变量检查项（W1-10）：账本内核的九条——billing.I1–I8、I16。
// 依据：07 分组 第 5.6 节的登记表与各表“不变量”一节；D1 第 9 节。由 ops 的 invariant.full 每日调度。
// 涉及积分与金额的一律不自愈（heal: none）：修正走调整单或 fix 操作。直接关系数量的 P1，漏跑、顺序、缓存类 P2。
// I9–I13、I15、I17 随履约与 M4。
// 每条检查是一句 SQL，返回违规对象、所属主体与说明；可按主体缩小范围（后台手工触发）。一次至多报 500 条。
import { invariantNow } from "../kernel/index.js";
import type { InvariantRegistration, InvariantSeverity } from "../kernel/index.js";

const MAX_VIOLATIONS = 500;
/** “到点了还没做”的宽限：扫描每分钟一轮，过 10 分钟仍没做才算漏跑（07 分组 第 2.8、2.11、2.12 节） */
const LAG = "interval '10 minutes'";

const BUCKETS = [
  "available",
  "held",
  "consumed",
  "expired",
  "revoked",
  "converted_out",
  "adjusted_out",
] as const;
const columns = (prefix: string): string =>
  BUCKETS.map((bucket) => `${prefix}${bucket}_qty`).join(", ");
/** 一个批次的全部流水按桶累加：转入减转出；入账数量 = 从账外转入之和 */
const replayed = BUCKETS.map(
  (bucket) =>
    `(COALESCE(sum(e.qty) FILTER (WHERE e.to_bucket = '${bucket}'), 0)
      - COALESCE(sum(e.qty) FILTER (WHERE e.from_bucket = '${bucket}'), 0))::int AS ${bucket}_qty`,
).join(",\n");

interface ViolationRow {
  subject_type: string;
  subject_id: string;
  entity_id: string;
  detail: Record<string, unknown>;
}

/** sql 给出四列：subject_type、subject_id、entity_id、detail（jsonb）。$1 是限定的主体，$2 是业务时间（用不到的检查不写它） */
function check(code: string, severity: InvariantSeverity, sql: string): InvariantRegistration {
  return {
    code,
    severity,
    modes: ["full"],
    heal: "none",
    run: async (tx, scope, ctx) => {
      const rows = await tx.$queryRawUnsafe<ViolationRow[]>(
        `SELECT subject_type, subject_id::text AS subject_id, entity_id::text AS entity_id, detail
           FROM (${sql}) AS found
          WHERE ($1::uuid[] IS NULL OR entity_id = ANY($1::uuid[])) AND $2::timestamptz IS NOT NULL
          ORDER BY entity_id, subject_id
          LIMIT ${String(MAX_VIOLATIONS)}`,
        scope.entityIds && scope.entityIds.length > 0 ? [...scope.entityIds] : null,
        invariantNow(ctx),
      );
      return rows.map((row) => ({
        subject: { type: row.subject_type, id: row.subject_id },
        entityId: row.entity_id,
        detail: row.detail,
      }));
    },
  };
}

/** billing.I1：批次七个桶非负，之和 = 入账数量（库的 CHECK 已保证，每日再查） */
const i1 = check(
  "billing.I1",
  "P1",
  `SELECT 'point_lot' AS subject_type, l.id AS subject_id, l.entity_id,
          jsonb_build_object('originalQty', l.original_qty, 'buckets', jsonb_build_array(${columns("l.")})) AS detail
     FROM point_lot l
    WHERE ${BUCKETS.map((bucket) => `l.${bucket}_qty`).join(" + ")} <> l.original_qty
       OR least(${columns("l.")}) < 0`,
);

/** billing.I2：把批次的全部流水按桶累加 = 批次当前各桶 */
const i2 = check(
  "billing.I2",
  "P1",
  `SELECT 'point_lot' AS subject_type, l.id AS subject_id, l.entity_id,
          jsonb_build_object('stored', jsonb_build_array(l.original_qty, ${columns("l.")}),
                             'replayed', jsonb_build_array(r.original_qty, ${columns("r.")})) AS detail
     FROM point_lot l
     CROSS JOIN LATERAL (
       SELECT COALESCE(sum(e.qty) FILTER (WHERE e.from_bucket = 'external'), 0)::int AS original_qty,
              ${replayed}
         FROM point_ledger_entry e WHERE e.point_lot_id = l.id) r
    WHERE (l.original_qty, ${columns("l.")}) IS DISTINCT FROM (r.original_qty, ${columns("r.")})`,
);

/** billing.I3：账户缓存 = 批次汇总（套餐可用只算当前周期的批次） */
const i3 = check(
  "billing.I3",
  "P1",
  `SELECT 'billing_account' AS subject_type, a.entity_id AS subject_id, a.entity_id,
          jsonb_build_object(
            'cached', jsonb_build_array(a.plan_available_qty, a.addon_available_qty, a.held_total_qty),
            'recomputed', jsonb_build_array(s.plan_qty, s.addon_qty, s.held_qty)) AS detail
     FROM billing_account a
     CROSS JOIN LATERAL (
       SELECT COALESCE(sum(l.available_qty) FILTER (
                WHERE l.kind = 'plan' AND l.subscription_term_id = a.current_subscription_term_id), 0)::int AS plan_qty,
              COALESCE(sum(l.available_qty) FILTER (WHERE l.kind = 'addon'), 0)::int AS addon_qty,
              COALESCE(sum(l.held_qty), 0)::int AS held_qty
         FROM point_lot l WHERE l.entity_id = a.entity_id) s
    WHERE (a.plan_available_qty, a.addon_available_qty, a.held_total_qty)
            IS DISTINCT FROM (s.plan_qty, s.addon_qty, s.held_qty)`,
);

/**
 * billing.I4：冻结单的应扣 = 分摊数量之和，累计退回、不予退回 = 分摊行对应列之和；
 * 每个批次的冻结 = 该批次上所有在冻结状态的冻结单的分摊量之和（批次侧不符时对象是批次）。
 */
const i4 = check(
  "billing.I4",
  "P1",
  `SELECT 'point_hold' AS subject_type, h.id AS subject_id, h.entity_id,
          jsonb_build_object('problem', 'alloc_sum',
                             'hold', jsonb_build_array(h.qty, h.returned_qty, h.forfeited_qty),
                             'allocs', jsonb_build_array(s.qty, s.returned_qty, s.forfeited_qty)) AS detail
     FROM point_hold h
     CROSS JOIN LATERAL (
       SELECT COALESCE(sum(a.qty), 0)::int AS qty,
              COALESCE(sum(a.returned_qty), 0)::int AS returned_qty,
              COALESCE(sum(a.forfeited_qty), 0)::int AS forfeited_qty
         FROM point_hold_alloc a WHERE a.point_hold_id = h.id) s
    WHERE (h.qty, h.returned_qty, h.forfeited_qty) IS DISTINCT FROM (s.qty, s.returned_qty, s.forfeited_qty)
    UNION ALL
   SELECT 'point_lot', l.id, l.entity_id,
          jsonb_build_object('problem', 'lot_held', 'heldQty', l.held_qty, 'allocated', s.qty)
     FROM point_lot l
     CROSS JOIN LATERAL (
       SELECT COALESCE(sum(a.qty), 0)::int AS qty
         FROM point_hold_alloc a JOIN point_hold h ON h.id = a.point_hold_id
        WHERE a.point_lot_id = l.id AND h.status = 'held') s
    WHERE l.held_qty <> s.qty`,
);

/**
 * billing.I5：已扣减的冻结单，应扣 − 累计退回 − 不予退回 = 它留在“已消耗”的数量（按它的流水累加）；
 * 没扣减过的（冻结中、已释放）在“已消耗”里应为 0。
 */
const i5 = check(
  "billing.I5",
  "P1",
  `SELECT 'point_hold' AS subject_type, h.id AS subject_id, h.entity_id,
          jsonb_build_object('status', h.status, 'expected', e.qty, 'consumed', c.qty) AS detail
     FROM point_hold h
     CROSS JOIN LATERAL (
       SELECT CASE WHEN h.status IN ('captured', 'refunded_partial', 'refunded_full')
                   THEN h.qty - h.returned_qty - h.forfeited_qty ELSE 0 END AS qty) e
     CROSS JOIN LATERAL (
       SELECT (COALESCE(sum(m.qty) FILTER (WHERE m.to_bucket = 'consumed'), 0)
             - COALESCE(sum(m.qty) FILTER (WHERE m.from_bucket = 'consumed'), 0))::int AS qty
         FROM point_ledger_entry m WHERE m.point_hold_id = h.id) c
    WHERE e.qty <> c.qty`,
);

/** billing.I6：已过到期时刻超过 10 分钟的套餐批次，可用为 0 */
const i6 = check(
  "billing.I6",
  "P2",
  `SELECT 'point_lot' AS subject_type, l.id AS subject_id, l.entity_id,
          jsonb_build_object('expiresAt', l.expires_at, 'availableQty', l.available_qty) AS detail
     FROM point_lot l
    WHERE l.kind = 'plan' AND l.available_qty > 0 AND l.expires_at < $2::timestamptz - ${LAG}`,
);

/** billing.I7：套餐批次的到期 = 所属周期的止点；已结束、已退款的周期没有待发放的计划 */
const i7 = check(
  "billing.I7",
  "P1",
  `SELECT 'point_lot' AS subject_type, l.id AS subject_id, l.entity_id,
          jsonb_build_object('problem', 'lot_expiry', 'expiresAt', l.expires_at, 'termEndsAt', t.ends_at) AS detail
     FROM point_lot l JOIN subscription_term t ON t.id = l.subscription_term_id
    WHERE l.kind = 'plan' AND l.expires_at <> t.ends_at
    UNION ALL
   SELECT 'subscription_term', t.id, t.entity_id,
          jsonb_build_object('problem', 'pending_schedule', 'status', t.status, 'pending', count(*))
     FROM subscription_term t
     JOIN grant_schedule g ON g.subscription_term_id = t.id AND g.status = 'pending'
    WHERE t.status IN ('ended', 'refunded', 'cancelled')
    GROUP BY t.id`,
);

/** billing.I8：应发时刻已过超过 10 分钟的计划都已发放；没有落后 10 分钟以上还没推进的主体 */
const i8 = check(
  "billing.I8",
  "P2",
  `SELECT 'grant_schedule' AS subject_type, g.id AS subject_id, g.entity_id,
          jsonb_build_object('problem', 'grant_overdue', 'dueAt', g.due_at) AS detail
     FROM grant_schedule g JOIN subscription_term t ON t.id = g.subscription_term_id
    WHERE g.status = 'pending' AND t.status IN ('scheduled', 'active')
      AND g.due_at < $2::timestamptz - ${LAG}
    UNION ALL
   SELECT 'billing_account', a.entity_id, a.entity_id,
          jsonb_build_object('problem', 'advance_overdue', 'nextDueAt', a.next_due_at)
     FROM billing_account a
    WHERE a.next_due_at < $2::timestamptz - ${LAG}`,
);

/**
 * billing.I16：每个主体的流水与操作按 seq 排序时 occurred_at 不减（账本时钟单调）；
 * 流水的 biz_date = occurred_at 的北京时间日期，期末清零取前一日。每个主体只报最早的一处。
 */
const i16 = check(
  "billing.I16",
  "P2",
  `SELECT DISTINCT ON (entity_id) 'billing_account' AS subject_type, entity_id AS subject_id, entity_id,
          jsonb_build_object('problem', problem, 'table', source, 'id', id, 'seq', seq::text) AS detail
     FROM (
       SELECT e.entity_id, e.id, e.seq, 'point_ledger_entry' AS source,
              CASE WHEN e.occurred_at < lag(e.occurred_at) OVER (PARTITION BY e.entity_id ORDER BY e.seq)
                     THEN 'occurred_at_decreased'
                   WHEN e.biz_date <> (e.occurred_at AT TIME ZONE 'Asia/Shanghai')::date
                                       - CASE WHEN o.op_type = 'expire' THEN 1 ELSE 0 END
                     THEN 'biz_date_mismatch'
              END AS problem
         FROM point_ledger_entry e JOIN ledger_operation o ON o.id = e.ledger_operation_id
        UNION ALL
       SELECT o.entity_id, o.id, o.seq, 'ledger_operation',
              CASE WHEN o.occurred_at < lag(o.occurred_at) OVER (PARTITION BY o.entity_id ORDER BY o.seq)
                     THEN 'occurred_at_decreased' END
         FROM ledger_operation o) AS ordered
    WHERE problem IS NOT NULL
    ORDER BY entity_id, source DESC, seq`,
);

/** 账本内核的九条，按编号 */
export const billingInvariants: readonly InvariantRegistration[] = [
  i1,
  i2,
  i3,
  i4,
  i5,
  i6,
  i7,
  i8,
  i16,
];
