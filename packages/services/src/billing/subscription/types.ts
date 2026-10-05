// 履约的依赖与步骤名（W1-11a）。
import type { Events } from "../../events/index.js";
import type { Clock } from "../../kernel/index.js";
import { LEDGER_STEPS } from "../ledger/types.js";
import type { LedgerStep } from "../ledger/types.js";

/** 履约自己的写步骤；账本操作的步骤（批次、操作行、流水、账户、事件）沿用 LEDGER_STEPS */
export const FULFILL_OWN_STEPS = ["term.insert", "schedule.insert", "promo.insert"] as const;
export type FulfillStep = LedgerStep | (typeof FULFILL_OWN_STEPS)[number];
/** 一次履约会经过的全部步骤名：故障注入的用例按它下断点 */
export const FULFILL_STEPS: readonly FulfillStep[] = [...FULFILL_OWN_STEPS, ...LEDGER_STEPS];

/** 与账本的依赖同形（可以直接交给账本内部的函数），步骤名多三个 */
export interface FulfillDeps {
  /** 业务时钟：账本时钟在拿到账户锁之后取它 */
  readonly clock: Clock;
  readonly events: Pick<Events, "emit">;
  /** 只有用例会给：每个写步骤之后调一次，抛错即在那一步中断（故障注入） */
  readonly onStep?: (step: FulfillStep) => void | Promise<void>;
}
