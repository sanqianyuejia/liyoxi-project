// 账本内核的入口（W1-10）：createLedger 给出账本函数。每个函数第一个参数是事务句柄，自己不开事务；
// 审计由调用它的用例写，账本不写 audit_log（硬性规则 8；D1 第 7.1 节）。
//
// 每个操作同一个骨架（07 分组 第 2.15、3.3 节）：
//   拿账户锁、取账本时钟 → advance → 按操作键查，已登记即返回第一次的结果 → 守卫 → 按写入顺序落库 → 自检 → 发事件
// 账户与批次：进入（锁、时钟、推进）、月度发放、加购入账。冻结单一族（hold.ts）与调整、加购恢复（adjust.ts）在同一个骨架上。
import type { LedgerTitleArgs } from "@liyoxi/contract";
import type { PAY_CHANNEL, EnumValue } from "@liyoxi/contract/enums";

import type { IdentityContext, Tx } from "../../kernel/index.js";
import { adjust, resumeAddon } from "./adjust.js";
import type { AdjustInput, AdjustResult, ResumeAddonInput, ResumeAddonResult } from "./adjust.js";
import { advanceAccount, refreshNextDue } from "./advance.js";
import type { AdvanceSummary } from "./advance.js";
import { acquireAccount, ensureAccount } from "./context.js";
import type { AcquireOptions, LedgerClock } from "./context.js";
import { capture, hold, refund, release } from "./hold.js";
import type {
  CaptureInput,
  CaptureResult,
  Entered,
  HoldInput,
  HoldResult,
  RefundInput,
  ReleaseInput,
  ReturnResult,
} from "./hold.js";
import {
  findOperation,
  isRefundPending,
  loadAccount,
  reached,
  writeOperation,
} from "./operation.js";
import { selfCheck } from "./self-check.js";
import { LedgerError } from "./types.js";
import type { LedgerDeps } from "./types.js";

export type { AdjustInput, AdjustResult, ResumeAddonInput, ResumeAddonResult } from "./adjust.js";
export { ADVANCE_JOB } from "./advance.js";
export type { AdvanceSummary } from "./advance.js";
export { ACCOUNT_LOCK_WAIT_MS } from "./context.js";
export type { AcquireOptions, LedgerClock } from "./context.js";
export type {
  CaptureInput,
  CaptureResult,
  HoldInput,
  HoldRefType,
  HoldResult,
  RefundInput,
  ReleaseInput,
  ReturnReasonClass,
  ReturnResult,
} from "./hold.js";
export { HoldStateError, LEDGER_STEPS, LedgerError } from "./types.js";
export type { Db, HoldStatus, LedgerDeps, LedgerRefusal, LedgerStep } from "./types.js";

export interface GrantInput {
  readonly grantScheduleId: string;
  /** 操作人：不给即系统动作。履约时发首月可以传入账事务的身份上下文 */
  readonly ctx?: IdentityContext;
}

export interface GrantResult {
  readonly operationId: string;
  readonly pointLotId: string;
  readonly points: number;
  /** 这个操作键早已登记：这次什么都没写，返回的是第一次的结果 */
  readonly replayed: boolean;
}

export interface PurchaseInput {
  readonly entityId: string;
  /** 加购付款单：操作键与批次来源都按它，一张付款单只入账一次 */
  readonly billingOrderId: string;
  /** 到账积分 */
  readonly points: number;
  /** 实付（分）：批次的入账成本 */
  readonly payFen: number;
  readonly ctx: IdentityContext;
}

export interface PurchaseResult {
  readonly operationId: string;
  readonly pointLotId: string;
  readonly points: number;
  readonly replayed: boolean;
}

export interface Ledger {
  /** 没有才建计费账户行 */
  ensureAccount(tx: Tx, entityId: string): Promise<void>;
  /**
   * 拿账户锁、取账本时钟并推进。之后本事务里对这个主体的账本操作都用这把锁与这个时钟；
   * 调用方同一事务里写的时间敏感字段（提交时间、同意时间）用返回的 now。等锁超过 3 秒抛 ACCOUNT_BUSY。
   */
  lockAccount(tx: Tx, entityId: string): Promise<LedgerClock>;
  /** 推进到现在。wait: "skip" 而账户被别的事务占着时返回 null（每分钟扫描用） */
  advance(tx: Tx, entityId: string, options?: AcquireOptions): Promise<AdvanceSummary | null>;
  /** 月度发放。到点的发放 advance 会自己做；履约建好周期后发首月调它（可把这一笔记在入账的操作人名下） */
  grant(tx: Tx, input: GrantInput): Promise<GrantResult>;
  /** 加购入账：新建一个长期有效的加购批次。套餐已过期也照常入账（处于停用） */
  purchase(tx: Tx, input: PurchaseInput): Promise<PurchaseResult>;
  /** 重算账户的 next_due_at。建周期、改发放计划的一方（履约、延长）在自己的写入之后调，须已持有账户锁 */
  refreshNextDue(tx: Tx, entityId: string): Promise<Date | null>;
  /**
   * 冻结：锁内按账本时钟重算应扣积分并生成快照，按扣减顺序从“可用”移到“冻结”。一单多部剧在同一事务里逐部调。
   * 套餐未生效 SUBSCRIPTION_INACTIVE；退款处理中 PLAN_REFUND_IN_PROGRESS；与 expectS 不符 QUOTE_CHANGED；
   * 不足 POINTS_INSUFFICIENT（带缺口）。同一业务引用再来一次返回原冻结单。
   */
  hold(tx: Tx, input: HoldInput): Promise<HoldResult>;
  /** 扣减：冻结 → 已消耗（开始制作）。不要求订阅生效。冻结单已释放抛 HoldStateError（not_held） */
  capture(tx: Tx, input: CaptureInput): Promise<CaptureResult>;
  /** 超次修改：同一事务里冻结并扣减 */
  charge(
    tx: Tx,
    input: HoldInput & { readonly captureTitle: LedgerTitleArgs<"capture"> },
  ): Promise<HoldResult & { readonly captureOperationId: string }>;
  /** 释放：开工前取消，全额退回。已扣减的抛 HoldStateError（not_held），调用方改走退回 */
  release(tx: Tx, input: ReleaseInput): Promise<ReturnResult>;
  /** 退回：开工后按调用方算好的数量退，从分摊序列的尾部取；超过可退抛 HoldStateError（exceeds_refundable） */
  refund(tx: Tx, input: RefundInput): Promise<ReturnResult>;
  /** 手动调整入账（增、减）。套餐未生效 SUBSCRIPTION_INACTIVE；扣减时不够 PRECONDITION_CHANGED，不入账 */
  adjust(tx: Tx, input: AdjustInput): Promise<AdjustResult>;
  /** 过期后重新开通：记一行加购积分恢复。履约建好周期、发完首月之后调 */
  resumeAddon(tx: Tx, input: ResumeAddonInput): Promise<ResumeAddonResult>;
}

export function createLedger(deps: LedgerDeps): Ledger {
  /** 进入：锁、时钟、推进，返回推进之后的账户状态 */
  async function enter(tx: Tx, entityId: string): Promise<Entered> {
    const clock = (await acquireAccount(tx, deps.clock, entityId)) as LedgerClock;
    const account = await loadAccount(tx, entityId);
    await advanceAccount(tx, deps, clock, account);
    return { clock, account };
  }

  return {
    ensureAccount: (tx, entityId) => ensureAccount(tx, deps.clock, entityId),

    lockAccount: async (tx, entityId) => (await enter(tx, entityId)).clock,

    async advance(tx, entityId, options = {}) {
      const clock = await acquireAccount(tx, deps.clock, entityId, options);
      if (clock === null) return null;
      return advanceAccount(tx, deps, clock, await loadAccount(tx, entityId));
    },

    async grant(tx, input) {
      const found = await tx.grantSchedule.findUnique({ where: { id: input.grantScheduleId } });
      if (found === null) {
        throw new LedgerError("guard", "发放计划不存在", {
          grantScheduleId: input.grantScheduleId,
        });
      }
      const opKey = `grant:grant_schedule:${found.id}`;
      const clock = (await acquireAccount(tx, deps.clock, found.entityId)) as LedgerClock;
      const replayed = (await findOperation(tx, opKey)) !== null;
      // 发放本身由推进来做（它按逻辑时间的先后发，这一行之前到点的也一并补上）；这一行记在调用方给的操作人名下
      await advanceAccount(tx, deps, clock, await loadAccount(tx, found.entityId), {
        ...(input.ctx ? { grantAs: { grantScheduleId: found.id, ctx: input.ctx } } : {}),
      });
      const operation = await findOperation(tx, opKey);
      const schedule = await tx.grantSchedule.findUniqueOrThrow({ where: { id: found.id } });
      if (operation === null || schedule.pointLotId === null) {
        throw new LedgerError("guard", "只能发放当前生效周期里已到应发时刻的待发放计划", {
          grantScheduleId: schedule.id,
          status: schedule.status,
          dueAt: schedule.dueAt.toISOString(),
        });
      }
      return {
        operationId: operation.id,
        pointLotId: schedule.pointLotId,
        points: schedule.points,
        replayed,
      };
    },

    async purchase(tx, input) {
      const { entityId, billingOrderId, points, payFen, ctx } = input;
      const { clock, account } = await enter(tx, entityId);
      const opKey = `purchase:billing_order:${billingOrderId}`;
      const existing = await findOperation(tx, opKey);
      if (existing !== null) {
        const lot = await tx.pointLot.findUniqueOrThrow({
          where: {
            sourceType_sourceId_sourceNo: {
              sourceType: "purchase",
              sourceId: billingOrderId,
              sourceNo: 0,
            },
          },
        });
        if (
          existing.entityId !== entityId ||
          lot.originalQty !== points ||
          lot.costBasisFen !== payFen
        ) {
          throw new LedgerError("op_key_conflict", "这张付款单已入账，入参与第一次不同", { opKey });
        }
        return { operationId: existing.id, pointLotId: lot.id, points, replayed: true };
      }
      const order = await tx.billingOrder.findUnique({
        where: { id: billingOrderId },
        select: { entityId: true, orderNo: true, channel: true },
      });
      if (order?.entityId !== entityId || !Number.isSafeInteger(payFen) || payFen < 0) {
        throw new LedgerError("guard", "加购入账：付款单不属于这个主体，或实付不是非负整数分", {
          billingOrderId,
          payFen,
        });
      }
      const written = await writeOperation(tx, deps, clock, account, {
        opKey,
        opType: "purchase",
        ref: { type: "billing_order", id: billingOrderId },
        occurredAt: clock.now,
        bizDate: clock.today,
        title: {
          code: "topup",
          args: {
            billingOrderNo: order.orderNo,
            payFen,
            channel: order.channel as EnumValue<typeof PAY_CHANNEL>,
          },
        },
        ctx,
        newLots: [
          {
            kind: "addon",
            sourceType: "purchase",
            sourceId: billingOrderId,
            subscriptionTermId: null,
            planId: null,
            planRevisionId: null,
            expiresAt: null,
            qty: points,
            costBasisFen: payFen,
          },
        ],
        gateOpen: account.subStatus === "active" && !(await isRefundPending(tx, entityId)),
      });
      await selfCheck(tx, clock, written);
      await deps.events.emit(tx, ctx, {
        type: "billing.points.purchased",
        aggregate: { type: "billing_account", id: entityId },
        payload: { v: 1, entityId, billingOrderId, points },
        dedupeKey: `ledger:${opKey}`,
        entityId,
        storeId: null,
      });
      await reached(deps, "event.emit");
      return {
        operationId: written.id,
        pointLotId: written.lotIds[0] as string,
        points,
        replayed: false,
      };
    },

    async refreshNextDue(tx, entityId) {
      const clock = (await acquireAccount(tx, deps.clock, entityId)) as LedgerClock;
      return refreshNextDue(tx, clock, await loadAccount(tx, entityId));
    },

    hold: async (tx, input) => hold(tx, deps, await enter(tx, input.entityId), input),

    capture: async (tx, input) =>
      capture(tx, deps, await enter(tx, await holdEntity(tx, input.pointHoldId)), input),

    async charge(tx, input) {
      const held = await hold(tx, deps, await enter(tx, input.entityId), input);
      const captured = await capture(tx, deps, await enter(tx, input.entityId), {
        pointHoldId: held.pointHoldId,
        title: input.captureTitle,
        ctx: input.ctx,
      });
      return { ...held, captureOperationId: captured.operationId };
    },

    release: async (tx, input) =>
      release(tx, deps, await enter(tx, await holdEntity(tx, input.pointHoldId)), input),

    refund: async (tx, input) =>
      refund(tx, deps, await enter(tx, await holdEntity(tx, input.pointHoldId)), input),

    adjust: async (tx, input) => adjust(tx, deps, await enter(tx, input.entityId), input),

    async resumeAddon(tx, input) {
      const term = await tx.subscriptionTerm.findUnique({
        where: { id: input.subscriptionTermId },
        select: { entityId: true },
      });
      if (term === null) {
        throw new LedgerError("guard", "周期不存在", {
          subscriptionTermId: input.subscriptionTermId,
        });
      }
      return resumeAddon(tx, deps, await enter(tx, term.entityId), input);
    },
  };
}

/** 冻结单属于哪个主体：进入账本之前先无锁读一次（只为知道锁哪个账户；状态在锁内重读） */
async function holdEntity(tx: Tx, pointHoldId: string): Promise<string> {
  const found = await tx.pointHold.findUnique({
    where: { id: pointHoldId },
    select: { entityId: true },
  });
  if (found === null) throw new LedgerError("guard", "冻结单不存在", { pointHoldId });
  return found.entityId;
}
