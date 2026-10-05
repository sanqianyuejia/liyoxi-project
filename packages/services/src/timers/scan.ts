// 定时器的扫描认领（W0-23）。依据：01 分组 第 2.5 节状态机；D3 第 21.3 节；x01 第 4.3 节。
// 登记、改期、取消在 arm.ts（W0-17）；执行在 run.ts、job-mode.ts；把认领到的行交给队列在 dispatch.ts。
// 本文件另放这几份共用的类型、常量与读写一行定时器的小函数。
//
//   1. 到期时间与状态都在库里：Redis 丢了任务、处理器失联，租约到期后重新认领。租约、重试时间用数据库时间。
//   2. 每次认领 dispatch_no + 1；执行时比对它，对不上即已被新一次认领接管。
//   3. 租约过期且上一次已入队（处理器失联）记一次失败，次数耗尽的在认领时就置 failed；入队失败不记。
//      关键类不设上限：晚了也要做，不进终态。
//   4. 周期任务的下一期在认领本期时就登记，不等本期执行完。下一期按“现在”之后的第一格算，不按本期往后数：
//      停机期间错过的那些格不逐个补跑，处理器都是按当前状态扫描，恢复后跑一次即追平（D3 第 21.4 节第 3 条）。
//   5. 多个实例同时扫描：FOR UPDATE SKIP LOCKED，各拿各的。扫描只锁 timer 行，不等任何业务行。
import type {
  Alerts,
  Assembly,
  Clock,
  FiredTimer,
  QueueChannel,
  TimerOutcome,
  Tx,
  TxRunner,
} from "../kernel/index.js";
import { armRecurringSlot } from "./recurring.js";
import type { ScheduledJob, TimerRegistry } from "./registry.js";
import { slotAfter } from "./schedule.js";

/** 定时器执行的队列名（契约登记的标识符） */
export const TIMER_QUEUE = "timer_run";
/** 一轮扫描至多认领多少行（D3 第 21.3 节） */
export const SCAN_BATCH_SIZE = 200;
/** 认领租约，秒；长任务模式认领确认后换成登记的租期 */
export const TIMER_LEASE_SEC = 300;
/** 非关键类失败满这么多次置 failed；长任务没登记 maxAttempts 时也用它 */
export const TIMER_MAX_ATTEMPTS = 6;
export const HANDLER_LOST = "处理器失联：租约到期仍未执行完";

export interface TimerRef {
  readonly timerId: string;
  /** 这一次认领的序号 */
  readonly dispatchNo: number;
  readonly kind: string;
}

export interface TimerRunDeps {
  readonly tx: TxRunner;
  readonly assembly: Pick<Assembly, "timerHandler">;
  readonly registry: TimerRegistry;
  /** 业务时钟：只用来判断“晚了多久”（maxLateMinutes） */
  readonly clock: Clock;
  readonly alerts: Alerts;
}

export interface ScanDeps extends TimerRunDeps {
  readonly channel: Pick<QueueChannel, "enqueue" | "downForMs">;
}

/** fired、skipped 处理器的结果；stale 已取消或已被接管，没执行；retry 失败待重试；failed 重试耗尽 */
export type RunTimerOutcome = TimerOutcome | "stale" | "retry" | "failed";

export interface ScanOptions {
  readonly limit?: number;
  /** 每处理完一行调一次：循环的看门狗据此知道它还在动 */
  readonly beat?: () => void;
}

export interface ScanResult {
  readonly claimed: number;
  readonly enqueued: number;
  /** 入队失败后在进程内直接执行的 */
  readonly inProcess: number;
  /** 入队失败后放回 scheduled 的 */
  readonly released: number;
  /** 处理器失联把次数耗尽、这一轮直接置 failed 的 */
  readonly failed: number;
  /** 进程内执行的长任务不占着扫描循环：它们都结束时这个 Promise 完成 */
  readonly background: Promise<unknown>;
}

/** 任务号：每次认领都是新的；不含冒号 */
export const timerJobId = (ref: TimerRef): string => `tmr-${ref.timerId}-${ref.dispatchNo}`;

export const recurringJobOf = (registry: TimerRegistry, kind: string): ScheduledJob | undefined =>
  registry.recurringJobs.find((job) => job.kind === kind);

/** 这个 kind 失败几次算耗尽；关键类没有上限（undefined） */
export function attemptLimit(registry: TimerRegistry, kind: string): number | undefined {
  if (registry.timer(kind)?.critical === true) return undefined;
  const job = recurringJobOf(registry, kind);
  return job?.mode === "job" ? (job.maxAttempts ?? TIMER_MAX_ATTEMPTS) : TIMER_MAX_ATTEMPTS;
}

export const raiseTimerFailed = (alerts: Alerts, ref: TimerRef, lastError: string): Promise<void> =>
  alerts.raise({
    rule: "timer.failed",
    dimension: ref.kind,
    severity: "P2",
    detail: { timerId: ref.timerId, lastError },
  });

interface ClaimedRow extends TimerRef {
  attempts: number;
  lost: number;
}

/**
 * 认领到期的定时器（scheduled 到点的，dispatched 租约过期的），在调用方的事务里。
 * @param now 业务时钟的现在：只用来算周期任务的下一期
 */
export async function claimTimers(
  tx: Tx,
  registry: TimerRegistry,
  now: Date,
  limit: number = SCAN_BATCH_SIZE,
): Promise<{ claimed: TimerRef[]; failed: TimerRef[] }> {
  const rows = await tx.$queryRawUnsafe<ClaimedRow[]>(
    `WITH due AS (
       SELECT id, (status = 'dispatched' AND is_enqueued)::int AS lost
         FROM timer
        WHERE (status = 'scheduled' AND COALESCE(retry_at, fire_at) <= now())
           OR (status = 'dispatched' AND lease_until < now())
        ORDER BY fire_at, id
        LIMIT $1::int FOR UPDATE SKIP LOCKED
     )
     UPDATE timer t
        SET status = 'dispatched', dispatch_no = t.dispatch_no + 1, is_enqueued = false,
            attempts = LEAST(t.attempts + due.lost, 32767),
            lease_until = now() + $2::int * interval '1 second',
            last_error = CASE WHEN due.lost = 1 THEN $3::text ELSE t.last_error END, updated_at = now()
       FROM due WHERE t.id = due.id
     RETURNING t.id::text AS "timerId", t.kind, t.dispatch_no::int AS "dispatchNo",
               t.attempts::int AS attempts, due.lost`,
    limit,
    TIMER_LEASE_SEC,
    HANDLER_LOST,
  );
  const toRef = ({ timerId, dispatchNo, kind }: ClaimedRow): TimerRef => ({
    timerId,
    dispatchNo,
    kind,
  });
  const exhausted = (row: ClaimedRow): boolean =>
    row.lost === 1 && row.attempts >= (attemptLimit(registry, row.kind) ?? Infinity);
  const failed = rows.filter(exhausted);
  if (failed.length > 0) {
    await tx.$executeRawUnsafe(
      "UPDATE timer SET status = 'failed', lease_until = NULL WHERE id = ANY($1::uuid[])",
      failed.map((row) => row.timerId),
    );
  }
  const claimed = rows.filter((row) => !exhausted(row));
  for (const kind of new Set(claimed.map((row) => row.kind))) {
    const job = recurringJobOf(registry, kind);
    if (job !== undefined) await armRecurringSlot(tx, kind, slotAfter(job.schedule, now));
  }
  return { claimed: claimed.map(toRef), failed: failed.map(toRef) };
}

const LAST_ERROR_MAX = 500;

export const timerErrorSummary = (error: unknown): string =>
  (error instanceof Error ? `${error.name}: ${error.message}` : String(error)).slice(
    0,
    LAST_ERROR_MAX,
  );

interface TimerRow extends FiredTimer {
  status: string;
  dispatchNo: number;
  fireAt: Date;
}

/** 读一行定时器，不加锁。forUpdate 只给长任务的认领确认用 */
export async function readTimer(
  tx: Tx,
  id: string,
  forUpdate = false,
): Promise<TimerRow | undefined> {
  const rows = await tx.$queryRawUnsafe<TimerRow[]>(
    `SELECT id::text AS id, kind, subject_type AS "subjectType", subject_id::text AS "subjectId", payload,
            status, dispatch_no::int AS "dispatchNo", fire_at AS "fireAt"
       FROM timer WHERE id = $1::uuid ${forUpdate ? "FOR UPDATE" : ""}`,
    id,
  );
  return rows[0];
}

/** 周期任务行的计划时刻：payload.scheduledFor；读不出来时退回 fire_at */
export function scheduledForOf(timer: Pick<TimerRow, "payload" | "fireAt">): Date {
  const at = new Date(String(timer.payload?.scheduledFor ?? ""));
  return Number.isNaN(at.getTime()) ? timer.fireAt : at;
}

/** 完成标记：只改仍在本次认领手里的行；返回改到的行数 */
export function finishTimer(
  tx: Tx,
  ref: TimerRef,
  outcome: TimerOutcome,
  result: unknown,
): Promise<number> {
  const summary = typeof result === "object" && result !== null && !Array.isArray(result);
  return tx.$executeRawUnsafe(
    `UPDATE timer SET status = $3::text, fired_at = now(), lease_until = NULL, updated_at = now(),
            result = COALESCE($4::jsonb, result)
      WHERE id = $1::uuid AND dispatch_no = $2::int AND status = 'dispatched'`,
    ref.timerId,
    ref.dispatchNo,
    outcome,
    summary ? JSON.stringify(result) : null,
  );
}
