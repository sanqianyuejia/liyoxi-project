// 时间推进 advance（W1-10）。依据：03 第 2.4 节；07 分组 第 2.8–2.12 节的状态表；D1 第 6.2 节；x01 第 5.8 节。
// 到点的事只在这里发生：月度发放、期末清零、预约周期接续（并发首月）、过期后加购积分停用。
// 幂等、可追赶：调用点是“持有账户锁的写操作开头”与任务进程每分钟的扫描。
//
// 按逻辑时间的先后一件一件做，停多久都与“每天按时跑”的结果相同：
//   当前周期里已到应发时刻的发放（逻辑时间 = due_at）→ 周期到期：清零（逻辑时间 = ends_at，业务日 = 止日）
//   → 有预约周期：接续生效（下一轮循环发它的首月）；没有：订阅过期，写 addon_suspend。
// D1 的伪代码先判到期、后判发放：停机跨过发放日与止点时，没发的那个月会跳过并留下 pending 行（违反 billing.I7）。
// 这里改成先发放、后清零，与逐日推进一致。
import type { GrantSchedule, SubscriptionTerm } from "@liyoxi/db";

import { createIdentityContext, uuidv7 } from "../../kernel/index.js";
import type { IdentityContext, Tx } from "../../kernel/index.js";
import { fromDateColumn } from "./context.js";
import type { LedgerClock } from "./context.js";
import { isRefundPending, reached, writeOperation } from "./operation.js";
import type { AccountState, OperationTitle, WrittenOperation } from "./operation.js";
import { selfCheck } from "./self-check.js";
import { LedgerError } from "./types.js";
import type { LedgerDeps } from "./types.js";

/** 推进时的操作人：系统动作，任务名进事件信封与幂等的 actor_key */
export const ADVANCE_JOB = "billing.advance";
/** 一次推进至多做多少件事：防数据异常时空转。停机一年的年付周期也只有二十几件 */
const MAX_STEPS = 500;

export interface AdvanceSummary {
  /** 发放了几个月 */
  readonly granted: number;
  /** 清零了几个周期 */
  readonly expired: number;
  /** 接续生效了几个预约周期 */
  readonly rolledOver: number;
  /** 订阅是否在这次推进里过期（没有预约周期） */
  readonly suspended: boolean;
}

export const systemContext = (entityId: string): IdentityContext =>
  createIdentityContext({ actor: { type: "system", job: ADVANCE_JOB }, entityId });

/** 首月发放的文案：新开通与过期后重新开通带付款单号；续接只带周期；其后各月只带月序 */
async function grantTitle(
  tx: Tx,
  term: SubscriptionTerm,
  schedule: GrantSchedule,
): Promise<OperationTitle> {
  const plan = await tx.plan.findUniqueOrThrow({
    where: { id: schedule.planId },
    select: { name: true },
  });
  if (schedule.monthNo > 0) {
    return { code: "grant_monthly", args: { planName: plan.name, monthNo: schedule.monthNo } };
  }
  const span = {
    planName: plan.name,
    termStartDate: fromDateColumn(term.startDate),
    termEndDate: fromDateColumn(term.endDate),
  };
  if (term.origin === "renew") return { code: "grant_term", args: span };
  const order = await tx.billingOrder.findUniqueOrThrow({
    where: { id: term.sourceBillingOrderId },
    select: { orderNo: true },
  });
  return { code: "grant_open", args: { ...span, billingOrderNo: order.orderNo } };
}

/**
 * 发放一行发放计划：新建套餐批次（到期 = 周期止点，成本 = 该月分摊的套餐款），计划改成已发放。
 * 逻辑时间是应发时刻。只由推进调：它保证这一行待发放、所属周期是当前生效周期、应发时刻已到。
 */
export async function grantDue(
  tx: Tx,
  deps: LedgerDeps,
  clock: LedgerClock,
  account: AccountState,
  term: SubscriptionTerm,
  schedule: GrantSchedule,
  ctx: IdentityContext = systemContext(account.entityId),
): Promise<WrittenOperation> {
  const written = await writeOperation(tx, deps, clock, account, {
    opKey: `grant:grant_schedule:${schedule.id}`,
    opType: "grant",
    ref: { type: "grant_schedule", id: schedule.id },
    occurredAt: schedule.dueAt,
    bizDate: fromDateColumn(schedule.dueDate),
    title: await grantTitle(tx, term, schedule),
    ctx,
    newLots: [
      {
        kind: "plan",
        sourceType: "grant_monthly",
        sourceId: schedule.id,
        subscriptionTermId: term.id,
        planId: schedule.planId,
        planRevisionId: schedule.planRevisionId,
        expiresAt: term.endsAt,
        qty: schedule.points,
        costBasisFen: schedule.valueFen,
      },
    ],
    afterLots: async ([pointLotId]) => {
      // 带状态条件：这一行已不是待发放（被并发的另一条路径发过）就一行都改不到，当场报错回滚
      const { count } = await tx.grantSchedule.updateMany({
        where: { id: schedule.id, status: "pending" },
        data: {
          status: "granted",
          pointLotId: pointLotId as string,
          grantedAt: schedule.dueAt,
          updatedAt: clock.now,
        },
      });
      if (count !== 1) {
        throw new LedgerError("guard", "发放计划已不是待发放", { grantScheduleId: schedule.id });
      }
      await reached(deps, "schedule.grant");
    },
    gateOpen: !(await isRefundPending(tx, account.entityId)),
  });
  await deps.events.emit(tx, ctx, {
    type: "billing.points.granted",
    aggregate: { type: "billing_account", id: account.entityId },
    payload: {
      v: 1,
      entityId: account.entityId,
      termId: term.id,
      grantScheduleId: schedule.id,
      points: schedule.points,
      monthIndex: schedule.monthNo,
    },
    dedupeKey: `billing.points.granted:${schedule.id}`,
    entityId: account.entityId,
    storeId: null,
  });
  await reached(deps, "event.emit");
  return written;
}

const subscriptionEvent = (
  clock: LedgerClock,
  term: SubscriptionTerm,
  type: "rolled_over" | "expired",
  at: { occurredAt: Date; bizDate: Date },
) => ({
  id: uuidv7(),
  entityId: term.entityId,
  subscriptionTermId: term.id,
  type,
  ...at,
  actorType: "system",
  createdAt: clock.now,
});

/** 期末清零：该周期套餐批次的“可用”移到“已清零”，冻结不动；周期置为已到期。幂等键带止日 */
async function expireTerm(
  tx: Tx,
  deps: LedgerDeps,
  clock: LedgerClock,
  account: AccountState,
  term: SubscriptionTerm,
  hasNext: boolean,
): Promise<WrittenOperation> {
  const ctx = systemContext(account.entityId);
  const endDate = fromDateColumn(term.endDate);
  const lots = await tx.pointLot.findMany({
    where: { subscriptionTermId: term.id, kind: "plan", availableQty: { gt: 0 } },
    orderBy: [{ grantedAt: "asc" }, { id: "asc" }],
  });
  const expiredQty = lots.reduce((sum, lot) => sum + lot.availableQty, 0);
  // 周期先置为已到期：它身上若挂着退款申请，到期之后就不再算进主体级的闸门
  await tx.subscriptionTerm.update({
    where: { id: term.id },
    data: { status: "ended", endedAt: term.endsAt, updatedAt: clock.now },
  });
  await reached(deps, "term.update");
  const written = await writeOperation(tx, deps, clock, account, {
    opKey: `expire:subscription_term:${term.id}:${endDate}`,
    opType: "expire",
    ref: { type: "subscription_term", id: term.id },
    occurredAt: term.endsAt,
    bizDate: endDate,
    title: {
      code: "term_expire",
      args: { termStartDate: fromDateColumn(term.startDate), termEndDate: endDate },
    },
    ctx,
    moves: lots.map((lot) => ({ lot, from: "available", to: "expired", qty: lot.availableQty })),
    accountPatch: { lastExpiredQty: expiredQty, lastExpiredAt: term.endsAt },
    // 有预约周期接着生效，闸门不关；没有的话订阅就此过期
    gateOpen: hasNext && !(await isRefundPending(tx, account.entityId)),
  });
  if (expiredQty > 0) {
    await deps.events.emit(tx, ctx, {
      type: "billing.points.expired",
      aggregate: { type: "billing_account", id: account.entityId },
      payload: { v: 1, entityId: account.entityId, termId: term.id, expiredPoints: expiredQty },
      dedupeKey: `billing.points.expired:${term.id}`,
      entityId: account.entityId,
      storeId: null,
    });
    await reached(deps, "event.emit");
  }
  return written;
}

/** 预约周期接续生效：接在上一期的止点上，生效时刻取它的起点。首月发放由下一轮循环做 */
async function activateTerm(
  tx: Tx,
  deps: LedgerDeps,
  clock: LedgerClock,
  account: AccountState,
  next: SubscriptionTerm,
  prev: SubscriptionTerm,
): Promise<void> {
  if (next.startsAt.getTime() !== prev.endsAt.getTime()) {
    throw new LedgerError("term_chain", "预约周期没有接在上一期的止点上", {
      termId: next.id,
      prevTermId: prev.id,
    });
  }
  await tx.subscriptionTerm.update({
    where: { id: next.id },
    data: { status: "active", activatedAt: next.startsAt, updatedAt: clock.now },
  });
  await reached(deps, "term.update");
  await tx.billingAccount.update({
    where: { entityId: account.entityId },
    data: { currentSubscriptionTermId: next.id, updatedAt: clock.now },
  });
  account.currentSubscriptionTermId = next.id;
  await reached(deps, "account.update");
  await tx.subscriptionEvent.create({
    data: {
      ...subscriptionEvent(clock, next, "rolled_over", {
        occurredAt: next.startsAt,
        bizDate: next.startDate,
      }),
      fromPlanId: prev.planId,
      toPlanId: next.planId,
      fromPlanRevisionId: prev.planRevisionId,
      toPlanRevisionId: next.planRevisionId,
      payload: { maxStores: next.maxStores, maxMembers: next.maxMembers },
    },
  });
  await reached(deps, "subscription_event.insert");
  await deps.events.emit(tx, systemContext(account.entityId), {
    type: "billing.subscription.rolled_over",
    aggregate: { type: "subscription_term", id: next.id },
    payload: { v: 1, termId: next.id, prevTermId: prev.id, entityId: account.entityId },
    dedupeKey: `billing.subscription.rolled_over:${next.id}`,
    entityId: account.entityId,
    storeId: null,
  });
  await reached(deps, "event.emit");
}

/** 到期且没有预约周期：订阅过期，加购积分停用（闸门关上，批次数量不动），只写一条 addon_suspend */
async function suspend(
  tx: Tx,
  deps: LedgerDeps,
  clock: LedgerClock,
  account: AccountState,
  term: SubscriptionTerm,
): Promise<WrittenOperation> {
  const ctx = systemContext(account.entityId);
  const endDate = fromDateColumn(term.endDate);
  const written = await writeOperation(tx, deps, clock, account, {
    opKey: `suspend:subscription_term:${term.id}:${endDate}`,
    opType: "addon_suspend",
    ref: { type: "subscription_term", id: term.id },
    occurredAt: term.endsAt,
    bizDate: endDate,
    title: { code: "addon_suspend", args: { termEndDate: endDate } },
    ctx,
    accountPatch: { subStatus: "expired", currentSubscriptionTermId: null },
    gateOpen: false,
  });
  await tx.subscriptionEvent.create({
    data: subscriptionEvent(clock, term, "expired", {
      occurredAt: term.endsAt,
      bizDate: term.endDate,
    }),
  });
  await reached(deps, "subscription_event.insert");
  await deps.events.emit(tx, ctx, {
    type: "billing.subscription.expired",
    aggregate: { type: "subscription_term", id: term.id },
    payload: {
      v: 1,
      termId: term.id,
      entityId: account.entityId,
      endedAt: term.endsAt.toISOString(),
    },
    dedupeKey: `ledger:suspend:subscription_term:${term.id}:${endDate}`,
    entityId: account.entityId,
    storeId: null,
  });
  await reached(deps, "event.emit");
  return written;
}

/** 下一个要处理的时刻 = min(当前周期止点, 它最早的待发放应发时刻)；没有生效周期为空。变了才写 */
export async function refreshNextDue(
  tx: Tx,
  clock: LedgerClock,
  account: AccountState,
): Promise<Date | null> {
  let next: Date | null = null;
  if (account.currentSubscriptionTermId !== null) {
    let [facts] = await tx.$queryRaw<{ endsAt: Date; pendingDueAt: Date | null }[]>`
      SELECT t.ends_at AS "endsAt", pending.due_at AS "pendingDueAt"
      FROM subscription_term t LEFT JOIN LATERAL (
        SELECT due_at FROM grant_schedule
        WHERE subscription_term_id = t.id AND status = 'pending'
        ORDER BY month_no ASC LIMIT 1
      ) pending ON true WHERE t.id = ${account.currentSubscriptionTermId}::uuid`;
    if (!facts) {
      // 缺周期不伪成null：保留原findUniqueOrThrow错误，罕见的并发补行仍真实读后续计划。
      const term = await tx.subscriptionTerm.findUniqueOrThrow({
        where: { id: account.currentSubscriptionTermId },
        select: { endsAt: true },
      });
      const pending = await tx.grantSchedule.findFirst({
        where: { subscriptionTermId: account.currentSubscriptionTermId, status: "pending" },
        orderBy: { monthNo: "asc" },
        select: { dueAt: true },
      });
      facts = { endsAt: term.endsAt, pendingDueAt: pending?.dueAt ?? null };
    }
    next =
      facts.pendingDueAt && facts.pendingDueAt < facts.endsAt ? facts.pendingDueAt : facts.endsAt;
  }
  if (next?.getTime() !== account.nextDueAt?.getTime()) {
    await tx.billingAccount.update({
      where: { entityId: account.entityId },
      data: { nextDueAt: next, updatedAt: clock.now },
    });
    account.nextDueAt = next;
  }
  return next;
}

export interface AdvanceOptions {
  /** 这一行发放计划若在这次推进里发放，记在这个操作人名下（履约发首月）；其余都是系统动作 */
  readonly grantAs?: { readonly grantScheduleId: string; readonly ctx: IdentityContext };
}

/** 推进到账本时钟为止。调用方已持有账户锁；account 是刚读出的账户状态，会被改成推进之后的值 */
export async function advanceAccount(
  tx: Tx,
  deps: LedgerDeps,
  clock: LedgerClock,
  account: AccountState,
  options: AdvanceOptions = {},
): Promise<AdvanceSummary> {
  const done = { granted: 0, expired: 0, rolledOver: 0, suspended: false };
  let last: WrittenOperation | undefined;
  for (let step = 0; account.currentSubscriptionTermId !== null; step += 1) {
    if (step >= MAX_STEPS) {
      throw new LedgerError("guard", "一次推进的步数超过上限", { entityId: account.entityId });
    }
    const term = await tx.subscriptionTerm.findUniqueOrThrow({
      where: { id: account.currentSubscriptionTermId },
    });
    const due = await tx.grantSchedule.findFirst({
      where: {
        subscriptionTermId: term.id,
        status: "pending",
        dueAt: { lte: clock.now, lt: term.endsAt },
      },
      orderBy: { monthNo: "asc" },
    });
    if (due) {
      const ctx = options.grantAs?.grantScheduleId === due.id ? options.grantAs.ctx : undefined;
      last = await grantDue(tx, deps, clock, account, term, due, ctx);
      done.granted += 1;
      continue;
    }
    if (term.endsAt > clock.now) break;
    const next = await tx.subscriptionTerm.findFirst({
      where: { entityId: account.entityId, status: "scheduled" },
      orderBy: { startsAt: "asc" },
    });
    last = await expireTerm(tx, deps, clock, account, term, next !== null);
    done.expired += 1;
    if (next === null) {
      last = await suspend(tx, deps, clock, account, term);
      done.suspended = true;
      break;
    }
    await activateTerm(tx, deps, clock, account, next, term);
    done.rolledOver += 1;
  }
  await refreshNextDue(tx, clock, account);
  if (last) await selfCheck(tx, clock, last);
  return done;
}
