// 版本门槛（W1-04；约定 C71、C7）：X-Client-Version 低于开关 client.min_version 的 /m 请求回 426 CLIENT_OUTDATED。
// 排在最前（鉴权之前）：公开的登录接口同样受它拦。豁免的 5 条按 operationId 登记在契约里
//（VERSION_GATE_EXEMPT_OPERATIONS：启动引导、埋点、协议读取、错误上报），这几条路由不挂本中间件。
// 没带或写法不对的版本号按 0.0.0 算；最低版本是 0.0.0（开关的默认值）时都放行。
import { isVersionGateExempt } from "@liyoxi/contract";
import { AppError } from "@liyoxi/services";

import { merchantServicesOf } from "../merchant/services.js";
import type { RouteMiddlewareFactory } from "../routing/types.js";

export const CLIENT_VERSION_HEADER = "X-Client-Version";
export const CLIENT_PLATFORM_HEADER = "X-Client-Platform";
export const ENV_VERSION_HEADER = "X-Env-Version";

const ENV_VERSIONS = ["develop", "trial", "release"] as const;
type EnvVersion = (typeof ENV_VERSIONS)[number];

const envVersionOf = (value: string | undefined): EnvVersion | null =>
  (ENV_VERSIONS as readonly string[]).includes(value ?? "") ? (value as EnvVersion) : null;

export const versionGate: RouteMiddlewareFactory = (route, runtime) => {
  if (isVersionGateExempt(route.operationId)) return null;
  const { identity } = merchantServicesOf(runtime);
  return async (c, next) => {
    const clientVersion = c.req.header(CLIENT_VERSION_HEADER) ?? null;
    const outdated = await identity.isClientOutdated(clientVersion, {
      platform: c.req.header(CLIENT_PLATFORM_HEADER) ?? null,
      clientVersion,
      envVersion: envVersionOf(c.req.header(ENV_VERSION_HEADER)),
    });
    if (outdated) throw new AppError("CLIENT_OUTDATED");
    await next();
  };
};
