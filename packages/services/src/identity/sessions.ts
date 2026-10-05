// 商家端会话（W1-04；约定 C3；02 分组 第 2.3 节；D4 第 3.3 节）。一次登录一行，每请求按主键点查、不缓存。
//   有效 = 摘要对得上、未吊销、未过空闲（30 天滑动）与绝对（90 天）过期、账号 active。
//   续写：last_seen_at 与空闲过期同一天（北京时间）只写一次，连带账号的 last_active_at；
//         微信身份的 last_active_at 距上次写入超过 30 分钟才再写（通知挑选 openid 用，粒度不能是一天）。
//   上限：同一微信身份未吊销的会话至多 5 条，多了挤掉最旧的（evicted，identity.I25）。
// 这里的函数都收事务句柄；写的先后固定为 账号 → 微信身份 → 会话，与登录事务的加锁次序一致。
import { calendarDate } from "@liyoxi/shared/time";

import type { Tx } from "../kernel/index.js";
import { issueToken, parseToken, secretMatches } from "./token.js";
import type { SessionPrincipal } from "./types.js";

export const SESSION_IDLE_DAYS = 30;
export const SESSION_ABSOLUTE_DAYS = 90;
/** 同一微信身份未吊销会话的上限 */
export const MAX_SESSIONS_PER_IDENTITY = 5;
/** 微信身份的活跃时间隔多久再写一次 */
export const IDENTITY_ACTIVE_TOUCH_MS = 30 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;
const UNKNOWN_IP = "unknown";

/** 会话为什么无效：只进日志与用例的断言，不回给端上（端上一律 401 SESSION_INVALID） */
export type SessionRejection =
  | "malformed"
  | "unknown"
  | "mismatch"
  | "revoked"
  | "idle_expired"
  | "absolute_expired"
  | "account_inactive";

export type SessionCheck =
  | { readonly ok: true; readonly principal: SessionPrincipal; readonly touched: boolean }
  | { readonly ok: false; readonly reason: SessionRejection };

export interface OpenSessionInput {
  readonly merchantUserId: string;
  readonly wechatIdentityId: string;
  readonly ip: string | null;
  readonly deviceInfo: string | null;
}

/**
 * 开一条会话并执行上限。调用方已锁住这个微信身份的行（并发登录在那里排队，上限才数得准）。
 * 返回给端上的令牌；库里只留摘要。
 */
export async function openSession(
  tx: Tx,
  now: Date,
  input: OpenSessionInput,
): Promise<{ sessionId: string; token: string; evicted: string[] }> {
  const issued = issueToken();
  await tx.userSession.create({
    data: {
      id: issued.sessionId,
      merchantUserId: input.merchantUserId,
      wechatIdentityId: input.wechatIdentityId,
      tokenHash: issued.tokenHash,
      createdAt: now,
      updatedAt: now,
      lastSeenAt: now,
      idleExpiresAt: new Date(now.getTime() + SESSION_IDLE_DAYS * DAY_MS),
      absoluteExpiresAt: new Date(now.getTime() + SESSION_ABSOLUTE_DAYS * DAY_MS),
      lastIp: input.ip ?? UNKNOWN_IP,
      deviceInfo: input.deviceInfo,
    },
  });
  // 最旧的在前；刚插入的这一条主键最大（UUID v7），排在最后
  const live = await tx.userSession.findMany({
    where: { wechatIdentityId: input.wechatIdentityId, revokedAt: null },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  const evicted = live
    .slice(0, Math.max(0, live.length - MAX_SESSIONS_PER_IDENTITY))
    .map((row) => row.id);
  if (evicted.length > 0) {
    await tx.userSession.updateMany({
      where: { id: { in: evicted }, revokedAt: null },
      data: { revokedAt: now, revokeReason: "evicted", updatedAt: now },
    });
  }
  return { sessionId: issued.sessionId, token: issued.token, evicted };
}

/**
 * 每请求校验：按主键点查会话行连同账号状态。通过时按上面的口径续写（同一天第二次请求不再写库）。
 * 令牌写法不对、会话不存在、摘要对不上、已吊销、过期、账号不是 active，都是无效。
 */
export async function checkSession(
  tx: Tx,
  now: Date,
  token: string,
  meta: { ip: string | null },
): Promise<SessionCheck> {
  const parsed = parseToken(token);
  if (parsed === null) return { ok: false, reason: "malformed" };
  const row = await tx.userSession.findUnique({
    where: { id: parsed.sessionId },
    select: {
      id: true,
      merchantUserId: true,
      wechatIdentityId: true,
      tokenHash: true,
      revokedAt: true,
      lastSeenAt: true,
      idleExpiresAt: true,
      absoluteExpiresAt: true,
      merchantUser: { select: { status: true, lastActiveAt: true, consentStamp: true } },
      wechatIdentity: { select: { lastActiveAt: true } },
    },
  });
  if (row === null) return { ok: false, reason: "unknown" };
  if (!secretMatches(parsed.secret, row.tokenHash)) return { ok: false, reason: "mismatch" };
  // 未吊销的会话必有微信身份（ck_user_session_identity_live）
  if (row.revokedAt !== null || row.wechatIdentityId === null || row.wechatIdentity === null) {
    return { ok: false, reason: "revoked" };
  }
  if (now.getTime() >= row.absoluteExpiresAt.getTime()) {
    return { ok: false, reason: "absolute_expired" };
  }
  if (now.getTime() >= row.idleExpiresAt.getTime()) return { ok: false, reason: "idle_expired" };
  if (row.merchantUser.status !== "active") return { ok: false, reason: "account_inactive" };

  const today = calendarDate(now);
  let touched = false;
  if (calendarDate(row.merchantUser.lastActiveAt) !== today) {
    await tx.merchantUser.updateMany({
      where: { id: row.merchantUserId, lastActiveAt: { lt: now } },
      data: { lastActiveAt: now, updatedAt: now },
    });
    touched = true;
  }
  if (now.getTime() - row.wechatIdentity.lastActiveAt.getTime() > IDENTITY_ACTIVE_TOUCH_MS) {
    await tx.wechatIdentity.updateMany({
      where: { id: row.wechatIdentityId, lastActiveAt: { lt: now } },
      data: { lastActiveAt: now, updatedAt: now },
    });
    touched = true;
  }
  if (calendarDate(row.lastSeenAt) !== today) {
    await tx.userSession.updateMany({
      where: { id: row.id, revokedAt: null },
      data: {
        lastSeenAt: now,
        idleExpiresAt: new Date(now.getTime() + SESSION_IDLE_DAYS * DAY_MS),
        lastIp: meta.ip ?? UNKNOWN_IP,
        updatedAt: now,
      },
    });
    touched = true;
  }
  return {
    ok: true,
    touched,
    principal: {
      sessionId: row.id,
      merchantUserId: row.merchantUserId,
      wechatIdentityId: row.wechatIdentityId,
      consentStamp: row.merchantUser.consentStamp,
    },
  };
}

/** 吊销一个微信身份名下未吊销的会话，返回吊销了几条 */
export async function revokeIdentitySessions(
  tx: Tx,
  now: Date,
  wechatIdentityId: string,
  reason: "identity_rebound" | "identity_removed",
): Promise<number> {
  const { count } = await tx.userSession.updateMany({
    where: { wechatIdentityId, revokedAt: null },
    data: { revokedAt: now, revokeReason: reason, updatedAt: now },
  });
  return count;
}
