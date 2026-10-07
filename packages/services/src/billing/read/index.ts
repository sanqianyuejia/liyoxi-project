// 账本的读函数（W1-10）：权益现算、套餐与积分视图、按冻结单取账本操作。
// 依据：07 分组 第 2.8、2.9 节；D1 第 6.2 节“权益判断不读缓存”；m07 第 2.0、2.7 节；任务书 第 10 节第 4 项。
// 读函数不拿账户锁、不 advance、不写库。时刻由调用方给（注入时钟的现在）。
// 订阅是否生效按周期起止现算，不读 billing_account.sub_status：到点但还没被推进的周期也按到点后的样子算，
// 扫描晚到时没有账本写操作的主体不会被误判成“生效中”。
import type {
  BILLING_SUB_STATUS,
  EnumValue,
  LEDGER_OPERATION_OP_TYPE,
  PRODUCTION_MODEL,
  SCHEDULE_PRIORITY,
} from "@liyoxi/contract/enums";
import type { SubscriptionTerm } from "@liyoxi/db";
import { calendarDate, diffDays } from "@liyoxi/shared/time";
import type { LocalDate } from "@liyoxi/shared/time";

import { fromDateColumn } from "../ledger/context.js";
import type { Db } from "../ledger/types.js";

export type SubscriptionStatus = EnumValue<typeof BILLING_SUB_STATUS>;

/** 周期行上的权益快照 */
export interface TermBenefits {
  readonly discountBp: number;
  readonly monthlyPoints: number;
  readonly productionModel: EnumValue<typeof PRODUCTION_MODEL>;
  readonly schedulePriority: EnumValue<typeof SCHEDULE_PRIORITY>;
  readonly hasMonthlyReport: boolean;
  readonly maxStores: number;
  /** 空 = 不限 */
  readonly maxMembers: number | null;
}

export interface EntitlementTerm extends TermBenefits {
  readonly termId: string;
  readonly planId: string;
  readonly planRevisionId: string;
  readonly months: number;
  readonly startDate: LocalDate;
  readonly endDate: LocalDate;
  readonly startsAt: Date;
  readonly endsAt: Date;
}

export interface Entitlements {
  /** none 从未开通；active 生效中；expired 已过期。现算，不是缓存 */
  readonly subStatus: SubscriptionStatus;
  /** 主体级闸门：任一预约或生效的周期挂着退款申请 */
  readonly refundPending: boolean;
  /** 此刻生效的周期；没有为空 */
  readonly term: EntitlementTerm | null;
  /** 已过期时最近结束的那一期（展示“续费后恢复”用）；其余为空 */
  readonly lastTerm: EntitlementTerm | null;
}

const toEntitlementTerm = (term: SubscriptionTerm): EntitlementTerm => ({
  termId: term.id,
  planId: term.planId,
  planRevisionId: term.planRevisionId,
  months: term.months,
  startDate: fromDateColumn(term.startDate),
  endDate: fromDateColumn(term.endDate),
  startsAt: term.startsAt,
  endsAt: term.endsAt,
  discountBp: term.discountBp,
  monthlyPoints: term.monthlyPoints,
  productionModel: term.productionModel as TermBenefits["productionModel"],
  schedulePriority: term.schedulePriority as TermBenefits["schedulePriority"],
  hasMonthlyReport: term.hasMonthlyReport,
  maxStores: term.maxStores,
  maxMembers: term.maxMembers,
});

/** 没退款作废的周期：预约、生效、已到期 */
const LIVE = ["scheduled", "active", "ended"];

function entitlementsOf(terms: readonly SubscriptionTerm[], at: Date): Entitlements {
  const begun = terms.filter((term) => term.startsAt <= at);
  const current = begun.find((term) => term.status !== "ended" && at < term.endsAt);
  const over = begun
    .filter((term) => term.endsAt <= at)
    .sort((a, b) => b.endsAt.getTime() - a.endsAt.getTime())[0];
  return {
    subStatus: current ? "active" : over ? "expired" : "none",
    refundPending: terms.some((term) => term.status !== "ended" && term.refundRequestId !== null),
    term: current ? toEntitlementTerm(current) : null,
    lastTerm: !current && over ? toEntitlementTerm(over) : null,
  };
}

const liveTerms = (db: Db, entityId: string): Promise<SubscriptionTerm[]> =>
  db.subscriptionTerm.findMany({
    where: { entityId, status: { in: LIVE } },
    orderBy: { startsAt: "asc" },
  });

/** 主体此刻的权益：按周期起止现算。其他模块判断“套餐是否生效、有哪些权益”只读这个 */
export async function getEntitlements(db: Db, entityId: string, at: Date): Promise<Entitlements> {
  return entitlementsOf(await liveTerms(db, entityId), at);
}

/** m07 第 2.7 节 Wallet 的 subscription、points 两段；usage、topUp、rules 三段由接口包拼 */
export interface WalletView {
  readonly subscription: {
    readonly status: SubscriptionStatus;
    readonly isRefundPending: boolean;
    /** 生效中取当前周期的版本；已过期取最近结束的周期的版本；从未开通为空 */
    readonly plan: { readonly planId: string; readonly code: string; readonly name: string } | null;
    readonly months: number | null;
    readonly startDate: LocalDate | null;
    readonly endDate: LocalDate | null;
    readonly endsAt: Date | null;
    /** 止日 − 今日（北京时间）；非生效中为空 */
    readonly remainingDays: number | null;
    readonly benefits: TermBenefits | null;
    readonly scheduledTerms: readonly {
      readonly planName: string;
      readonly months: number;
      readonly startDate: LocalDate;
      readonly endDate: LocalDate;
    }[];
  };
  readonly points: {
    /** 生效中且不在退款处理中 ? 套餐可用 + 加购可用 : 0 */
    readonly spendablePoints: number;
    readonly planAvailablePoints: number;
    /** 含停用的 */
    readonly addonAvailablePoints: number;
    readonly heldPoints: number;
    /** 套餐过期，加购积分停用 */
    readonly isAddonSuspended: boolean;
    readonly planGrantedThisTermPoints: number;
    /** 本期套餐积分清零时刻；非生效中为空 */
    readonly planPointsExpireAt: Date | null;
    readonly lastExpired: { readonly expiredPoints: number; readonly expiredAt: Date } | null;
  };
}

/**
 * 套餐与积分视图。积分从批次现算、不读账户上的缓存：到点还没被推进时，已到期批次的可用不计入，
 * 所以只会少显示（下一分钟扫描后补上新一期的发放），不会把该清零的积分显示成可用。
 */
export async function getWalletView(db: Db, entityId: string, at: Date): Promise<WalletView> {
  const terms = await liveTerms(db, entityId);
  const entitlements = entitlementsOf(terms, at);
  const shown = entitlements.term ?? entitlements.lastTerm;
  const upcoming = terms.filter((term) => term.status === "scheduled" && at < term.startsAt);
  const planIds = [...new Set([shown?.planId, ...upcoming.map((term) => term.planId)])].filter(
    (id) => id !== undefined,
  );
  const plans = await db.plan.findMany({
    where: { id: { in: planIds } },
    select: { id: true, code: true, name: true },
  });
  const planOf = new Map(plans.map((plan) => [plan.id, plan]));
  const currentTermId = entitlements.term?.termId ?? null;
  const [sums] = await db.$queryRaw<
    { plan_available: number; plan_granted: number; addon_available: number; held: number }[]
  >`
    SELECT COALESCE(sum(available_qty) FILTER (
             WHERE kind = 'plan' AND subscription_term_id = ${currentTermId}::uuid AND expires_at > ${at}), 0)::int
             AS plan_available,
           COALESCE(sum(original_qty) FILTER (
             WHERE kind = 'plan' AND subscription_term_id = ${currentTermId}::uuid), 0)::int AS plan_granted,
           COALESCE(sum(available_qty) FILTER (WHERE kind = 'addon'), 0)::int AS addon_available,
           COALESCE(sum(held_qty), 0)::int AS held
    FROM point_lot WHERE entity_id = ${entityId}::uuid`;
  const account = await db.billingAccount.findUnique({
    where: { entityId },
    select: { lastExpiredQty: true, lastExpiredAt: true },
  });
  const planAvailable = sums?.plan_available ?? 0;
  const addonAvailable = sums?.addon_available ?? 0;
  const active = entitlements.subStatus === "active";
  const plan = shown ? planOf.get(shown.planId) : undefined;
  const benefits: TermBenefits | null = shown && {
    discountBp: shown.discountBp,
    monthlyPoints: shown.monthlyPoints,
    productionModel: shown.productionModel,
    schedulePriority: shown.schedulePriority,
    hasMonthlyReport: shown.hasMonthlyReport,
    maxStores: shown.maxStores,
    maxMembers: shown.maxMembers,
  };
  return {
    subscription: {
      status: entitlements.subStatus,
      isRefundPending: entitlements.refundPending,
      plan: plan ? { planId: plan.id, code: plan.code, name: plan.name } : null,
      months: shown?.months ?? null,
      startDate: shown?.startDate ?? null,
      endDate: shown?.endDate ?? null,
      endsAt: shown?.endsAt ?? null,
      remainingDays: entitlements.term
        ? diffDays(entitlements.term.endDate, calendarDate(at))
        : null,
      benefits,
      scheduledTerms: upcoming.map((term) => ({
        planName: planOf.get(term.planId)?.name ?? "",
        months: term.months,
        startDate: fromDateColumn(term.startDate),
        endDate: fromDateColumn(term.endDate),
      })),
    },
    points: {
      spendablePoints: active && !entitlements.refundPending ? planAvailable + addonAvailable : 0,
      planAvailablePoints: planAvailable,
      addonAvailablePoints: addonAvailable,
      heldPoints: sums?.held ?? 0,
      isAddonSuspended: !active && addonAvailable > 0,
      planGrantedThisTermPoints: sums?.plan_granted ?? 0,
      planPointsExpireAt: entitlements.term?.endsAt ?? null,
      lastExpired:
        account?.lastExpiredQty != null && account.lastExpiredAt != null
          ? { expiredPoints: account.lastExpiredQty, expiredAt: account.lastExpiredAt }
          : null,
    },
  };
}

/** 一次账本操作的展示行：订单详情的积分时间线用 */
export interface LedgerOperationView {
  readonly id: string;
  readonly opType: EnumValue<typeof LEDGER_OPERATION_OP_TYPE>;
  readonly occurredAt: Date;
  readonly bizDate: LocalDate;
  readonly planDeltaPoints: number;
  readonly addonDeltaPoints: number;
  readonly titleCode: string | null;
  readonly titleArgs: unknown;
}

/** 按冻结单取它的账本操作（冻结、扣减、释放、退回），按写入先后 */
export async function listOperationsByHold(
  db: Db,
  pointHoldId: string,
): Promise<LedgerOperationView[]> {
  const rows = await db.ledgerOperation.findMany({
    where: { pointHoldId },
    orderBy: { seq: "asc" },
    select: {
      id: true,
      opType: true,
      occurredAt: true,
      bizDate: true,
      planDeltaQty: true,
      addonDeltaQty: true,
      titleCode: true,
      titleArgs: true,
    },
  });
  return rows.map((row) => ({
    id: row.id,
    opType: row.opType as LedgerOperationView["opType"],
    occurredAt: row.occurredAt,
    bizDate: fromDateColumn(row.bizDate),
    planDeltaPoints: row.planDeltaQty,
    addonDeltaPoints: row.addonDeltaQty,
    titleCode: row.titleCode,
    titleArgs: row.titleArgs,
  }));
}
