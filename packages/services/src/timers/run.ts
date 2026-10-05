// 定时器的执行 runTimer（W0-23）：队列的处理器与扫描循环的进程内执行走同一个函数。
// 依据：01 分组 第 2.5 节状态机；D3 第 21.3 节。
//
//   1. 先做不加锁的预检：状态不是 dispatched、或认领序号对不上，即已取消或已被接管，直接结束。
//   2. 处理器与定时器行的完成标记同一个事务。最后才碰 timer 行，影响 0 行（并发被取消或被接管）时照常提交：
//      业务效果的恰好一次由处理器在主体行锁下的状态守卫与事件去重键保证，不靠 timer 行。
//      这个次序不能反过来：业务事务是先锁业务行、再改 timer 行（arm、cancel），处理器先锁 timer 行就会相撞。
//   3. 处理器抛错：整个事务回滚，另开短事务记一次失败并写重试时间（退避 1、2、5、15、30 分钟）。
//      非关键类第 6 次置 failed 并告警；关键类不进终态，回到 scheduled、每 30 分钟重试并升级告警。
//   4. 周期任务的 tx 模式也走这里：处理器从 ctx.tx 拿本期的事务。job 模式转给 job-mode.ts。
import { TIMER_OUTCOMES } from "../kernel/index.js";
import { runAsCurrentTimer } from "./arm.js";
import { runJobTimer } from "./job-mode.js";
import {
  attemptLimit,
  finishTimer,
  raiseTimerFailed,
  readTimer,
  recurringJobOf,
  scheduledForOf,
  TIMER_MAX_ATTEMPTS,
  timerErrorSummary,
} from "./scan.js";
import type { RunTimerOutcome, TimerRef, TimerRunDeps } from "./scan.js";

/** 第 n 次失败后的退避，秒：1、2、5、15、30 分钟，之后每 30 分钟 */
export const TIMER_BACKOFF_SEC = [60, 120, 300, 900, 1800] as const;

export async function runTimer(deps: TimerRunDeps, ref: TimerRef): Promise<RunTimerOutcome> {
  const job = recurringJobOf(deps.registry, ref.kind);
  if (job?.mode === "job") return runJobTimer(deps, ref, job);
  try {
    return await deps.tx.run(async (tx): Promise<RunTimerOutcome> => {
      const timer = await readTimer(tx, ref.timerId);
      if (timer?.status !== "dispatched" || timer.dispatchNo !== ref.dispatchNo) return "stale";
      if (job !== undefined) {
        const result = await job.run({ scheduledFor: scheduledForOf(timer), tx });
        await finishTimer(tx, ref, "fired", result);
        return "fired";
      }
      const handler = deps.assembly.timerHandler(timer.kind);
      if (handler === undefined) throw new Error(`定时器 ${timer.kind} 在本进程没有登记处理器`);
      const lateMs = deps.clock.now().getTime() - timer.fireAt.getTime();
      const tooLate =
        handler.maxLateMinutes !== undefined && lateMs > handler.maxLateMinutes * 60_000;
      const { id, kind, subjectType, subjectId, payload } = timer;
      const outcome = tooLate
        ? "skipped"
        : await runAsCurrentTimer(id, () =>
            handler.handle(tx, { id, kind, subjectType, subjectId, payload }),
          );
      if (!TIMER_OUTCOMES.includes(outcome)) {
        throw new Error(`定时器 ${kind} 的处理器要返回 ${TIMER_OUTCOMES.join(" 或 ")}`);
      }
      await finishTimer(tx, ref, outcome, null);
      return outcome;
    });
  } catch (error) {
    return failTimer(deps, ref, error);
  }
}

/** 失败短事务：次数加一、写重试时间；非关键类耗尽即 failed。行已被接管或取消时不动 */
async function failTimer(
  deps: Pick<TimerRunDeps, "tx" | "registry" | "alerts">,
  ref: TimerRef,
  error: unknown,
): Promise<RunTimerOutcome> {
  const lastError = timerErrorSummary(error);
  const [row] = await deps.tx.run((tx) =>
    tx.$queryRawUnsafe<Array<{ status: "scheduled" | "failed"; attempts: number }>>(
      `UPDATE timer
          SET attempts = LEAST(attempts + 1, 32767), last_error = $3::text, lease_until = NULL, updated_at = now(),
              status = CASE WHEN attempts + 1 >= $4::int THEN 'failed' ELSE 'scheduled' END,
              retry_at = now() + ($5::int[])[LEAST(attempts + 1, $6::int)] * interval '1 second'
        WHERE id = $1::uuid AND dispatch_no = $2::int AND status = 'dispatched'
       RETURNING status, attempts::int AS attempts`,
      ref.timerId,
      ref.dispatchNo,
      lastError,
      attemptLimit(deps.registry, ref.kind) ?? null,
      [...TIMER_BACKOFF_SEC],
      TIMER_BACKOFF_SEC.length,
    ),
  );
  if (row === undefined) return "stale";
  if (row.status === "failed") {
    await raiseTimerFailed(deps.alerts, ref, lastError);
    return "failed";
  }
  if (row.attempts >= TIMER_MAX_ATTEMPTS) {
    // 关键类：不进终态，升级告警，等人处理的同时照常重试
    await deps.alerts.raise({
      rule: "timer.critical_retrying",
      dimension: ref.kind,
      severity: "P1",
      detail: { timerId: ref.timerId, attempts: row.attempts, lastError },
    });
  }
  return "retry";
}
