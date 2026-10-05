// 后台的会话中间件（W1-01a；槽位 auth，只给后台这一组；约定 C4；D4 第 6.5、7.4 节）。
//   x-auth: public    不挂
//   x-auth: staff     没带会话 Cookie → 401 AUTH_REQUIRED；带了但失效（吊销、过期、员工已不是启用）→ 401 SESSION_INVALID
//   x-auth: optional  带了有效的会话就认，否则按匿名放行
// 每请求校验一次会话（距上次续写超过 60 秒才写库），把三样放进上下文：
//   c.var.identity   身份上下文（操作人是员工，客户端来源 admin）：审计、幂等、状态历史都用它
//   c.var.sessionId  会话行的 id：按会话限流的档位用它
//   c.var.staff      会话校验的结果与判权用的上下文：权限中间件、defineAdminHandler 用它
// 登录票据不是会话：拿票据当 Cookie 值过不了校验，访问不了任何业务接口。
// 用到 runtime.staffAuth 的地方都在请求里：建应用时不碰它，没配密钥的本地环境进程照样起得来。
import { AppError, createIdentityContext, isAppError, staff } from "@liyoxi/services";

import type { RouteMiddlewareFactory } from "../../routing/types.js";

import { sessionCookieOf } from "./cookies.js";

export const adminSession: RouteMiddlewareFactory = (route, runtime) => {
  const mode = route["x-auth"];
  if (mode === "public") return null;
  const optional = mode === "optional";
  return async (c, next) => {
    const token = sessionCookieOf(c);
    if (token === undefined) {
      if (optional) return next();
      throw new AppError("AUTH_REQUIRED");
    }
    let principal;
    try {
      principal = await runtime.staffAuth.authenticate(token);
    } catch (error) {
      if (optional && isAppError(error) && error.error === "SESSION_INVALID") return next();
      throw error;
    }
    c.set(
      "identity",
      createIdentityContext({
        actor: { type: "staff", id: principal.staff.id, client: "admin" },
        requestId: c.get("requestId"),
        ip: c.get("clientIp"),
        userAgent: c.req.header("user-agent") ?? null,
      }),
    );
    c.set("sessionId", principal.session.id);
    c.set("staff", { principal, ctx: staff.staffContextOf(principal) });
    return next();
  };
};
