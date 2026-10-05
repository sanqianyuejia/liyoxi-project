// 建订阅周期与月度发放计划（W1-11a）。依据：03 第 2.3 节（锚定日）；07 分组 第 2.8–2.11 节；D1 第 6.4 节。
// 只由履约在保存点里调：调用方已持有账户锁、已推进到账本时钟。
//
//   没有生效周期：建 active 周期，起点 = 账本时钟（不取建单时刻与渠道的支付时间），锚定日 = 当天几号，
//                 origin 取 new（从未开通）或 resume（过期后重新开通）；账户置为生效。首月由调用方当场发放。
//   已有生效周期：建 scheduled 周期接在链尾，起点 = 链尾的止点，锚定日沿用链尾，origin = renew；到点由 advance 接续。
// 发放计划 N 行：每行积分相同；分摊 = 实付 ÷ 月数向下取整，尾差放最后一行（唯一的取整函数在 @liyoxi/shared）。
//
// 周期不重叠在这里查一遍（同主体预约、生效、已到期的周期区间两两不相交），不依赖库里的排他约束：
// 它延迟到提交时才检查，等它报出来整个入账事务就回滚了；在这里拦下才能转成“履约受阻”。
import type { PlanOrderContent } from "@liyoxi/contract";
import type { BillingOrder, GrantSchedule, SubscriptionTerm } from "@liyoxi/db";
import { splitEvenly } from "@liyoxi/shared/alloc";
import { grantSchedule, renewTerm, termDates } from "@liyoxi/shared/period";
import type { TermDates } from "@liyoxi/shared/period";
import { endOfDay, startOfDay } from "@liyoxi/shared/time";

import { uuidv7 } from "../../kernel/index.js";
import type { Tx } from "../../kernel/index.js";
import { fromDateColumn, toDateColumn } from "../ledger/context.js";
import type { LedgerClock } from "../ledger/context.js";
import type { AccountState } from "../ledger/operation.js";
import { FulfillBlockedError } from "./blocked.js";
import type { FulfillDeps } from "./types.js";

/** 没退款作废的周期：预约、生效、已到期。不重叠的范围就是这三种（同库里排他约束的条件） */
const LIVE = ["scheduled", "active", "ended"];

export interface BuiltTerm {
  readonly term: SubscriptionTerm;
  /** 发放计划，按月序 */
  readonly schedules: readonly GrantSchedule[];
  /** 接在它后面的那一期：已有生效周期时是链尾；没有生效周期时为空 */
  readonly previous: SubscriptionTerm | null;
  /** 建之前主体是否处于已过期（过期后重新开通） */
  readonly resumed: boolean;
}

const span = (term: Pick<SubscriptionTerm, "id" | "status" | "startsAt" | "endsAt">) => ({
  termId: term.id,
  status: term.status,
  startsAt: term.startsAt.toISOString(),
  endsAt: term.endsAt.toISOString(),
});

/**
 * 按付款单的内容快照建一个周期与它的发放计划；没有生效周期时同时把账户置为生效。
 * 只读快照与快照指向的修订行，不回查现价。对不上的数据一律抛 FulfillBlockedError，由履约转成受阻。
 */
export async function buildTerm(
  tx: Tx,
  deps: FulfillDeps,
  clock: LedgerClock,
  account: AccountState,
  order: BillingOrder,
  content: PlanOrderContent,
): Promise<BuiltTerm> {
  const { entityId } = account;
  const revision = await tx.planRevision.findUnique({ where: { id: content.planRevisionId } });
  if (revision?.planId !== content.planId) {
    throw new FulfillBlockedError("UNEXPECTED", {
      problem: "plan_revision_mismatch",
      planId: content.planId,
      planRevisionId: content.planRevisionId,
    });
  }

  const live = await tx.subscriptionTerm.findMany({
    where: { entityId, status: { in: LIVE } },
    orderBy: { startsAt: "asc" },
  });
  const current = live.find((term) => term.id === account.currentSubscriptionTermId) ?? null;
  const upcoming = live.filter((term) => term.status === "scheduled");
  if ((account.currentSubscriptionTermId === null) !== (current === null)) {
    throw new FulfillBlockedError("CONSTRAINT_VIOLATION", {
      problem: "current_term_missing",
      currentSubscriptionTermId: account.currentSubscriptionTermId,
    });
  }
  // 没有生效周期却有预约周期：推进只在有当前周期时接续，这样的预约周期永远等不到生效；新周期也无处可接
  if (current === null && upcoming.length > 0) {
    throw new FulfillBlockedError("CONSTRAINT_VIOLATION", {
      problem: "scheduled_without_active",
      terms: upcoming.map(span),
    });
  }

  const previous = current === null ? null : (upcoming.at(-1) ?? current);
  let dates: TermDates;
  try {
    dates =
      previous === null
        ? termDates(clock.today, content.months)
        : renewTerm(
            {
              startDate: fromDateColumn(previous.startDate),
              endDate: fromDateColumn(previous.endDate),
              anchorDay: previous.anchorDay,
              months: previous.months,
            },
            content.months,
          );
  } catch (error) {
    // 链尾被延长过、止日的次日不在锚定日上：规则没有定义（M4 做延长时定），不猜
    throw new FulfillBlockedError("UNEXPECTED", {
      problem: "term_dates",
      message: error instanceof Error ? error.message : String(error),
    });
  }
  const startsAt = previous === null ? clock.now : previous.endsAt;
  const endsAt = endOfDay(dates.endDate);

  const clash = live.find((term) => term.startsAt < endsAt && startsAt < term.endsAt);
  if (clash !== undefined) {
    throw new FulfillBlockedError("CONSTRAINT_VIOLATION", {
      problem: "term_overlap",
      terms: [
        span(clash),
        {
          termId: null,
          status: previous === null ? "active" : "scheduled",
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
        },
      ],
    });
  }

  const last = await tx.subscriptionTerm.aggregate({ where: { entityId }, _max: { termNo: true } });
  const resumed = previous === null && account.subStatus === "expired";
  const term = await tx.subscriptionTerm.create({
    data: {
      id: uuidv7(),
      entityId,
      termNo: (last._max.termNo ?? 0) + 1,
      origin: previous !== null ? "renew" : resumed ? "resume" : "new",
      planId: revision.planId,
      planRevisionId: revision.id,
      initialPlanRevisionId: revision.id,
      months: content.months,
      priceTotalFen: content.payFen,
      monthlyEquivFen: splitEvenly(content.payFen, content.months)[0] as number,
      monthlyPoints: content.monthlyPoints,
      discountBp: content.discountBp,
      productionModel: revision.productionModel,
      maxStores: revision.maxStores,
      maxMembers: revision.maxMembers,
      schedulePriority: revision.schedulePriority,
      hasMonthlyReport: revision.hasMonthlyReport,
      anchorDay: dates.anchorDay,
      startDate: toDateColumn(dates.startDate),
      endDate: toDateColumn(dates.endDate),
      startsAt,
      endsAt,
      status: previous === null ? "active" : "scheduled",
      sourceBillingOrderId: order.id,
      activatedAt: previous === null ? clock.now : null,
      createdAt: clock.now,
      updatedAt: clock.now,
    },
  });
  await deps.onStep?.("term.insert");

  const rows = grantSchedule(dates, {
    monthlyPoints: content.monthlyPoints,
    payFen: order.paidAmountFen,
  });
  await tx.grantSchedule.createMany({
    data: rows.map((row) => ({
      id: uuidv7(),
      subscriptionTermId: term.id,
      entityId,
      monthNo: row.monthNo,
      // 第 0 个月 = 周期起点；其余 = 当月发放日 00:00（北京时间）
      dueAt: row.monthNo === 0 ? startsAt : startOfDay(row.dueDate),
      dueDate: toDateColumn(row.dueDate),
      points: row.points,
      valueFen: row.valueFen,
      planId: revision.planId,
      planRevisionId: revision.id,
      createdAt: clock.now,
      updatedAt: clock.now,
    })),
  });
  await deps.onStep?.("schedule.insert");

  if (previous === null) {
    // 订阅状态与当前周期同一条 UPDATE（库里有 CHECK：active ⇔ 有当前周期）
    await tx.billingAccount.update({
      where: { entityId },
      data: { subStatus: "active", currentSubscriptionTermId: term.id, updatedAt: clock.now },
    });
    account.subStatus = "active";
    account.currentSubscriptionTermId = term.id;
    await deps.onStep?.("account.update");
  }

  const schedules = await tx.grantSchedule.findMany({
    where: { subscriptionTermId: term.id },
    orderBy: { monthNo: "asc" },
  });
  return { term, schedules, previous, resumed };
}
