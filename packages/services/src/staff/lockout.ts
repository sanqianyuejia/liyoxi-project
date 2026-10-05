// 分桶锁定（W1-01a；D4 第 6.3 节；a01 第 3.1、3.2 节）。
// 两个桶：带验签通过且员工相符的设备 Cookie 走 trusted，否则 untrusted。各自连续失败 5 次锁 15 分钟；
// 陌生来源刷错密码只锁得住 untrusted 桶，员工在自己用过的浏览器上照常登录。锁定状态存库，不靠 Redis。
// 计数、锁定、auth_event 写在一个独立的事务里（失败登录不属于任何业务事务），员工行先锁住，并发的失败逐个数。
import type { Staff } from "@liyoxi/db";

import { recordAuthEvent } from "../audit/index.js";
import type { AuthBucket } from "../audit/index.js";
import type { Tx } from "../kernel/index.js";
import type { RequestMeta } from "./types.js";

export const LOCK_THRESHOLD = 5;
export const LOCK_MS = 15 * 60_000;

export interface BucketState {
  readonly fails: number;
  readonly lockedUntil: Date | null;
}

/** 员工行上某个桶的计数与锁定截止 */
export const bucketOf = (
  staff: Pick<
    Staff,
    "failTrusted" | "failUntrusted" | "lockedUntilTrusted" | "lockedUntilUntrusted"
  >,
  bucket: AuthBucket,
): BucketState =>
  bucket === "trusted"
    ? { fails: staff.failTrusted, lockedUntil: staff.lockedUntilTrusted }
    : { fails: staff.failUntrusted, lockedUntil: staff.lockedUntilUntrusted };

export const isLocked = (state: BucketState, now: Date): boolean =>
  state.lockedUntil !== null && state.lockedUntil.getTime() > now.getTime();

/**
 * 记一次失败之后桶的样子（纯函数）。锁定中：不再计数，截止时间不顺延。上一次锁已到期：从头计。
 * 满 5 次：锁 15 分钟，lockedNow 为真（只有这一次为真）。
 */
export function countFailure(state: BucketState, now: Date): BucketState & { lockedNow: boolean } {
  if (isLocked(state, now)) return { ...state, lockedNow: false };
  const fails = (state.lockedUntil === null ? state.fails : 0) + 1;
  const lockedNow = fails >= LOCK_THRESHOLD;
  return { fails, lockedUntil: lockedNow ? new Date(now.getTime() + LOCK_MS) : null, lockedNow };
}

export interface FailureInput {
  readonly bucket: AuthBucket;
  /** auth_event.method：password（第一步）、password+totp、password+recovery（第二步） */
  readonly method: string;
  /** 失败原因的内部分类，只进 auth_event.detail，不回给客户端 */
  readonly reason: string;
  readonly meta: RequestMeta;
  readonly now: Date;
}

/**
 * 给一个桶记一次失败：改计数、满 5 次即锁，写 login_fail，锁上的那一次另写 locked。
 * 调用方的事务里、员工行已经锁住（lockStaff）之后调，staff 传锁住之后读到的那一行。
 */
export async function recordFailure(
  tx: Tx,
  staff: Staff,
  input: FailureInput,
): Promise<{ lockedNow: boolean }> {
  const { bucket, now, meta } = input;
  const before = bucketOf(staff, bucket);
  const after = countFailure(before, now);
  if (after.fails !== before.fails || after.lockedUntil !== before.lockedUntil) {
    await tx.staff.update({
      where: { id: staff.id },
      data: {
        ...(bucket === "trusted"
          ? { failTrusted: after.fails, lockedUntilTrusted: after.lockedUntil }
          : { failUntrusted: after.fails, lockedUntilUntrusted: after.lockedUntil }),
        updatedAt: now,
      },
    });
  }
  const event = {
    space: "staff" as const,
    subjectId: staff.id,
    method: input.method,
    ip: meta.ip,
    userAgent: meta.userAgent ?? null,
    at: now,
  };
  const requestId = meta.requestId ?? null;
  await recordAuthEvent(tx, {
    ...event,
    event: "login_fail",
    detail: { bucket, reason: isLocked(before, now) ? "bucket_locked" : input.reason, requestId },
  });
  if (after.lockedNow) {
    await recordAuthEvent(tx, {
      ...event,
      event: "locked",
      detail: { bucket, lockedUntil: after.lockedUntil?.toISOString() ?? "", requestId },
    });
  }
  return { lockedNow: after.lockedNow };
}

/** 登录成功：两个桶清零 */
export const CLEARED_BUCKETS = {
  failTrusted: 0,
  lockedUntilTrusted: null,
  failUntrusted: 0,
  lockedUntilUntrusted: null,
} as const;
