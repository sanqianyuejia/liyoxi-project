// 商家端：会话与当前账号（docs/api/m01-account.md 第 3.1–3.4 节；W1-04）。四条薄壳：取参 → 调 identity → 回包。
// 两条登录是公开路由（不解析凭据）；退出与当前账号要会话，由鉴权中间件给。
// 含令牌或个人数据的响应带 Cache-Control: no-store（约定 C18）。
import {
  mMeGet,
  mSessionCreate,
  mSessionCurrentDelete,
  mSessionPhoneLogin,
} from "@liyoxi/contract";
import type { RequestMeta, Runtime } from "@liyoxi/services";
import type { Context } from "hono";

import type { ApiEnv } from "../context.js";
import { ok, RateLimited } from "../http/errors.js";
import { merchantSessionOf } from "../http/merchant-auth.js";
import { PHONE_LOGIN_OPENID_QUOTA } from "../http/rate-limit-quotas.js";
import { CLIENT_VERSION_HEADER } from "../http/version-gate.js";
import { merchantServicesOf } from "../merchant/services.js";
import { defineHandler } from "../routing/define.js";

const CLIENT_VERSION_MAX = 32;

/** 请求元信息：identity 不读请求头，这里取好带进去 */
function metaOf(c: Context<ApiEnv>): RequestMeta {
  return {
    requestId: c.get("requestId"),
    ip: c.get("clientIp"),
    userAgent: c.req.header("User-Agent") ?? null,
    clientVersion: c.req.header(CLIENT_VERSION_HEADER)?.slice(0, CLIENT_VERSION_MAX) ?? null,
  };
}

/**
 * 手机号登录的“每 openid”一条限流（约定 C68）：路由是公开的，openid 要换出来才知道，
 * 所以不在限流中间件里，由用例在 code2Session 之后、换手机号之前回调到这里计数。
 */
async function hitOpenidQuota(runtime: Runtime, openidKey: string): Promise<void> {
  const { limit, windowSec } = PHONE_LOGIN_OPENID_QUOTA;
  const decision = await runtime.rateLimiter.hit([
    {
      key: `rl:m.login.phone:openid:${openidKey}:${windowSec}`,
      limit,
      windowMs: windowSec * 1_000,
    },
  ]);
  if (!decision.allowed) {
    runtime.logger.warn(
      { evt: "ratelimit.hit", operationId: "m.session.phoneLogin", tiers: ["m.login.phone"] },
      "限流：超出额度",
    );
    throw new RateLimited(decision.retryAfterSec);
  }
}

export const sessionHandlers = [
  // m.session.create：不能静默登录时 needPhone = true，保持游客态
  defineHandler(mSessionCreate, async (c) => {
    const { identity } = merchantServicesOf(c.var.runtime);
    const result = await identity.silentLogin(metaOf(c), c.req.valid("json"));
    c.header("Cache-Control", "no-store");
    return ok(c, result);
  }),
  // m.session.phoneLogin：首次登录建账号、记协议同意与来源
  defineHandler(mSessionPhoneLogin, async (c) => {
    const { runtime } = c.var;
    const { identity } = merchantServicesOf(runtime);
    const result = await identity.phoneLogin(metaOf(c), c.req.valid("json"), {
      onOpenid: (openidKey) => hitOpenidQuota(runtime, openidKey),
    });
    c.header("Cache-Control", "no-store");
    return ok(c, result);
  }),
  // m.session.current.delete：会话已失效时到不了这里（鉴权中间件回 401，端上按已退出处理）
  defineHandler(mSessionCurrentDelete, async (c) => {
    const { identity } = merchantServicesOf(c.var.runtime);
    await identity.logout(merchantSessionOf(c), metaOf(c));
    return ok(c, null);
  }),
  // m.me.get：在协议同意的白名单里，有待同意协议时照常返回
  defineHandler(mMeGet, async (c) => {
    const { identity } = merchantServicesOf(c.var.runtime);
    const me = await identity.me(merchantSessionOf(c).merchantUserId);
    c.header("Cache-Control", "no-store");
    return ok(c, me);
  }),
];
