// 清理的执行（W0-24）：周期任务 ops.retention 每小时一轮，逐项执行各模块登记的清理项。
// 依据：15 分组 第 5.3 节。删除语句归各表的属主模块（在自己的 register.ts 里登记），这里只管调度、限量与记结果。
//
//   1. 每小时项每轮都跑；每日项只在当日第一轮跑：按计划时刻判定，北京时间 0 点那一期。
//   2. 限量：单项单轮至多 RETENTION_LIMIT 行一批；一批删满说明还有，接着删，至多 RETENTION_MAX_BATCHES 批，
//      剩下的留给下一轮。
//   3. 一项一个保存点：出错只回滚它自己，记进结果并经告警端口报一条，别的项照常提交。
//      死锁、锁等待超时这类可重试的错误不接：往外抛，整轮由定时器重试。
//   4. 结果（各项处理了几行、哪几项出错）由调用方写在周期任务的定时器行 result 上。
import { minuteOfDay } from "@liyoxi/shared/time";

import { isRetryableDbError, savepoint } from "../kernel/index.js";
import type { Alerts, Assembly, Clock, Tx } from "../kernel/index.js";

/** 单项单批至多处理多少行 */
export const RETENTION_LIMIT = 1_000;
/** 单项单轮至多几批 */
export const RETENTION_MAX_BATCHES = 5;

/** 这一期是不是当日第一轮（北京时间 0 点到 1 点之间的那一期） */
export const isFirstRoundOfDay = (scheduledFor: Date): boolean => minuteOfDay(scheduledFor) < 60;

export interface RetentionDeps {
  readonly assembly: Pick<Assembly, "cleanups">;
  readonly clock: Clock;
  readonly alerts: Alerts;
}

export interface RetentionInput {
  /** 本期的计划时刻 */
  readonly scheduledFor: Date;
  /** 单批上限，缺省 RETENTION_LIMIT */
  readonly limit?: number;
}

export interface RetentionResult {
  /** 这一轮跑没跑每日项 */
  readonly daily: boolean;
  /** 清理项名 → 这一轮处理的行数；没轮到的每日项不在里面 */
  readonly rows: Readonly<Record<string, number>>;
  /** 清理项名 → 错误摘要；没有出错的即空对象 */
  readonly failed: Readonly<Record<string, string>>;
}

const summary = (error: unknown): string =>
  (error instanceof Error ? `${error.name}: ${error.message}` : String(error)).slice(0, 300);

export async function runRetention(
  tx: Tx,
  deps: RetentionDeps,
  input: RetentionInput,
): Promise<RetentionResult> {
  const limit = input.limit ?? RETENTION_LIMIT;
  const daily = isFirstRoundOfDay(input.scheduledFor);
  const now = deps.clock.now();
  const rows: Record<string, number> = {};
  const failed: Record<string, string> = {};
  for (const cleanup of deps.assembly.cleanups) {
    if (cleanup.every === "day" && !daily) continue;
    try {
      rows[cleanup.name] = await savepoint(tx, async () => {
        let total = 0;
        for (let batch = 0; batch < RETENTION_MAX_BATCHES; batch += 1) {
          const done = await cleanup.run(tx, { now, limit });
          total += done;
          if (done < limit) break;
        }
        return total;
      });
    } catch (error) {
      if (isRetryableDbError(error)) throw error;
      failed[cleanup.name] = summary(error);
      await deps.alerts.raise({
        rule: "ops.retention_failed",
        dimension: cleanup.name,
        severity: "P3",
        detail: { module: cleanup.module, error: failed[cleanup.name] },
      });
    }
  }
  return { daily, rows, failed };
}
