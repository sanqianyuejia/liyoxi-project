// 退出登录（W1-04；m01 第 3.3 节；D4 第 3.3、3.7 节）。同一事务：
//   吊销当前会话（logout）；关掉这次会话所用微信身份的静默登录（再打开要重新验证手机号）；
//   吊销本人授权出的全部未吊销的下载页会话（account_action）；写 auth_event（logout）。
// 无状态迁移、无出站事件。会话已经失效时到不了这里：鉴权中间件先回 401，端上按已退出处理。
import { recordAuthEvent } from "../audit/index.js";
import type { Tx } from "../kernel/index.js";
import type { RequestMeta, SessionPrincipal } from "./types.js";

export async function logoutIn(
  tx: Tx,
  now: Date,
  principal: SessionPrincipal,
  meta: RequestMeta,
): Promise<void> {
  // 写的先后同登录：微信身份 → 会话
  await tx.wechatIdentity.updateMany({
    where: { id: principal.wechatIdentityId, merchantUserId: principal.merchantUserId },
    data: { silentLoginEnabled: false, updatedAt: now },
  });
  await tx.userSession.updateMany({
    where: { id: principal.sessionId, revokedAt: null },
    data: { revokedAt: now, revokeReason: "logout", updatedAt: now },
  });
  const portal = await tx.portalSession.updateMany({
    where: { approvedByUserId: principal.merchantUserId, revokedAt: null },
    data: { revokedAt: now, revokeReason: "account_action", updatedAt: now },
  });
  await recordAuthEvent(tx, {
    space: "merchant",
    subjectId: principal.merchantUserId,
    event: "logout",
    ip: meta.ip,
    userAgent: meta.userAgent,
    detail: {
      sessionId: principal.sessionId,
      identityId: principal.wechatIdentityId,
      revokedPortalSessions: portal.count,
      requestId: meta.requestId,
    },
    at: now,
  });
}
