// 账本内核的共用类型与内部错误（W1-10）。
import type {
  EnumValue,
  POINT_BUCKET,
  POINT_HOLD_STATUS,
  POINT_LOT_KIND,
} from "@liyoxi/contract/enums";
import type { PrismaClient } from "@liyoxi/db";

import type { Events } from "../../events/index.js";
import type { Clock, Tx } from "../../kernel/index.js";

/** 只读用：Prisma 客户端或事务句柄。读函数不拿账户锁、不 advance */
export type Db = PrismaClient | Tx;

export type Bucket = EnumValue<typeof POINT_BUCKET>;
export type LotKind = EnumValue<typeof POINT_LOT_KIND>;

/** 账本每写完一步报一次的步骤名（07 分组 第 2.15 节“写入顺序”，另加周期与事件几步）。故障注入的用例按它下断点 */
export const LEDGER_STEPS = [
  "lot.insert",
  "schedule.grant",
  "operation.insert",
  "lot.update",
  "entry.insert",
  "account.update",
  "term.update",
  "subscription_event.insert",
  "event.emit",
  // 冻结单一族（第二个 PR）：新建冻结单、转为加购的新批次、分摊行、冻结单的状态与累计数量
  "hold.insert",
  "lot.convert",
  "alloc.write",
  "hold.update",
] as const;
export type LedgerStep = (typeof LEDGER_STEPS)[number];

export interface LedgerDeps {
  /** 业务时钟：账本时钟在拿到账户锁之后取它 */
  readonly clock: Clock;
  /** 出站事件：账本操作成功后在同一事务里发 */
  readonly events: Pick<Events, "emit">;
  /** 只有用例会给：每个写步骤之后调一次，抛错即在那一步中断（故障注入） */
  readonly onStep?: (step: LedgerStep) => void | Promise<void>;
}

export type LedgerRefusal =
  /** 一个事务只锁一个主体的计费账户（硬性规则 10） */
  | "one_account_per_tx"
  /** 守卫不成立：调用方给的对象不在该在的状态，或入参不合规 */
  | "guard"
  /** 同一个操作键已登记，入参与第一次不同 */
  | "op_key_conflict"
  /** 预约周期没有接在上一期的止点上 */
  | "term_chain"
  /** 冻结时取不到剧目积分价：没有热度等级又没有生效的单剧修订，或该等级没有模板价（上架的剧不该这样） */
  | "price_unavailable"
  /** 写入时自检不一致：回滚，不上报、不自愈 */
  | "self_check";

/** 账本的内部错误：都是代码缺陷或数据异常，不是用户输入的问题，接口层按 500 处理。业务上的拒绝走 AppError 与 HoldStateError */
export class LedgerError extends Error {
  readonly reason: LedgerRefusal;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(reason: LedgerRefusal, message: string, details: Record<string, unknown> = {}) {
    super(`账本操作没有执行：${message}`);
    this.name = "LedgerError";
    this.reason = reason;
    this.details = details;
  }
}

export type HoldStatus = EnumValue<typeof POINT_HOLD_STATUS>;

/**
 * 冻结单不在这个操作要求的状态。不是内部错误：调用方认得出、要自己决定怎么办——
 * 开工扣减时发现已释放（not_held）→ 整单回滚并告警；取消时发现已扣减（not_held）→ 改走退回；
 * 退回时还没扣减（not_captured）→ 改走释放；退回数超过可退（exceeds_refundable）→ 重新试算。
 */
export class HoldStateError extends Error {
  readonly reason: "not_held" | "not_captured" | "exceeds_refundable";
  readonly operation: "capture" | "release" | "refund";
  readonly pointHoldId: string;
  /** 冻结单此刻的状态 */
  readonly status: HoldStatus;
  /** 此刻还能退回的数量：应扣 − 已退回 − 不予退回（还没扣减的为 0） */
  readonly refundableQty: number;

  constructor(
    operation: HoldStateError["operation"],
    reason: HoldStateError["reason"],
    hold: { id: string; status: string; qty: number; returnedQty: number; forfeitedQty: number },
  ) {
    super(`冻结单 ${hold.id} 现在是 ${hold.status}，不能 ${operation}（${reason}）`);
    this.name = "HoldStateError";
    this.operation = operation;
    this.reason = reason;
    this.pointHoldId = hold.id;
    this.status = hold.status as HoldStatus;
    this.refundableQty =
      hold.status === "captured" || hold.status === "refunded_partial"
        ? hold.qty - hold.returnedQty - hold.forfeitedQty
        : 0;
  }
}
