// 手动调整（增、减）与加购积分恢复（W1-10 第二个 PR）。
// 依据：07 分组 第 3.2 节 adjust 一行、第 3.3、3.4 节；D1 第 6.7、7.8、8.3 节；任务书 第 5 节、第 10 节第 3 项。
// 调整只交账本函数：审批执行器、调整申请单、平台原因退回的联动在 M4；这里不查审批单与申请单是否存在。
// 与冻结单一族同一个骨架：调用方已拿锁、取时钟、推进；这里从“按操作键查”开始。
import type {
  EnumValue,
  POINT_ADJUSTMENT_REQUEST_DIRECTION,
  POINT_ADJUSTMENT_REQUEST_REASON_CODE,
} from "@liyoxi/contract/enums";
import { planAllocation } from "@liyoxi/shared/alloc";

import { AppError } from "../../kernel/index.js";
import type { IdentityContext, Tx } from "../../kernel/index.js";
import { systemContext } from "./advance.js";
import { fromDateColumn } from "./context.js";
import { deductibleLots, gateOpen } from "./hold.js";
import type { Entered } from "./hold.js";
import { findOperation, reached, writeOperation } from "./operation.js";
import { selfCheck } from "./self-check.js";
import { LedgerError } from "./types.js";
import type { LedgerDeps } from "./types.js";

export interface AdjustInput {
  readonly entityId: string;
  /** 审批单：操作的关联单据，调整增加的批次来源 */
  readonly approvalRequestId: string;
  /** 审批单号：操作键 adjust:{审批单号} */
  readonly requestNo: string;
  /** 调整申请单：事件载荷带它 */
  readonly pointAdjustmentRequestId: string;
  readonly direction: EnumValue<typeof POINT_ADJUSTMENT_REQUEST_DIRECTION>;
  /** 调哪一类积分：套餐积分归入当前周期、随本期清零；加购积分长期有效 */
  readonly lotKind: "plan" | "addon";
  /** 数量，正整数；方向另给 */
  readonly points: number;
  /** 原因。平台原因退回（platform_refund）不走这里：它冲回的是原冻结单，走 refund */
  readonly reasonCode: EnumValue<typeof POINT_ADJUSTMENT_REQUEST_REASON_CODE>;
  /** 给商家看的一句短说明 */
  readonly note?: string;
  readonly ctx: IdentityContext;
}

export interface AdjustResult {
  readonly operationId: string;
  /** 带符号的变动：增加为正，扣减为负 */
  readonly deltaPoints: number;
  /** 调整增加新建的批次；扣减为空 */
  readonly pointLotId: string | null;
  readonly replayed: boolean;
}

/** 手动调整入账：增加 = 新建一个无对价的批次；扣减 = 从指定类型的批次按扣减顺序移到“调整扣减” */
export async function adjust(
  tx: Tx,
  deps: LedgerDeps,
  entered: Entered,
  input: AdjustInput,
): Promise<AdjustResult> {
  const { clock, account } = entered;
  const { points, lotKind, direction } = input;
  const opKey = `adjust:${input.requestNo}`;
  const deltaPoints = direction === "increase" ? points : -points;
  const existing = await findOperation(tx, opKey);
  if (existing !== null) {
    if (
      existing.entityId !== account.entityId ||
      existing.opType !== "adjust" ||
      existing.refId !== input.approvalRequestId ||
      existing.planDeltaQty + existing.addonDeltaQty !== deltaPoints ||
      (lotKind === "plan" ? existing.addonDeltaQty : existing.planDeltaQty) !== 0
    ) {
      throw new LedgerError("op_key_conflict", "这张审批单已入账，入参与第一次不同", { opKey });
    }
    const lot = await tx.pointLot.findUnique({
      where: {
        sourceType_sourceId_sourceNo: {
          sourceType: "adjust",
          sourceId: input.approvalRequestId,
          sourceNo: 0,
        },
      },
      select: { id: true },
    });
    return { operationId: existing.id, deltaPoints, pointLotId: lot?.id ?? null, replayed: true };
  }
  if (!Number.isSafeInteger(points) || points < 1 || input.reasonCode === "platform_refund") {
    throw new LedgerError("guard", "调整：数量必须是正整数；平台原因退回走 refund，不走调整", {
      points,
      reasonCode: input.reasonCode,
    });
  }
  // 守卫：主体有生效周期（已过期的账户不能调整，D1 第 7.8 节）
  if (account.subStatus !== "active" || account.currentSubscriptionTermId === null) {
    throw new AppError("SUBSCRIPTION_INACTIVE");
  }
  const title = {
    code: "adjust" as const,
    args: { reasonCode: input.reasonCode, ...(input.note ? { note: input.note } : {}) },
  };
  const draft = {
    opKey,
    opType: "adjust" as const,
    ref: { type: "approval_request" as const, id: input.approvalRequestId },
    occurredAt: clock.now,
    bizDate: clock.today,
    title,
    ctx: input.ctx,
    gateOpen: await gateOpen(tx, account),
  };
  let written;
  if (direction === "increase") {
    const term = await tx.subscriptionTerm.findUniqueOrThrow({
      where: { id: account.currentSubscriptionTermId },
    });
    const plan = lotKind === "plan";
    written = await writeOperation(tx, deps, clock, account, {
      ...draft,
      newLots: [
        {
          kind: lotKind,
          sourceType: "adjust",
          sourceId: input.approvalRequestId,
          subscriptionTermId: plan ? term.id : null,
          planId: plan ? term.planId : null,
          planRevisionId: plan ? term.planRevisionId : null,
          expiresAt: plan ? term.endsAt : null,
          qty: points,
          // 无对价
          costBasisFen: 0,
        },
      ],
    });
  } else {
    const lots = await deductibleLots(tx, entered, lotKind);
    const taken = planAllocation(points, lots);
    if (taken.shortfall > 0) {
      // 不得扣成负数：不入账，审批单留在待审（D1 第 7.8 节）
      throw new AppError("PRECONDITION_CHANGED", {
        details: { requiredPoints: points, availablePoints: taken.allocated },
      });
    }
    const byId = new Map(lots.map((lot) => [lot.id, lot]));
    written = await writeOperation(tx, deps, clock, account, {
      ...draft,
      moves: taken.allocations.map(({ lotId, qty }) => {
        const lot = byId.get(lotId) as (typeof lots)[number];
        return { lot, from: "available", to: "adjusted_out", qty };
      }),
    });
  }
  await selfCheck(tx, clock, written);
  await deps.events.emit(tx, input.ctx, {
    type: "billing.points.adjusted",
    aggregate: { type: "billing_account", id: account.entityId },
    payload: {
      v: 1,
      entityId: account.entityId,
      pointAdjustmentRequestId: input.pointAdjustmentRequestId,
      deltaPoints,
    },
    dedupeKey: `ledger:${opKey}`,
    entityId: account.entityId,
    storeId: null,
  });
  await reached(deps, "event.emit");
  return {
    operationId: written.id,
    deltaPoints,
    pointLotId: written.lotIds[0] ?? null,
    replayed: false,
  };
}

export interface ResumeAddonInput {
  /** 过期后重新开通的那一期：已建好并生效、账户已指向它 */
  readonly subscriptionTermId: string;
  /** 操作人：不给即系统动作。履约可以传入账事务的身份上下文 */
  readonly ctx?: IdentityContext;
}

export interface ResumeAddonResult {
  readonly operationId: string;
  readonly replayed: boolean;
}

/**
 * 过期后重新开通：加购积分恢复可用。只记闸门开合（净变动 0），批次数量不动；不另发事件
 * （billing.subscription.resumed 只由补偿延长发，m07 第 3 节）。
 * 履约（W1-11a）建好周期（origin = resume）、把账户置为生效、发完首月之后调。
 */
export async function resumeAddon(
  tx: Tx,
  deps: LedgerDeps,
  { clock, account }: Entered,
  input: ResumeAddonInput,
): Promise<ResumeAddonResult> {
  const term = await tx.subscriptionTerm.findUniqueOrThrow({
    where: { id: input.subscriptionTermId },
  });
  const endDate = fromDateColumn(term.endDate);
  // 键带止日：延长复活时止日已变，是新的键（D1 第 8.3 节）
  const opKey = `resume:subscription_term:${term.id}:${endDate}`;
  const existing = await findOperation(tx, opKey);
  if (existing !== null) return { operationId: existing.id, replayed: true };
  if (
    term.origin !== "resume" ||
    term.status !== "active" ||
    account.subStatus !== "active" ||
    account.currentSubscriptionTermId !== term.id
  ) {
    throw new LedgerError("guard", "加购积分恢复：只在过期后重新开通的那一期生效之后记", {
      subscriptionTermId: term.id,
      origin: term.origin,
      status: term.status,
    });
  }
  const written = await writeOperation(tx, deps, clock, account, {
    opKey,
    opType: "addon_resume",
    ref: { type: "subscription_term", id: term.id },
    occurredAt: clock.now,
    bizDate: clock.today,
    title: { code: "addon_resume", args: { termEndDate: endDate } },
    ctx: input.ctx ?? systemContext(account.entityId),
    gateOpen: await gateOpen(tx, account),
  });
  await selfCheck(tx, clock, written);
  return { operationId: written.id, replayed: false };
}
