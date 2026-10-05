// timers：定时器的登记、取消、改期与周期任务的补登记（W0-17）。扫描认领与执行在 W0-23。用法见本目录的 README.md。
import type { Assembly, Tx } from "../kernel/index.js";
import { arm, cancel } from "./arm.js";
import type { ArmInput, ArmResult, CancelInput } from "./arm.js";
import { ensureRecurring } from "./recurring.js";
import type { EnsureRecurringResult } from "./recurring.js";
import { buildTimerRegistry } from "./registry.js";
import type { TimerCatalog, TimerRegistry } from "./registry.js";

export interface TimersDeps {
  /** 本进程的装配结果：定时器处理器与周期任务的登记从这里来 */
  readonly assembly: Assembly;
  /** 名字的来源；缺省即契约的登记。只有用例会换它（追加样例 kind） */
  readonly catalog?: TimerCatalog;
}

export interface Timers {
  /** 登记或改期；调用方已持有主体业务行的锁 */
  arm(tx: Tx, input: ArmInput): Promise<ArmResult>;
  /** 取消一个主体上未完成的定时器，返回被取消的行的 id */
  cancel(tx: Tx, input: CancelInput): Promise<string[]>;
  /** 周期任务补登记一轮；now 取注入的时钟 */
  ensureRecurring(tx: Tx, now: Date): Promise<EnsureRecurringResult>;
  /** 对照过契约的登记：W0-23 的扫描与执行从这里查关键类、节奏、模式 */
  readonly registry: TimerRegistry;
}

/**
 * 进程启动时建一次（api、worker 都建）。定时器处理器与周期任务的登记对不上契约即抛 TimerRegistryError：
 * 名字不在契约里、critical 与契约不一致、周期任务没写节奏。
 */
export function createTimers(deps: TimersDeps): Timers {
  const registry = buildTimerRegistry(deps.assembly, deps.catalog);
  return {
    arm: (tx, input) => arm(tx, registry, input),
    cancel,
    ensureRecurring: (tx, now) => ensureRecurring(tx, registry, now),
    registry,
  };
}

export { currentTimerId, runAsCurrentTimer } from "./arm.js";
export type { ArmInput, ArmOutcome, ArmResult, CancelInput, TimerStatus } from "./arm.js";
export { recurringKey, slotText, timerKey, timerKeyPrefix } from "./keys.js";
export type { TimerSubject } from "./keys.js";
export { armRecurringSlot } from "./recurring.js";
export type { EnsureRecurringResult } from "./recurring.js";
export { purgeFiredRecurring, RECURRING_RETENTION_DAYS, registration } from "./register.js";
export { CONTRACT_TIMER_CATALOG, TimerRegistryError } from "./registry.js";
export type { ScheduledJob, TimerCatalog, TimerKindInfo, TimerRegistry } from "./registry.js";
export { scheduleProblem, slotAfter, slotAtOrBefore } from "./schedule.js";
