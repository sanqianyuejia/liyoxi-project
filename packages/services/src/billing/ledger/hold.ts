// 冻结单一族（W1-10 第二个 PR）：冻结 hold、扣减 capture、释放 release、退回 refund。
// 依据：07 分组 第 2.13、2.14 节（状态表、分摊）、第 3.3、3.4 节（操作键、桶移动）、第 4.5 节（快照）；
//       D1 第 7.2–7.5 节；03 第 2.6 节；任务书 第 2 节规定 5–8。
// 调用方（index.ts）已经拿了账户锁、取了账本时钟、推进过；这里从“按操作键查”开始：
//   已登记即返回第一次的结果 → 守卫 → 算好桶移动 → 经 writeOperation 落库 → 自检 → 发事件。
// 账本不懂交付阶段：退回多少由调用方按规则算好传进来；去向（原路、转加购、不予退回）由这里按下单时的快照定。
import { PricingSnapshotSchema } from "@liyoxi/contract";
import type { LedgerTitleArgs, PricingSnapshot } from "@liyoxi/contract";
import type { EnumValue, POINT_HOLD_PURPOSE, RETURN_REASON_CLASS } from "@liyoxi/contract/enums";
import type { LedgerOperation, PointHold, PointHoldAlloc, PointLot, Prisma } from "@liyoxi/db";
import { allocate, orderLotsForDeduction, PointsInsufficientError } from "@liyoxi/shared/alloc";
import type { DeductibleLot } from "@liyoxi/shared/alloc";

import { AppError, uuidv7 } from "../../kernel/index.js";
import type { IdentityContext, Tx } from "../../kernel/index.js";
import { quoteHold } from "../pricing/quote.js";
import type { HoldPricing } from "../pricing/quote.js";
import type { LedgerClock } from "./context.js";
import { findOperation, isRefundPending, reached, writeOperation } from "./operation.js";
import type {
  AccountState,
  BucketMove,
  Conversion,
  HoldWrite,
  LotRef,
  OperationTitle,
} from "./operation.js";
import { selfCheck } from "./self-check.js";
import { HoldStateError, LedgerError } from "./types.js";
import type { LedgerDeps } from "./types.js";

export type HoldRefType = EnumValue<typeof POINT_HOLD_PURPOSE>;
export type ReturnReasonClass = EnumValue<typeof RETURN_REASON_CLASS>;

/** 进入账本之后的现场：账本时钟与推进之后的账户状态 */
export interface Entered {
  readonly clock: LedgerClock;
  readonly account: AccountState;
}

export interface HoldInput {
  readonly entityId: string;
  /** 下单门店：必须属于这个主体（库里有复合外键） */
  readonly storeId: string;
  /** 业务引用：订单项、广告、广告修改记录。不要求业务行已存在——订购侧先冻结、拿到冻结单 id 再插自己的行 */
  readonly refType: HoldRefType;
  readonly refId: string;
  /** 展示聚合键：同一订购单或同一次广告提交的业务单号 */
  readonly groupRef?: string | null;
  readonly pricing: HoldPricing;
  /** 报价时看到的应扣积分。给了就与锁内重算的值比，不等抛 QUOTE_CHANGED */
  readonly expectS?: number;
  /** 展示文案：订购冻结取整单的值（m07 第 4.5 节） */
  readonly title: Extract<
    OperationTitle,
    { code: "order_hold" | "ad_hold" | "ad_revision_charge" }
  >;
  readonly ctx: IdentityContext;
}

export interface HoldResult {
  readonly pointHoldId: string;
  readonly operationId: string;
  /** 应扣积分 S */
  readonly points: number;
  /** 计价与规则快照：订购侧原样存到订单项或广告上 */
  readonly snapshot: PricingSnapshot;
  /** 落在哪些批次，按扣减顺序 */
  readonly allocations: readonly {
    readonly pointLotId: string;
    readonly lotKind: string;
    readonly qty: number;
  }[];
  /** 账本时钟：订购侧同一事务里的提交时间、同意时间用它 */
  readonly now: Date;
  readonly replayed: boolean;
}

export interface CaptureInput {
  readonly pointHoldId: string;
  readonly title: LedgerTitleArgs<"capture">;
  readonly ctx: IdentityContext;
}

export interface CaptureResult {
  readonly pointHoldId: string;
  readonly operationId: string;
  readonly points: number;
  readonly replayed: boolean;
}

export interface ReleaseInput {
  readonly pointHoldId: string;
  /** 退回原因类别：原周期已结束时按快照里它对应的去向 */
  readonly reasonClass: ReturnReasonClass;
  readonly title: LedgerTitleArgs<"release">;
  readonly ctx: IdentityContext;
}

export interface RefundInput {
  readonly pointHoldId: string;
  /** 退回数量：调用方按阶段扣除规则算好；不超过 应扣 − 已退回 − 不予退回 */
  readonly qty: number;
  readonly reasonClass: ReturnReasonClass;
  /** 这次退回的身份：取消明细（键 refund:{id}）；平台原因调整引起的退回是审批单（键 adjust:{审批单号}） */
  readonly source:
    | { readonly type: "cancel_request_line"; readonly id: string }
    | { readonly type: "approval_request"; readonly id: string; readonly requestNo: string };
  /** 展示用的业务单号 */
  readonly refNo: string;
  readonly ctx: IdentityContext;
}

export interface ReturnResult {
  readonly pointHoldId: string;
  readonly operationId: string;
  /** 回到原批次 */
  readonly returnedPoints: number;
  /** 转为加购积分 */
  readonly convertedPoints: number;
  /** 不予退回 */
  readonly forfeitedPoints: number;
  readonly replayed: boolean;
}

const PURPOSE_OF = { drama: "order_item", ad: "ad", ad_revision: "ad_revision" } as const;

const lotRef = (lot: PointLot): LotRef => ({
  id: lot.id,
  kind: lot.kind,
  planId: lot.planId,
  subscriptionTermId: lot.subscriptionTermId,
});

/** 操作之后闸门开不开：订阅生效且不在退款处理中 */
export const gateOpen = async (tx: Tx, account: AccountState): Promise<boolean> =>
  account.subStatus === "active" && !(await isRefundPending(tx, account.entityId));

/**
 * 扣减顺序里此刻可取的批次：当前周期的套餐批次（还有可用、没到期）按（到期、入账、id），
 * 再接加购批次按（入账、id）。kind 给了就只取那一类（调整扣减）。
 */
export async function deductibleLots(
  tx: Tx,
  { clock, account }: Entered,
  kind?: "plan" | "addon",
): Promise<PointLot[]> {
  const lots = await tx.pointLot.findMany({
    where: {
      entityId: account.entityId,
      availableQty: { gt: 0 },
      OR: [
        ...(kind === "addon" || account.currentSubscriptionTermId === null
          ? []
          : [
              {
                kind: "plan",
                subscriptionTermId: account.currentSubscriptionTermId,
                expiresAt: { gt: clock.now },
              },
            ]),
        ...(kind === "plan" ? [] : [{ kind: "addon" }]),
      ],
    },
  });
  return orderLotsForDeduction(lots as (PointLot & DeductibleLot)[]);
}

const holdEvent = (hold: Pick<PointHold, "id" | "entityId" | "qty" | "refType" | "refId">) => ({
  v: 1 as const,
  entityId: hold.entityId,
  pointHoldId: hold.id,
  points: hold.qty,
  refType: hold.refType as HoldRefType,
  refId: hold.refId,
});

async function replayHold(
  tx: Tx,
  clock: LedgerClock,
  existing: LedgerOperation,
  input: HoldInput,
): Promise<HoldResult> {
  const hold = await tx.pointHold.findUniqueOrThrow({
    where: { refType_refId: { refType: input.refType, refId: input.refId } },
    include: { pointHoldAllocs: { orderBy: { allocNo: "asc" } } },
  });
  const snapshot = PricingSnapshotSchema.parse(hold.pricingSnapshot);
  const { pricing } = input;
  const same =
    hold.entityId === input.entityId &&
    hold.storeId === input.storeId &&
    snapshot.kind === pricing.kind &&
    (snapshot.kind !== "drama" ||
      (pricing.kind === "drama" &&
        snapshot.dramaId === pricing.dramaId &&
        snapshot.topModelSelected === pricing.topModel));
  if (!same) {
    // 同一业务引用不得换内容（D1 第 7.2 节）
    throw new LedgerError("op_key_conflict", "这个业务引用已冻结，计价入参与第一次不同", {
      opKey: existing.opKey,
    });
  }
  return {
    pointHoldId: hold.id,
    operationId: existing.id,
    points: hold.qty,
    snapshot,
    allocations: hold.pointHoldAllocs.map((alloc) => ({
      pointLotId: alloc.pointLotId,
      lotKind: alloc.lotKind,
      qty: alloc.qty,
    })),
    now: clock.now,
    replayed: true,
  };
}

/** 冻结：锁内按账本时钟重算应扣积分并生成快照，按扣减顺序从批次的“可用”移到“冻结” */
export async function hold(
  tx: Tx,
  deps: LedgerDeps,
  entered: Entered,
  input: HoldInput,
): Promise<HoldResult> {
  const { clock, account } = entered;
  const opKey = `hold:${input.refType}:${input.refId}`;
  const existing = await findOperation(tx, opKey);
  if (existing !== null) return replayHold(tx, clock, existing, input);
  if (PURPOSE_OF[input.pricing.kind] !== input.refType) {
    throw new LedgerError("guard", "冻结：业务引用的类型与计价入参对不上", {
      refType: input.refType,
      kind: input.pricing.kind,
    });
  }
  // 守卫：订阅生效（已推进，当前周期就是生效周期）、不在退款处理中
  if (account.subStatus !== "active" || account.currentSubscriptionTermId === null) {
    throw new AppError("SUBSCRIPTION_INACTIVE");
  }
  if (await isRefundPending(tx, account.entityId)) throw new AppError("PLAN_REFUND_IN_PROGRESS");
  const term = await tx.subscriptionTerm.findUniqueOrThrow({
    where: { id: account.currentSubscriptionTermId },
  });
  const snapshot = await quoteHold(tx, term, input.pricing, clock.now);
  const S = snapshot.S;
  if (input.expectS !== undefined && input.expectS !== S) {
    throw new AppError("QUOTE_CHANGED", {
      details: {
        kind: "points",
        totalChargePoints: S,
        items: [{ dramaId: snapshot.kind === "drama" ? snapshot.dramaId : null, chargePoints: S }],
      },
    });
  }
  const lots = await deductibleLots(tx, entered);
  let taken: ReturnType<typeof allocate>;
  try {
    taken = allocate(S, lots);
  } catch (error) {
    if (!(error instanceof PointsInsufficientError)) throw error;
    throw new AppError("POINTS_INSUFFICIENT", {
      details: {
        requiredPoints: S,
        spendablePoints: S - error.shortfall,
        shortfallPoints: error.shortfall,
      },
      cause: error,
    });
  }
  const byId = new Map(lots.map((lot) => [lot.id, lotRef(lot)]));
  const allocs = taken.map(({ lotId, qty }) => ({ lot: byId.get(lotId) as LotRef, qty }));
  const pointHoldId = uuidv7();
  const written = await writeOperation(tx, deps, clock, account, {
    opKey,
    opType: "hold",
    ref: { type: input.refType, id: input.refId },
    storeId: input.storeId,
    occurredAt: clock.now,
    bizDate: clock.today,
    title: input.title,
    ctx: input.ctx,
    moves: allocs.map(({ lot, qty }) => ({ lot, from: "available", to: "held", qty })),
    hold: {
      id: pointHoldId,
      insert: {
        storeId: input.storeId,
        purpose: input.refType,
        refId: input.refId,
        groupRef: input.groupRef ?? null,
        qty: S,
        pricingSnapshot: snapshot as Prisma.InputJsonValue,
        subscriptionTermId: term.id,
      },
      allocs,
    },
    gateOpen: true,
  });
  await selfCheck(tx, clock, written);
  await deps.events.emit(tx, input.ctx, {
    type: "billing.points.held",
    aggregate: { type: "billing_account", id: account.entityId },
    payload: holdEvent({
      id: pointHoldId,
      entityId: account.entityId,
      qty: S,
      refType: input.refType,
      refId: input.refId,
    }),
    dedupeKey: `ledger:${opKey}`,
    entityId: account.entityId,
    storeId: input.storeId,
  });
  await reached(deps, "event.emit");
  return {
    pointHoldId,
    operationId: written.id,
    points: S,
    snapshot,
    allocations: allocs.map(({ lot, qty }) => ({ pointLotId: lot.id, lotKind: lot.kind, qty })),
    now: clock.now,
    replayed: false,
  };
}

type HoldWithAllocs = PointHold & { pointHoldAllocs: (PointHoldAlloc & { pointLot: PointLot })[] };

/** 在账户锁内读冻结单与它的分摊（连批次），分摊按顺序号 */
export async function loadHold(tx: Tx, pointHoldId: string): Promise<HoldWithAllocs> {
  const found = await tx.pointHold.findUnique({
    where: { id: pointHoldId },
    include: { pointHoldAllocs: { orderBy: { allocNo: "asc" }, include: { pointLot: true } } },
  });
  if (found === null) throw new LedgerError("guard", "冻结单不存在", { pointHoldId });
  return found;
}

const businessRef = (found: PointHold) => ({ type: found.refType as HoldRefType, id: found.refId });

/** 扣减：冻结 → 已消耗。不要求订阅生效，也不受退款闸门影响（冻结时已视为使用） */
export async function capture(
  tx: Tx,
  deps: LedgerDeps,
  { clock, account }: Entered,
  input: CaptureInput,
): Promise<CaptureResult> {
  const found = await loadHold(tx, input.pointHoldId);
  const opKey = `capture:point_hold:${found.id}`;
  const existing = await findOperation(tx, opKey);
  const result = { pointHoldId: found.id, points: found.qty };
  if (existing !== null) return { ...result, operationId: existing.id, replayed: true };
  // 已释放的冻结单不能再扣：调用方（开工）据此整单回滚
  if (found.status !== "held") throw new HoldStateError("capture", "not_held", found);
  const written = await writeOperation(tx, deps, clock, account, {
    opKey,
    opType: "capture",
    ref: businessRef(found),
    storeId: found.storeId,
    occurredAt: clock.now,
    bizDate: clock.today,
    title: { code: "capture", args: input.title },
    ctx: input.ctx,
    moves: found.pointHoldAllocs.map((alloc) => ({
      lot: lotRef(alloc.pointLot),
      from: "held",
      to: "consumed",
      qty: alloc.qty,
    })),
    hold: { id: found.id, update: { status: "captured", capturedAt: clock.now } },
    gateOpen: await gateOpen(tx, account),
  });
  await selfCheck(tx, clock, written);
  await deps.events.emit(tx, input.ctx, {
    type: "billing.points.captured",
    aggregate: { type: "billing_account", id: account.entityId },
    payload: holdEvent(found),
    dedupeKey: `ledger:${opKey}`,
    entityId: account.entityId,
    storeId: found.storeId,
  });
  await reached(deps, "event.emit");
  return { ...result, operationId: written.id, replayed: false };
}

interface ReturnPlan {
  readonly moves: BucketMove[];
  readonly conversions: Conversion[];
  readonly allocDeltas: NonNullable<HoldWrite["allocDeltas"]>[number][];
  returned: number;
  converted: number;
  forfeited: number;
}

/**
 * 退回 qty 积分落到哪里（D1 第 7.4 节 returnPoints）。从分摊序列的尾部退起：留存的部分按原扣减顺序留在头部。
 *   加购批次、或所属周期仍是生效周期的套餐批次 → 原路退回到“可用”；
 *   原周期已结束的套餐批次 → 按下单时快照里这个原因类别的去向：转为加购积分，或不予退回（记清零）。
 * 读快照，不读当前参数。
 */
function planReturn(
  found: HoldWithAllocs,
  qty: number,
  from: "held" | "consumed",
  rule: "addon" | "forfeit",
  { clock, account }: Entered,
): ReturnPlan {
  const plan: ReturnPlan = {
    moves: [],
    conversions: [],
    allocDeltas: [],
    returned: 0,
    converted: 0,
    forfeited: 0,
  };
  let rest = qty;
  for (const alloc of [...found.pointHoldAllocs].reverse()) {
    const take = Math.min(rest, alloc.qty - alloc.returnedQty - alloc.forfeitedQty);
    if (take <= 0) continue;
    const lot = alloc.pointLot;
    const live =
      lot.kind === "addon" ||
      (lot.subscriptionTermId === account.currentSubscriptionTermId &&
        lot.expiresAt !== null &&
        lot.expiresAt > clock.now);
    if (live) {
      plan.moves.push({ lot: lotRef(lot), from, to: "available", qty: take });
      plan.returned += take;
    } else if (rule === "addon") {
      plan.conversions.push({ lot: lotRef(lot), from, qty: take });
      plan.converted += take;
    } else {
      plan.moves.push({ lot: lotRef(lot), from, to: "expired", qty: take });
      plan.forfeited += take;
    }
    plan.allocDeltas.push({
      allocNo: alloc.allocNo,
      returnedQty: live || rule === "addon" ? take : 0,
      forfeitedQty: live || rule === "addon" ? 0 : take,
    });
    rest -= take;
  }
  if (rest !== 0) {
    throw new LedgerError("guard", "退回数量超过分摊里还能退的", { pointHoldId: found.id, qty });
  }
  return plan;
}

/** 已登记的释放、退回：三个数量从那次操作的流水读回来 */
async function replayReturn(
  tx: Tx,
  existing: LedgerOperation,
  expected: { pointHoldId: string; qty?: number },
): Promise<ReturnResult> {
  const entries = await tx.pointLedgerEntry.findMany({
    where: { ledgerOperationId: existing.id },
    select: { fromBucket: true, toBucket: true, qty: true },
  });
  const sum = (to: string): number =>
    entries
      .filter((entry) => entry.toBucket === to && entry.fromBucket !== "external")
      .reduce((total, entry) => total + entry.qty, 0);
  const result = {
    pointHoldId: expected.pointHoldId,
    operationId: existing.id,
    returnedPoints: sum("available"),
    convertedPoints: sum("converted_out"),
    forfeitedPoints: sum("expired"),
    replayed: true,
  };
  const total = result.returnedPoints + result.convertedPoints + result.forfeitedPoints;
  if (
    existing.pointHoldId !== expected.pointHoldId ||
    (expected.qty !== undefined && expected.qty !== total)
  ) {
    throw new LedgerError("op_key_conflict", "这次退回已登记，冻结单或数量与第一次不同", {
      opKey: existing.opKey,
    });
  }
  return result;
}

interface ReturnArgs {
  readonly opKey: string;
  readonly opType: "release" | "refund";
  readonly ref: { readonly type: HoldRefType | RefundInput["source"]["type"]; readonly id: string };
  readonly from: "held" | "consumed";
  readonly qty: number;
  readonly reasonClass: ReturnReasonClass;
  readonly title: (plan: ReturnPlan) => OperationTitle;
  readonly ctx: IdentityContext;
}

/** 释放与退回共用：按去向算好移动，落库，更新冻结单的状态与累计数量 */
async function giveBack(
  tx: Tx,
  deps: LedgerDeps,
  entered: Entered,
  found: HoldWithAllocs,
  args: ReturnArgs,
): Promise<ReturnResult> {
  const { clock, account } = entered;
  const snapshot = PricingSnapshotSchema.parse(found.pricingSnapshot);
  const plan = planReturn(
    found,
    args.qty,
    args.from,
    snapshot.expiredTermRefund[args.reasonClass],
    entered,
  );
  const returnedQty = plan.returned + plan.converted;
  const closed = found.returnedQty + found.forfeitedQty + args.qty === found.qty;
  const status =
    args.opType === "release" ? "released" : closed ? "refunded_full" : "refunded_partial";
  const written = await writeOperation(tx, deps, clock, account, {
    opKey: args.opKey,
    opType: args.opType,
    ref: args.ref,
    storeId: found.storeId,
    occurredAt: clock.now,
    bizDate: clock.today,
    title: args.title(plan),
    ctx: args.ctx,
    moves: plan.moves,
    conversions: plan.conversions,
    hold: {
      id: found.id,
      allocDeltas: plan.allocDeltas,
      update: {
        status,
        returnedQty,
        forfeitedQty: plan.forfeited,
        ...(closed ? { closedAt: clock.now } : {}),
      },
    },
    gateOpen: await gateOpen(tx, account),
  });
  await selfCheck(tx, clock, written);
  await deps.events.emit(tx, args.ctx, {
    type: "billing.points.returned",
    aggregate: { type: "billing_account", id: account.entityId },
    payload: {
      v: 1,
      entityId: account.entityId,
      pointHoldId: found.id,
      returnedPoints: plan.returned,
      convertedPoints: plan.converted,
      forfeitedPoints: plan.forfeited,
    },
    dedupeKey: `ledger:${args.opKey}`,
    entityId: account.entityId,
    storeId: found.storeId,
  });
  await reached(deps, "event.emit");
  return {
    pointHoldId: found.id,
    operationId: written.id,
    returnedPoints: plan.returned,
    convertedPoints: plan.converted,
    forfeitedPoints: plan.forfeited,
    replayed: false,
  };
}

/** 释放：开工前取消、资质不通过。全额，来源桶是“冻结” */
export async function release(
  tx: Tx,
  deps: LedgerDeps,
  entered: Entered,
  input: ReleaseInput,
): Promise<ReturnResult> {
  const found = await loadHold(tx, input.pointHoldId);
  const opKey = `release:point_hold:${found.id}`;
  const existing = await findOperation(tx, opKey);
  if (existing !== null) return replayReturn(tx, existing, { pointHoldId: found.id });
  // 已扣减的不能释放：调用方（取消）据此改走退回
  if (found.status !== "held") throw new HoldStateError("release", "not_held", found);
  return giveBack(tx, deps, entered, found, {
    opKey,
    opType: "release",
    ref: businessRef(found),
    from: "held",
    qty: found.qty,
    reasonClass: input.reasonClass,
    title: () => ({ code: "release", args: input.title }),
    ctx: input.ctx,
  });
}

/** 退回：开工后取消按阶段扣除、平台原因全额。来源桶是“已消耗”，可以分多次退到退完 */
export async function refund(
  tx: Tx,
  deps: LedgerDeps,
  entered: Entered,
  input: RefundInput,
): Promise<ReturnResult> {
  const { source } = input;
  const found = await loadHold(tx, input.pointHoldId);
  const opKey =
    source.type === "cancel_request_line" ? `refund:${source.id}` : `adjust:${source.requestNo}`;
  const existing = await findOperation(tx, opKey);
  if (existing !== null) {
    return replayReturn(tx, existing, { pointHoldId: found.id, qty: input.qty });
  }
  if (!Number.isSafeInteger(input.qty) || input.qty < 1) {
    throw new LedgerError("guard", "退回数量必须是正整数", { qty: input.qty });
  }
  if (found.status === "held" || found.status === "released") {
    throw new HoldStateError("refund", "not_captured", found);
  }
  if (input.qty > found.qty - found.returnedQty - found.forfeitedQty) {
    throw new HoldStateError("refund", "exceeds_refundable", found);
  }
  return giveBack(tx, deps, entered, found, {
    opKey,
    opType: "refund",
    ref: { type: source.type, id: source.id },
    from: "consumed",
    qty: input.qty,
    reasonClass: input.reasonClass,
    title: (plan) => ({
      code: "refund",
      args: {
        refNo: input.refNo,
        reasonClass: input.reasonClass,
        isConversion: plan.converted > 0,
      },
    }),
    ctx: input.ctx,
  });
}
