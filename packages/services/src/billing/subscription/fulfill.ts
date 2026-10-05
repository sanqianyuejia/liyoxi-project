// 付清后的履约 fulfill（W1-11a）。依据：03 第 1.3 节规则 4；D1 第 6.4 节；ADR-0046；07 分组 第 2.8–2.11 节。
// 由入账函数在入账事务里调（付款单已置为已支付）；差异单“重试履约”（M4）调同一个函数。
//
//   锁付款单并重读 → 拿账户锁、取账本时钟（这里不推进）→ 操作键已登记即返回上次的结果
//   → 保存点内：推进 → 核对实收 → 按内容快照履约 → 写 fulfill 操作行 → 自检 → 发事件
//
// 保存点里抛的错回滚到保存点并返回 blocked：付款单与收款事实不受影响，账本没有残留，账户锁还在手里；
// 修复后用同一入参再调（操作键没有登记过，可重入）。只有该整个重试的错原样抛出（见 blocked.ts）。
// 履约只读内容快照与快照指向的修订行；起算时刻在这里按账户当时的状态定，不取建单时刻与渠道的支付时间。
// fulfill 不改付款单：履约状态、结果与说明由调用方（入账函数）按返回值写回。
import { billingOrderContentSchema } from "@liyoxi/contract";
import type {
  BillingOrderContent,
  FulfillDone,
  FulfillNote,
  FulfillResult,
  PlanOrderContent,
} from "@liyoxi/contract";
import type { BILLING_ORDER_TYPE, EnumValue } from "@liyoxi/contract/enums";
import type { BillingOrder } from "@liyoxi/db";

import { actorColumns, lockRows, savepoint, uuidv7 } from "../../kernel/index.js";
import type { IdentityContext, Tx } from "../../kernel/index.js";
import { advanceAccount } from "../ledger/advance.js";
import { acquireAccount, fromDateColumn, toDateColumn } from "../ledger/context.js";
import type { LedgerClock } from "../ledger/context.js";
import {
  findOperation,
  isRefundPending,
  loadAccount,
  writeOperation,
} from "../ledger/operation.js";
import type { AccountState } from "../ledger/operation.js";
import { selfCheck } from "../ledger/self-check.js";
import { LedgerError } from "../ledger/types.js";
import { blockedResult, FulfillBlockedError, isNotBlockage } from "./blocked.js";
import { buildTerm } from "./terms.js";
import type { FulfillDeps } from "./types.js";

export interface FulfillInput {
  /** 已支付的付款单 */
  readonly billingOrderId: string;
  /** 入账的操作人：微信回调是系统，对公确认是财务；首月发放、订阅事件、出站事件都记在它名下 */
  readonly ctx: IdentityContext;
}

export interface FulfillOutcome {
  /** 存进 billing_order.fulfillment_result 的结果 */
  readonly result: FulfillResult;
  /** 这张付款单早已履约：这次什么都没写，result 是照库里的事实还原的第一次的结果 */
  readonly replayed: boolean;
}

export interface Fulfillment {
  /**
   * 履约一张已支付的付款单。重复调用只履约一次；失败只回滚保存点，返回 blocked。
   * 等账户锁超过 3 秒抛 ACCOUNT_BUSY（整个入账事务回滚，稍后重试，不算受阻）。
   */
  fulfill(tx: Tx, input: FulfillInput): Promise<FulfillOutcome>;
}

/** 履约的操作键：一张付款单只履约一次（07 分组 第 3.3 节） */
export const fulfillOpKey = (billingOrderId: string): string =>
  `fulfill:billing_order:${billingOrderId}`;

const noteOf = (claimed: boolean): FulfillNote[] => (claimed ? [] : ["promo_already_claimed"]);

export function createFulfillment(deps: FulfillDeps): Fulfillment {
  const step = async (name: Parameters<NonNullable<FulfillDeps["onStep"]>>[0]): Promise<void> => {
    await deps.onStep?.(name);
  };

  /** 套餐：建周期与发放计划；没有生效周期时当场发首月，过期后重新开通另记一条加购积分恢复 */
  async function fulfillPlan(
    tx: Tx,
    clock: LedgerClock,
    account: AccountState,
    order: BillingOrder,
    content: PlanOrderContent,
    ctx: IdentityContext,
  ): Promise<FulfillDone> {
    const { entityId } = account;
    const { term, schedules, previous, resumed } = await buildTerm(
      tx,
      deps,
      clock,
      account,
      order,
      content,
    );
    const queued = previous !== null;
    const lotIds: string[] = [];

    if (!queued) {
      // 首月的应发时刻 = 周期起点 = 账本时钟：推进会把它发出来（记在入账的操作人名下），并重算 next_due_at
      const first = schedules[0];
      if (first === undefined) throw new FulfillBlockedError("UNEXPECTED", { problem: "no_month" });
      await advanceAccount(tx, deps, clock, account, {
        grantAs: { grantScheduleId: first.id, ctx },
      });
      const granted = await tx.grantSchedule.findUniqueOrThrow({ where: { id: first.id } });
      if (granted.pointLotId === null) {
        throw new FulfillBlockedError("UNEXPECTED", { problem: "first_month_not_granted" });
      }
      lotIds.push(granted.pointLotId);
      if (resumed) {
        // 过期后重新开通：加购积分恢复使用。只记闸门打开，不动批次（键带恢复后生效周期的止日）
        const endDate = fromDateColumn(term.endDate);
        await writeOperation(tx, deps, clock, account, {
          opKey: `resume:subscription_term:${term.id}:${endDate}`,
          opType: "addon_resume",
          ref: { type: "subscription_term", id: term.id },
          occurredAt: clock.now,
          bizDate: clock.today,
          title: { code: "addon_resume", args: { termEndDate: endDate } },
          ctx,
          gateOpen: !(await isRefundPending(tx, entityId)),
        });
      }
    }

    // 首期优惠：快照带了才占用；已被另一张单占了照常履约，只加一条标注
    let notes: FulfillNote[] = [];
    if (content.promo !== null) {
      const { count } = await tx.planPromoClaim.createMany({
        data: [
          {
            id: uuidv7(),
            entityId,
            planRevisionId: content.promo.claimRevisionId,
            billingOrderId: order.id,
            usedAt: clock.now,
            createdAt: clock.now,
          },
        ],
        skipDuplicates: true,
      });
      notes = noteOf(count === 1);
      await step("promo.insert");
    }

    // 订阅的事实：开通（含过期后重新开通，周期的 origin 区分）、续费预约、降级预约
    const changed = queued && previous.planId !== term.planId;
    const ranks = changed
      ? await tx.plan.findMany({
          where: { id: { in: [previous.planId, term.planId] } },
          select: { id: true, rank: true },
        })
      : [];
    const rank = (planId: string): number => ranks.find((plan) => plan.id === planId)?.rank ?? 0;
    await tx.subscriptionEvent.create({
      data: {
        id: uuidv7(),
        entityId,
        subscriptionTermId: term.id,
        type: !queued
          ? "activated"
          : changed && rank(term.planId) < rank(previous.planId)
            ? "downgrade_scheduled"
            : "renewal_scheduled",
        ...(changed
          ? { fromPlanId: previous.planId, fromPlanRevisionId: previous.planRevisionId }
          : {}),
        toPlanId: term.planId,
        toPlanRevisionId: term.planRevisionId,
        billingOrderId: order.id,
        occurredAt: clock.now,
        bizDate: toDateColumn(clock.today),
        ...actorColumns(ctx.actor),
        createdAt: clock.now,
      },
    });
    await step("subscription_event.insert");

    const span = { startsAt: term.startsAt.toISOString(), endsAt: term.endsAt.toISOString() };
    if (queued) {
      await deps.events.emit(tx, ctx, {
        type: "billing.subscription.renewal_scheduled",
        aggregate: { type: "subscription_term", id: term.id },
        payload: { v: 1, termId: term.id, entityId, ...span },
        dedupeKey: `billing.subscription.renewal_scheduled:${term.id}`,
        entityId,
        storeId: null,
      });
    } else {
      await deps.events.emit(tx, ctx, {
        type: "billing.subscription.activated",
        aggregate: { type: "subscription_term", id: term.id },
        payload: {
          v: 1,
          termId: term.id,
          entityId,
          planId: term.planId,
          ...span,
          sourceBillingOrderId: order.id,
        },
        dedupeKey: `billing.subscription.activated:${term.id}`,
        entityId,
        storeId: null,
      });
    }
    await step("event.emit");

    return {
      status: "done",
      effectiveAt: span.startsAt,
      termId: term.id,
      lotIds,
      queuedBehindActive: queued,
      notes,
    };
  }

  /** 这张付款单早已履约：照库里的事实还原第一次的结果 */
  async function previousResult(
    tx: Tx,
    order: BillingOrder,
    content: BillingOrderContent,
  ): Promise<FulfillDone> {
    const term = await tx.subscriptionTerm.findUnique({
      where: { sourceBillingOrderId: order.id },
    });
    if (term === null || content.kind !== "plan") {
      throw new LedgerError("guard", "履约已登记，却找不到它建的周期", {
        billingOrderId: order.id,
      });
    }
    const queued = term.origin === "renew";
    const first = queued
      ? null
      : await tx.grantSchedule.findUnique({
          where: { subscriptionTermId_monthNo: { subscriptionTermId: term.id, monthNo: 0 } },
          select: { pointLotId: true },
        });
    const claim =
      content.promo === null
        ? null
        : await tx.planPromoClaim.findUnique({
            where: {
              entityId_planRevisionId: {
                entityId: order.entityId,
                planRevisionId: content.promo.claimRevisionId,
              },
            },
            select: { billingOrderId: true },
          });
    return {
      status: "done",
      effectiveAt: term.startsAt.toISOString(),
      termId: term.id,
      lotIds: first?.pointLotId ? [first.pointLotId] : [],
      queuedBehindActive: queued,
      notes: content.promo === null ? [] : noteOf(claim?.billingOrderId === order.id),
    };
  }

  return {
    async fulfill(tx, { billingOrderId, ctx }) {
      // 付款单排在账户之前锁（290 → 420）：调用方多半已经锁了，再锁一遍立刻返回；锁后重读
      await lockRows(tx, "billing_order", [billingOrderId]);
      const order = await tx.billingOrder.findUnique({ where: { id: billingOrderId } });
      if (order?.status !== "paid") {
        throw new LedgerError("guard", "只能履约已支付的付款单", {
          billingOrderId,
          status: order?.status ?? null,
        });
      }
      const clock = (await acquireAccount(tx, deps.clock, order.entityId)) as LedgerClock;
      const opKey = fulfillOpKey(order.id);
      if ((await findOperation(tx, opKey)) !== null) {
        const content = billingOrderContentSchema.parse(order.contentSnapshot);
        return { result: await previousResult(tx, order, content), replayed: true };
      }

      // 错出在推进那一段还是之后：归原因码时要分（推进失败是 ADVANCE_FAILED）
      const progress: { stage: "advance" | "fulfill" } = { stage: "advance" };
      try {
        const result = await savepoint(tx, async (): Promise<FulfillDone> => {
          const account = await loadAccount(tx, order.entityId);
          await advanceAccount(tx, deps, clock, account);
          progress.stage = "fulfill";

          const content = billingOrderContentSchema.parse(order.contentSnapshot);
          if (order.paidAmountFen !== content.payFen) {
            throw new FulfillBlockedError("AMOUNT_MISMATCH", {
              paidAmountFen: order.paidAmountFen,
              payFen: content.payFen,
            });
          }
          // 升级、加购两种内容的履约随 M4（docs/plan/stubs/m4-billing-fulfill-upgrade-topup.md）
          if (content.kind !== "plan") {
            throw new FulfillBlockedError("UNEXPECTED", {
              problem: "content_kind_not_supported",
              kind: content.kind,
            });
          }
          const done = await fulfillPlan(tx, clock, account, order, content, ctx);

          // 只做幂等登记：不动积分；操作后的余额照写，自检连同它一起比
          const written = await writeOperation(tx, deps, clock, account, {
            opKey,
            opType: "fulfill",
            ref: { type: "billing_order", id: order.id },
            occurredAt: clock.now,
            bizDate: clock.today,
            title: null,
            ctx,
            gateOpen:
              account.subStatus === "active" && !(await isRefundPending(tx, order.entityId)),
          });
          await selfCheck(tx, clock, written);
          await deps.events.emit(tx, ctx, {
            type: "billing.order_fulfilled",
            aggregate: { type: "billing_order", id: order.id },
            payload: {
              v: 1,
              billingOrderId: order.id,
              entityId: order.entityId,
              contentType: order.type as EnumValue<typeof BILLING_ORDER_TYPE>,
              termId: done.termId,
            },
            dedupeKey: `ledger:${opKey}`,
            entityId: order.entityId,
            storeId: null,
          });
          await step("event.emit");
          return done;
        });
        return { result, replayed: false };
      } catch (error) {
        if (isNotBlockage(error)) throw error;
        return { result: blockedResult(progress.stage, error), replayed: false };
      }
    },
  };
}
