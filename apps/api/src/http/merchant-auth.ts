// 商家端鉴权（W1-04；约定 C2、C3、C17、C27；D4 第 3.3 节）：解析 Authorization: Bearer <令牌>，每请求按主键点查会话。
//   public、signed  不解析凭据（不挂本中间件）
//   user、member    没带凭据 → 401 AUTH_REQUIRED；过期、被吊销、账号被禁用、令牌对不上 → 401 SESSION_INVALID
//   optional        有凭据且有效才带身份；没带、或带了无效的令牌，都按匿名处理，不回 401
//                  （引导不能因令牌失效而失败，端上在下一条 user 请求上恢复；任务书 第 10 节第 3 项）
// 通过后放进上下文：identity（操作人是商家用户；角色与归属由成员关系中间件在 member 路由上补）、
// sessionId（按会话限流用）、merchantSession（后面的中间件与处理器取当前会话）。
// 会话为什么无效只记日志，不回给端上。
import { AppError, createIdentityContext } from "@liyoxi/services";
import type { SessionPrincipal } from "@liyoxi/services";
import type { Context } from "hono";

import type { ApiEnv } from "../context.js";
import { merchantServicesOf } from "../merchant/services.js";
import type { RouteMiddlewareFactory } from "../routing/types.js";

const BEARER = /^Bearer\s+(\S+)$/i;

/** 请求头里的令牌：没带返回 null；带了但不是 Bearer 的写法返回空串（按无效的凭据算） */
function bearerOf(header: string | undefined): string | null {
  if (header === undefined || header.trim() === "") return null;
  return BEARER.exec(header.trim())?.[1] ?? "";
}

export const merchantAuth: RouteMiddlewareFactory = (route, runtime) => {
  const mode = route["x-auth"];
  if (mode === "public" || mode === "signed") return null;
  const optional = mode === "optional";
  const { identity } = merchantServicesOf(runtime);
  return async (c, next) => {
    const token = bearerOf(c.req.header("Authorization"));
    if (token === null) {
      if (optional) return next();
      throw new AppError("AUTH_REQUIRED");
    }
    const check = await identity.authenticate(token, { ip: c.get("clientIp") });
    if (!check.ok) {
      c.get("log").info({ evt: "auth.session_invalid", reason: check.reason }, "会话无效");
      if (optional) return next();
      throw new AppError("SESSION_INVALID");
    }
    const { principal } = check;
    c.set(
      "identity",
      createIdentityContext({
        actor: { type: "merchant", id: principal.merchantUserId, client: "weapp" },
        requestId: c.get("requestId"),
        ip: c.get("clientIp"),
        userAgent: c.req.header("User-Agent") ?? null,
      }),
    );
    c.set("sessionId", principal.sessionId);
    c.set("merchantSession", principal);
    return next();
  };
};

/** 处理器与后面的中间件取当前会话：没有即抛（这条路由不是 user、member，或没经鉴权中间件：代码缺陷） */
export function merchantSessionOf(c: Context<ApiEnv>): SessionPrincipal {
  const session = c.get("merchantSession");
  if (session === undefined)
    throw new TypeError("这条路由没有商家会话：它不是 user、member 的路由");
  return session;
}
