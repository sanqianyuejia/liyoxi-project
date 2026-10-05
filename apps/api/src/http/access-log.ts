// 访问日志（约定 C7；D7 第 9.1 节）：一次请求一条，带方法、命中的路由、状态、耗时；4xx 记 warn，5xx 记 error。
// 查询参数里的凭证（token、code、sig 等，约定 A3）在写日志之前遮住。请求体不进日志。
import type { MiddlewareHandler } from "hono";
import { routePath } from "hono/route";

import type { ApiEnv } from "../context.js";

/** 值不进日志的查询参数名（比较时不分大小写） */
export const REDACTED_QUERY_KEYS: readonly string[] = [
  "token",
  "code",
  "sig",
  "signature",
  "msg_signature",
  "echostr",
  "secret",
  "ticket",
  "password",
];

/** 负载均衡每 5 秒探一次的两条：只记 debug */
const QUIET_PATHS: readonly string[] = ["/healthz", "/readyz"];

/** 路径加遮过的查询串：?token=abc&page=2 → ?token=***&page=2 */
export function redactUrl(url: string): string {
  const { pathname, searchParams } = new URL(url);
  const pairs = [...searchParams].map(([key, value]) =>
    REDACTED_QUERY_KEYS.includes(key.toLowerCase())
      ? `${encodeURIComponent(key)}=***`
      : `${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
  );
  return pairs.length === 0 ? pathname : `${pathname}?${pairs.join("&")}`;
}

export function accessLog(): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    const startedAt = performance.now();
    await next();
    const status = c.res.status;
    const identity = c.get("identity");
    const fields = {
      evt: "http",
      method: c.req.method,
      route: routePath(c, -1),
      url: redactUrl(c.req.url),
      status,
      ms: Math.round(performance.now() - startedAt),
      ...(identity === undefined
        ? {}
        : {
            actor: { type: identity.actor.type, id: identity.actor.id },
            entityId: identity.entityId,
            storeId: identity.storeId,
          }),
    };
    const log = c.get("log");
    if (status >= 500) log.error(fields, "请求完成");
    else if (status >= 400) log.warn(fields, "请求完成");
    else if (QUIET_PATHS.includes(c.req.path)) log.debug(fields, "请求完成");
    else log.info(fields, "请求完成");
  };
}
