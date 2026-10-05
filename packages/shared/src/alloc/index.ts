// 子路径 @liyoxi/shared/alloc：批次分配（扣减顺序）与分摊加尾差。用到 BigInt。
//
// 扣减顺序（03 第 2.6 节；D1 第 7.2 节）：先取当前周期的套餐批次，按到期时间升序；
// 再取加购批次，按入账时间升序。报价时的扣减来源预览与真正冻结用同一个函数。
//
// 分摊（D1 第 3.3 节；07 分组 第 2.11 节）：价值分摊不用四舍五入，用向下取整加尾差，
// 各份之和一定等于总额，尾差放最后一份。
//
// 这里只做排序与分配，不筛选：哪些批次属于当前周期、是否已到期，由调用方按账本时钟筛好再传入。
import type { PointLotKind } from "@liyoxi/contract/enums";

function nonNegativeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`分配：${label}必须是非负整数，收到 ${String(value)}`);
  }
  return value;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`分配：${label}必须是正整数，收到 ${String(value)}`);
  }
  return value;
}

/** 可供扣减的一个积分批次。字段与 point_lot 同义 */
export interface DeductibleLot {
  id: string;
  /** 套餐积分或加购积分：取值是契约的 POINT_LOT_KIND（point_lot.kind） */
  kind: PointLotKind;
  /** 可用数量 */
  availableQty: number;
  /** 入账时刻 */
  grantedAt: Date;
  /** 到期时刻；加购批次长期有效，为空 */
  expiresAt: Date | null;
}

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * 按扣减顺序排好批次：套餐批次在前，按（到期时间、入账时间、id）升序；
 * 加购批次在后，按（入账时间、id）升序。不改入参。
 */
export function orderLotsForDeduction<T extends DeductibleLot>(lots: readonly T[]): T[] {
  const rank = (lot: T): number => (lot.kind === "plan" ? 0 : 1);
  // 没有到期时刻的排在同类的最后
  const expiry = (lot: T): number => lot.expiresAt?.getTime() ?? Number.POSITIVE_INFINITY;
  return [...lots].sort((a, b) => {
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    if (rank(a) === 0 && expiry(a) !== expiry(b)) return expiry(a) < expiry(b) ? -1 : 1;
    const granted = a.grantedAt.getTime() - b.grantedAt.getTime();
    return granted !== 0 ? granted : compareText(a.id, b.id);
  });
}

export interface LotAllocation {
  lotId: string;
  qty: number;
}

export interface AllocationPlan {
  /** 各批次取多少，顺序同入参；取 0 的批次不出现 */
  allocations: LotAllocation[];
  /** 实际能取到的合计 */
  allocated: number;
  /** 缺口 = 需求量 − 能取到的合计；够用时为 0 */
  shortfall: number;
}

/**
 * 按给定顺序贪心取满：前一个批次取完才取下一个。不够也不抛错，缺口写在返回值里
 * （报价页的“还差多少积分”用它）。
 */
export function planAllocation(
  amount: number,
  lots: readonly Pick<DeductibleLot, "id" | "availableQty">[],
): AllocationPlan {
  let remaining = nonNegativeInteger(amount, "需求量");
  const allocations: LotAllocation[] = [];
  for (const lot of lots) {
    const available = nonNegativeInteger(lot.availableQty, `批次 ${lot.id} 的可用数量`);
    if (remaining === 0) continue;
    const qty = Math.min(available, remaining);
    if (qty > 0) allocations.push({ lotId: lot.id, qty });
    remaining -= qty;
  }
  return { allocations, allocated: amount - remaining, shortfall: remaining };
}

/** 积分不足。shortfall 是缺口数 */
export class PointsInsufficientError extends Error {
  readonly shortfall: number;

  constructor(shortfall: number) {
    super(`积分不足，还差 ${shortfall}`);
    this.name = "PointsInsufficientError";
    this.shortfall = shortfall;
  }
}

/** 同 planAllocation，但不够即抛 PointsInsufficientError。冻结用它 */
export function allocate(
  amount: number,
  lots: readonly Pick<DeductibleLot, "id" | "availableQty">[],
): LotAllocation[] {
  const plan = planAllocation(amount, lots);
  if (plan.shortfall > 0) throw new PointsInsufficientError(plan.shortfall);
  return plan.allocations;
}

/**
 * 把总额平均拆成 parts 份：每份向下取整，尾差放最后一份。
 * 例：周期实付按月数拆进月度发放计划（07 分组 第 2.11 节）。
 */
export function splitEvenly(total: number, parts: number): number[] {
  nonNegativeInteger(total, "总额");
  positiveInteger(parts, "份数");
  const share = Number(BigInt(total) / BigInt(parts));
  const result = new Array<number>(parts).fill(share);
  result[parts - 1] = total - share * (parts - 1);
  return result;
}

/**
 * 把总额按权重等比拆分：前面各份 = floor(总额 × 权重 ÷ 权重合计)，尾差放最后一份。
 * 权重必须是正整数。
 */
export function splitByWeights(total: number, weights: readonly number[]): number[] {
  nonNegativeInteger(total, "总额");
  if (weights.length === 0) throw new RangeError("分配：至少要有一份");
  let weightSum = 0n;
  for (const weight of weights) weightSum += BigInt(positiveInteger(weight, "权重"));

  const result: number[] = [];
  let assigned = 0;
  for (const weight of weights.slice(0, -1)) {
    const share = Number((BigInt(total) * BigInt(weight)) / weightSum);
    result.push(share);
    assigned += share;
  }
  result.push(total - assigned);
  return result;
}
