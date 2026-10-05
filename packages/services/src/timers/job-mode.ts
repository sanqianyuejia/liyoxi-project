// 长任务模式（W0-23）：周期任务里要下载账单、跑备份的那些，登记为 mode: "job"。
// 依据：01 分组 第 2.5 节“长任务模式”；D7 第 7.6 节第 3 条；x01 第 4.2 节。
//
//   1. 认领确认：行锁下核对状态与认领序号，把租约换成登记的租期，事务到此结束。之后处理器在事务外执行。
//   2. 续租：每过租期的三分之一把租约往后推；影响 0 行即已被接管或取消，经 signal 通知处理器收手，结果不落。
//   3. 抛错：行保持 dispatched，记一次失败，把租约设到退避之后（1、5、15、30、60 分钟），到点由扫描循环重新认领；
//      失败达到登记的 maxAttempts 置 failed 并告警。进程崩溃：没人续租，租约到期后被重新认领。
//   4. 不在事务里，恰好一次靠处理器自己的业务键幂等；它要写库时用 ctx.runTx 自己开小事务。
import type { ScheduledJob } from "./registry.js";
import {
  attemptLimit,
  finishTimer,
  raiseTimerFailed,
  readTimer,
  scheduledForOf,
  TIMER_LEASE_SEC,
  timerErrorSummary,
} from "./scan.js";
import type { RunTimerOutcome, TimerRef, TimerRunDeps } from "./scan.js";

/** 第 n 次失败后租约后移多少秒：1、5、15、30、60 分钟 */
export const JOB_BACKOFF_SEC = [60, 300, 900, 1800, 3600] as const;

type JobDeps = Pick<TimerRunDeps, "tx" | "registry" | "alerts">;

const pushLease = (deps: JobDeps, ref: TimerRef, leaseSec: number): Promise<number> =>
  deps.tx.run((tx) =>
    tx.$executeRawUnsafe(
      `UPDATE timer SET lease_until = now() + $3::int * interval '1 second', updated_at = now()
        WHERE id = $1::uuid AND dispatch_no = $2::int AND status = 'dispatched'`,
      ref.timerId,
      ref.dispatchNo,
      leaseSec,
    ),
  );

export async function runJobTimer(
  deps: JobDeps,
  ref: TimerRef,
  job: ScheduledJob,
): Promise<RunTimerOutcome> {
  const leaseSec = job.leaseSec ?? TIMER_LEASE_SEC;
  const scheduledFor = await deps.tx.run(async (tx) => {
    const timer = await readTimer(tx, ref.timerId, true);
    if (timer?.status !== "dispatched" || timer.dispatchNo !== ref.dispatchNo) return undefined;
    await tx.$executeRawUnsafe(
      "UPDATE timer SET lease_until = now() + $2::int * interval '1 second', updated_at = now() WHERE id = $1::uuid",
      ref.timerId,
      leaseSec,
    );
    return scheduledForOf(timer);
  });
  if (scheduledFor === undefined) return "stale";

  const abort = new AbortController();
  const renewing = setInterval(
    () => {
      pushLease(deps, ref, leaseSec).then(
        (rows) => {
          if (rows === 0) abort.abort();
        },
        () => undefined, // 续租这一下没成：下一下再来，真续不上由租约到期兜底
      );
    },
    (leaseSec * 1000) / 3,
  );
  try {
    const result = await job.run({ scheduledFor, signal: abort.signal, runTx: deps.tx.run });
    clearInterval(renewing);
    if (abort.signal.aborted) return "stale";
    const done = await deps.tx.run((tx) => finishTimer(tx, ref, "fired", result));
    return done === 1 ? "fired" : "stale";
  } catch (error) {
    clearInterval(renewing);
    const lastError = timerErrorSummary(error);
    const [row] = await deps.tx.run((tx) =>
      tx.$queryRawUnsafe<Array<{ status: string }>>(
        `UPDATE timer
            SET attempts = LEAST(attempts + 1, 32767), last_error = $3::text, is_enqueued = false, updated_at = now(),
                status = CASE WHEN attempts + 1 >= $4::int THEN 'failed' ELSE 'dispatched' END,
                lease_until = CASE WHEN attempts + 1 >= $4::int THEN NULL
                                   ELSE now() + ($5::int[])[LEAST(attempts + 1, $6::int)] * interval '1 second' END
          WHERE id = $1::uuid AND dispatch_no = $2::int AND status = 'dispatched'
         RETURNING status`,
        ref.timerId,
        ref.dispatchNo,
        lastError,
        attemptLimit(deps.registry, ref.kind) ?? null,
        [...JOB_BACKOFF_SEC],
        JOB_BACKOFF_SEC.length,
      ),
    );
    if (row === undefined) return "stale";
    if (row.status !== "failed") return "retry";
    await raiseTimerFailed(deps.alerts, ref, lastError);
    return "failed";
  }
}
