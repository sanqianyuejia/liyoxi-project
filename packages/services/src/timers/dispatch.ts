// 定时器的派发（W0-23）：扫描循环的一轮。认领在 scan.ts，这里把认领到的行交给队列，入队失败时按规则降级。
// 依据：01 分组 第 2.5 节状态机“入队失败且不走进程内执行”一行；D3 第 21.3 节；01 第 7.3 节。
import { REDIS_DOWN_FALLBACK_MS } from "../kernel/index.js";
import type { Tx } from "../kernel/index.js";
import { runJobTimer } from "./job-mode.js";
import { runTimer } from "./run.js";
import {
  claimTimers,
  HANDLER_LOST,
  raiseTimerFailed,
  recurringJobOf,
  TIMER_QUEUE,
  timerJobId,
} from "./scan.js";
import type { ScanDeps, ScanOptions, ScanResult, TimerRef } from "./scan.js";

/** 按 (id, 认领序号) 批量改仍在本次认领手里的行 */
function updateDispatched(tx: Tx, refs: readonly TimerRef[], set: string): Promise<number> {
  return tx.$executeRawUnsafe(
    `UPDATE timer t SET ${set}, updated_at = now()
       FROM unnest($1::uuid[], $2::int[]) AS ref(id, dispatch_no)
      WHERE t.id = ref.id AND t.dispatch_no = ref.dispatch_no AND t.status = 'dispatched'`,
    refs.map((ref) => ref.timerId),
    refs.map((ref) => ref.dispatchNo),
  );
}

/**
 * 扫描一轮：认领到期的行，逐行交给队列。入队失败（Redis 不可用）时，关键类、或 Redis 已连续不可用满 60 秒的，
 * 在进程内直接执行；其余放回 scheduled，不计失败次数。
 */
export async function scanDue(deps: ScanDeps, options: ScanOptions = {}): Promise<ScanResult> {
  const { claimed, failed } = await deps.tx.run((tx) =>
    claimTimers(tx, deps.registry, deps.clock.now(), options.limit),
  );
  for (const row of failed) await raiseTimerFailed(deps.alerts, row, HANDLER_LOST);

  const enqueued: TimerRef[] = [];
  const released: TimerRef[] = [];
  const background: Promise<unknown>[] = [];
  let inProcess = 0;
  for (const row of claimed) {
    const { timerId, dispatchNo, kind } = row;
    try {
      await deps.channel.enqueue(TIMER_QUEUE, timerJobId(row), { timerId, dispatchNo, kind });
      enqueued.push(row);
    } catch {
      const critical = deps.registry.timer(kind)?.critical === true;
      if (critical || deps.channel.downForMs() >= REDIS_DOWN_FALLBACK_MS) {
        const job = recurringJobOf(deps.registry, kind);
        // 长任务要跑几分钟：不占着扫描循环，出错由它自己的失败处理与租约兜底
        if (job?.mode === "job")
          background.push(runJobTimer(deps, row, job).catch(() => undefined));
        else await runTimer(deps, row);
        inProcess += 1;
      } else {
        released.push(row);
      }
    }
    options.beat?.();
  }
  if (enqueued.length > 0) {
    await deps.tx.run((tx) => updateDispatched(tx, enqueued, "is_enqueued = true"));
  }
  if (released.length > 0) {
    await deps.tx.run((tx) =>
      updateDispatched(tx, released, "status = 'scheduled', lease_until = NULL"),
    );
  }
  return {
    claimed: claimed.length,
    enqueued: enqueued.length,
    inProcess,
    released: released.length,
    failed: failed.length,
    background: Promise.all(background),
  };
}
