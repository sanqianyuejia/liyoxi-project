// 周期任务的补登记（W0-17）：按登记表给每一项补上“下一期”的定时器行，声明了 catchUp 的再补“最近已到的一期”。
// 依据：D7 第 7.6 节第 2 条；x01 第 4.2 节；01 分组 第 2.5 节。只读写数据库，不碰 Redis；循环（每 60 秒）在 W0-23。
// 不依赖“上一期执行完再登记下一期”这条链：某一期失败或被删，下一轮照样补上。
//   - 周期任务行没有主体：subject_type、subject_id 为空；dedupe_key = {kind}:{栅格时刻}；payload.scheduledFor 是栅格时刻。
//   - 同键的行不论什么状态都算已登记，不动它：不改期、不复活失败的那一期（要重跑由后台“重新排期”）。
//   - 两个实例同时补同一格：键相同，部分唯一索引保证只有一行（ON CONFLICT DO NOTHING）。
//   - 只属于别的环境的任务（envs）不在装配结果里，这里也就不登记。
import { uuidv7 } from "../kernel/index.js";
import type { Tx } from "../kernel/index.js";
import { recurringKey } from "./keys.js";
import type { TimerRegistry } from "./registry.js";
import { slotAfter, slotAtOrBefore } from "./schedule.js";

export interface EnsureRecurringResult {
  /** 这一轮新建的行的去重键，按 kind 的顺序 */
  readonly created: readonly string[];
}

/**
 * 登记周期任务的一期：已有同键的行（任何状态）即不动。返回是否新建了行。
 * 认领本期时登记下一期（W0-23）也用它。
 */
export async function armRecurringSlot(
  tx: Tx,
  kind: string,
  slot: Date,
  fireAt: Date = slot,
): Promise<boolean> {
  const key = recurringKey(kind, slot);
  const inserted = await tx.$executeRawUnsafe(
    `INSERT INTO timer (id, kind, fire_at, dedupe_key, payload)
     SELECT $1::uuid, $2::text, $3::timestamptz, $4::text, $5::jsonb
      WHERE NOT EXISTS (SELECT 1 FROM timer WHERE dedupe_key = $4::text)
     ON CONFLICT (dedupe_key) WHERE status <> 'cancelled' DO NOTHING`,
    uuidv7(),
    kind,
    fireAt,
    key,
    JSON.stringify({ scheduledFor: slot.toISOString() }),
  );
  return inserted === 1;
}

/** 补登记一轮。now 取注入的时钟 */
export async function ensureRecurring(
  tx: Tx,
  registry: TimerRegistry,
  now: Date,
): Promise<EnsureRecurringResult> {
  const created: string[] = [];
  for (const job of registry.recurringJobs) {
    const next = slotAfter(job.schedule, now);
    if (await armRecurringSlot(tx, job.kind, next)) created.push(recurringKey(job.kind, next));
    if (job.catchUp === true) {
      // 只补最近一格：处理器都是“按当前状态扫描”，跑一次即追平；补的这一格立即到点
      const last = slotAtOrBefore(job.schedule, now);
      if (await armRecurringSlot(tx, job.kind, last, now)) {
        created.push(recurringKey(job.kind, last));
      }
    }
  }
  return { created };
}
