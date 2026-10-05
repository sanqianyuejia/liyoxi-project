// billing 的不变量：订阅一侧的三条——billing.I9、I10、I12（W1-11a）。
// 依据：07 分组 第 2.8、2.9、2.11、5.6 节；D1 第 9 节。写法、调度、不自愈同账户与批次的七条（../invariants.ts）。
// I10 是“周期不重叠”的第二道防线（第一道是建周期时的服务层校验），库里的排他约束在不在都成立。
// I12 这里查套餐（开通、续费）与加购两种付款单；升级付款单、已退款付款单的那两句随 M4（那时才有这两种履约与收回）。
// 受阻的付款单有没有未决差异单、受阻多久，归付款一侧的 payment.I4。
import type { InvariantRegistration } from "../../kernel/index.js";
import { check } from "../invariants.js";

/** “到点了还没做”的宽限，同 I6、I8：扫描每分钟一轮，过 10 分钟仍没推进才算 */
const LAG = "interval '10 minutes'";

/**
 * billing.I9：每个主体至多一个生效周期；sub_status = active ⇔ 有一个生效周期、已到起点、还没过止点，
 * 且账户的当前周期指的就是它。
 */
const i9 = check(
  "billing.I9",
  "P2",
  `SELECT 'billing_account' AS subject_type, a.entity_id AS subject_id, a.entity_id,
          jsonb_build_object('subStatus', a.sub_status, 'activeTerms', t.active_terms,
                             'inForce', t.in_force, 'currentIsActive', t.current_is_active) AS detail
     FROM billing_account a
     CROSS JOIN LATERAL (
       SELECT count(*)::int AS active_terms,
              (count(*) FILTER (WHERE s.starts_at <= $2::timestamptz
                                  AND s.ends_at > $2::timestamptz - ${LAG}))::int AS in_force,
              COALESCE(bool_or(s.id = a.current_subscription_term_id), false) AS current_is_active
         FROM subscription_term s
        WHERE s.entity_id = a.entity_id AND s.status = 'active') t
    WHERE t.active_terms > 1
       OR (a.sub_status = 'active' AND (t.in_force <> 1 OR NOT t.current_is_active))
       OR (a.sub_status <> 'active' AND t.active_terms > 0)`,
);

/**
 * billing.I10：同一主体预约、生效、已到期的周期两两不重叠（报在起点较晚的那一个上）；
 * 预约周期首尾相接：它的起点是同主体另一个生效或预约周期的止点。
 */
const i10 = check(
  "billing.I10",
  "P2",
  `SELECT DISTINCT ON (b.id) 'subscription_term' AS subject_type, b.id AS subject_id, b.entity_id,
          jsonb_build_object('problem', 'overlap', 'otherTermId', a.id,
                             'startsAt', b.starts_at, 'otherEndsAt', a.ends_at) AS detail
     FROM subscription_term a
     JOIN subscription_term b
       ON b.entity_id = a.entity_id AND b.id <> a.id
      AND (a.starts_at, a.id) < (b.starts_at, b.id)
      AND b.starts_at < a.ends_at
    WHERE a.status IN ('scheduled', 'active', 'ended') AND b.status IN ('scheduled', 'active', 'ended')
    UNION ALL
   SELECT 'subscription_term', s.id, s.entity_id,
          jsonb_build_object('problem', 'gap', 'startsAt', s.starts_at)
     FROM subscription_term s
    WHERE s.status = 'scheduled'
      AND NOT EXISTS (
        SELECT 1 FROM subscription_term p
         WHERE p.entity_id = s.entity_id AND p.id <> s.id
           AND p.status IN ('scheduled', 'active') AND p.ends_at = s.starts_at)`,
);

/**
 * billing.I12：钱与权益一一对应。履约完成的套餐付款单恰有一个周期，它的发放计划各行分摊之和 = 实付
 * （升级过的周期各行加过差价，不比这一句）；履约完成的加购付款单恰有一个批次，入账成本 = 实付。
 */
const i12 = check(
  "billing.I12",
  "P1",
  `SELECT 'billing_order' AS subject_type, o.id AS subject_id, o.entity_id,
          jsonb_build_object('problem', CASE WHEN t.terms <> 1 THEN 'term_count' ELSE 'schedule_value' END,
                             'terms', t.terms, 'paidAmountFen', o.paid_amount_fen,
                             'scheduleValueFen', t.value_fen) AS detail
     FROM billing_order o
     CROSS JOIN LATERAL (
       SELECT count(*)::int AS terms,
              COALESCE(sum((SELECT sum(g.value_fen) FROM grant_schedule g
                             WHERE g.subscription_term_id = s.id)), 0)::bigint AS value_fen,
              COALESCE(bool_or(EXISTS (SELECT 1 FROM subscription_event e
                                        WHERE e.subscription_term_id = s.id AND e.type = 'upgraded')), false)
                AS upgraded
         FROM subscription_term s WHERE s.source_billing_order_id = o.id) t
    WHERE o.fulfillment_status = 'done' AND o.type IN ('plan_new', 'plan_renew')
      AND (t.terms <> 1 OR (NOT t.upgraded AND t.value_fen <> o.paid_amount_fen))
    UNION ALL
   SELECT 'billing_order', o.id, o.entity_id,
          jsonb_build_object('problem', CASE WHEN l.lots <> 1 THEN 'lot_count' ELSE 'lot_cost' END,
                             'lots', l.lots, 'paidAmountFen', o.paid_amount_fen, 'costBasisFen', l.cost_fen)
     FROM billing_order o
     CROSS JOIN LATERAL (
       SELECT count(*)::int AS lots, COALESCE(sum(p.cost_basis_fen), 0)::bigint AS cost_fen
         FROM point_lot p WHERE p.source_type = 'purchase' AND p.source_id = o.id) l
    WHERE o.fulfillment_status = 'done' AND o.type = 'topup'
      AND (l.lots <> 1 OR l.cost_fen <> o.paid_amount_fen)`,
);

/** 订阅一侧的三条，按编号 */
export const subscriptionInvariants: readonly InvariantRegistration[] = [i9, i10, i12];
