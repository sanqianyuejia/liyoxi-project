// timers 连库用例的共用部分（W0-17）：只给本目录的测试用。
// 连接用支架给的缺省身份（应用角色 lyx_app）：timer 表它有增删改查。
import type { PrismaClient } from "@liyoxi/db";

import { createTxRunner, uuidv7 } from "../../kernel/index.js";
import type { Tx, TxRunner } from "../../kernel/index.js";
import {
  assembleForTest,
  SAMPLE_TIMER_CATALOG,
  SAMPLE_TIMER_SUBJECT,
  sampleTimerRegistration,
} from "../../testing/index.js";
import { createTimers } from "../index.js";
import type { Timers, TimerStatus, TimerSubject } from "../index.js";

/** 机器忙的时候连库的用例给足时限 */
export const SLOW = 180_000;
/** 用例里的事务也给足时限：并发的那几份要排队等锁 */
export const ROOMY = { timeoutMs: 60_000, maxWaitMs: 60_000 } as const;

/** 带样例登记的 timers：真实模块之外追加 lyxtest 的两个处理器、四个周期任务 */
export function sampleTimers(appEnv: "test" | "stg" | "prod" = "test"): Timers {
  const assembly = assembleForTest({ entry: "worker", appEnv, extra: [sampleTimerRegistration] });
  return createTimers({ assembly, catalog: SAMPLE_TIMER_CATALOG });
}

export const runner = (prisma: PrismaClient): TxRunner =>
  createTxRunner({ prisma, appEnv: "test" });

/** 一个新的样例主体 */
export const newSubject = (): TimerSubject => ({ type: SAMPLE_TIMER_SUBJECT, id: uuidv7() });

export interface TimerRow {
  id: string;
  kind: string;
  subject_type: string | null;
  subject_id: string | null;
  fire_at: Date;
  retry_at: Date | null;
  dedupe_key: string;
  payload: Record<string, unknown> | null;
  status: TimerStatus;
  attempts: number;
  fired_at: Date | null;
}

type Db = PrismaClient | Tx;

/** 去重键以 prefix 开头的全部行，按落库先后 */
export const timerRows = (db: Db, prefix: string): Promise<TimerRow[]> =>
  db.$queryRawUnsafe<TimerRow[]>(
    `SELECT id::text AS id, kind, subject_type, subject_id::text AS subject_id, fire_at, retry_at,
            dedupe_key, payload, status, attempts, fired_at
       FROM timer WHERE starts_with(dedupe_key, $1::text) ORDER BY created_at, id`,
    prefix,
  );

/** 同键未取消的行数：任何时刻都应不超过 1 */
export async function liveCount(db: Db, key: string): Promise<number> {
  const [row] = await db.$queryRawUnsafe<{ n: number }[]>(
    "SELECT count(*)::int AS n FROM timer WHERE dedupe_key = $1::text AND status <> 'cancelled'",
    key,
  );
  return row?.n ?? 0;
}

/**
 * 把一行直接改成某个状态，扮扫描认领与执行（W0-23）的结果。各状态带上库里 CHECK 要求的列：
 * dispatched 有租约；fired、skipped 有 fired_at；failed 带失败次数与重试时间。
 */
export async function force(db: Db, id: string, status: TimerStatus): Promise<void> {
  const set: Record<TimerStatus, string> = {
    scheduled: "status = 'scheduled', fired_at = NULL",
    dispatched:
      "status = 'dispatched', dispatch_no = dispatch_no + 1, lease_until = now() + interval '5 minutes'",
    fired: "status = 'fired', fired_at = now()",
    skipped: "status = 'skipped', fired_at = now(), attempts = 2, retry_at = now()",
    failed: "status = 'failed', attempts = 6, retry_at = now(), last_error = '样例：重试耗尽'",
    cancelled: "status = 'cancelled'",
  };
  await db.$executeRawUnsafe(`UPDATE timer SET ${set[status]} WHERE id = $1::uuid`, id);
}
