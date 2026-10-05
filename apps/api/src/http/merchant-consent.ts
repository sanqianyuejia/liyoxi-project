// 协议同意（W1-04；约定 C73、C7；m01 第 2.5 节）：登录用户有未同意的现行用户级协议时，白名单之外的请求回
// 428 CONSENT_REQUIRED，details.pendingConsents 与 m01 的结构相同；端上弹层同意后用同一个幂等键重放
//（本中间件排在幂等上下文之前，428 不落幂等行）。
// 白名单 9 条按 operationId 登记在契约里（CONSENT_WHITELIST_OPERATIONS），这几条路由不挂本中间件。
// 常态只比一次字符串：会话校验时已读到账号上的指纹，与当前指纹相等即放行，不查同意记录。
// 匿名请求（optional 路由没带令牌）不查。
import { isConsentWhitelisted } from "@liyoxi/contract";
import { AppError } from "@liyoxi/services";

import { merchantServicesOf } from "../merchant/services.js";
import type { RouteMiddlewareFactory } from "../routing/types.js";

export const merchantConsent: RouteMiddlewareFactory = (route, runtime) => {
  const mode = route["x-auth"];
  if (mode === "public" || mode === "signed") return null;
  if (isConsentWhitelisted(route.operationId)) return null;
  const { identity } = merchantServicesOf(runtime);
  return async (c, next) => {
    const session = c.get("merchantSession");
    if (session === undefined) return next();
    const pendingConsents = await identity.pendingConsents(session);
    if (pendingConsents.length > 0) {
      throw new AppError("CONSENT_REQUIRED", { details: { pendingConsents } });
    }
    return next();
  };
};
