// timers 模块的登记（W0-17）：一条清理项。调度在 ops.retention（W0-24），这里只登记。
// 依据：01 分组 第 2.5 节“清理”；15 分组 第 5.3 节：周期任务行（subject_type IS NULL）里 status = 'fired'、
// fire_at 早于 90 天前的物理删除，每日一次，按 kind 走 ix_timer_kind_fire_at；业务定时器行不删。
import { JOBS } from "@liyoxi/contract/registry";

import { defineRegistration } from "../kernel/index.js";
import type { CleanupContext, Tx } from "../kernel/index.js";

/** 已触发的周期任务行保留多少天 */
export const RECURRING_RETENTION_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;

/** 删已触发、过了保留期的周期任务行；单轮至多 ctx.limit 行，返回删了几行 */
export async function purgeFiredRecurring(tx: Tx, ctx: CleanupContext): Promise<number> {
  const before = new Date(ctx.now.getTime() - RECURRING_RETENTION_DAYS * DAY_MS);
  return tx.$executeRawUnsafe(
    `DELETE FROM timer WHERE id IN (
       SELECT id FROM timer
        WHERE kind = ANY($1::text[]) AND fire_at < $2::timestamptz AND status = 'fired' AND subject_type IS NULL
        ORDER BY fire_at
        LIMIT $3::int
          FOR UPDATE SKIP LOCKED
     )`,
    JOBS.map((job) => job.kind),
    before,
    ctx.limit,
  );
}

export const registration = defineRegistration("timers", {
  cleanups: [{ name: "timers.recurring_fired", every: "day", run: purgeFiredRecurring }],
});
