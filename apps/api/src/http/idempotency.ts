// 幂等上下文（约定 C47–C50；D7 第 3.1 节；用法见 packages/services/src/kernel/README.md 第 9 节）。
// 按路由元数据给每次请求建一个幂等上下文，放进 c.var.idem；写用例把它交给 runtime.tx.run(fn, { idem })。
//   required：缺键或键的格式不对 → 400 IDEMPOTENCY_KEY_REQUIRED；同键重放时处理器照常被调，
//             tx.run 不再执行业务、直接返回存下的结果，这里给回包加 Idempotent-Replayed: true。
//   natural、none：也建上下文（不读写幂等表），处理器的写法三种方式一样。
// 防漏用：required 的路由，处理器成功返回而上下文没进过 tx.run，local、test 下报错，stg、prod 下上报。
// 排在鉴权之后（要操作人）、入参校验之前：请求哈希算在原始的 JSON 请求体上。
import { routeGroupOf } from "@liyoxi/contract";
import { assertIdempotencyUsed, createIdempotencyContext } from "@liyoxi/services";
import type { IdempotencyContext } from "@liyoxi/services";
import type { Context } from "hono";

import type { ApiEnv } from "../context.js";
import type { RouteMiddlewareFactory } from "../routing/types.js";

import { ValidationFailure } from "./errors.js";

export const IDEMPOTENCY_KEY_HEADER = "Idempotency-Key";
export const IDEMPOTENT_REPLAYED_HEADER = "Idempotent-Replayed";
export const STORE_ID_HEADER = "X-Store-Id";

async function jsonBody(c: Context<ApiEnv>): Promise<unknown> {
  if (!/\bjson\b/i.test(c.req.header("content-type") ?? "")) return null;
  try {
    // Hono 把解析结果缓存在请求上：后面的校验器不会再读一遍流
    return await c.req.json();
  } catch {
    throw new ValidationFailure([{ path: "", message: "请求体不是合法的 JSON" }]);
  }
}

export const idempotency: RouteMiddlewareFactory = (route, runtime) => {
  const mode = route["x-idempotent"];
  const scope = route.operationId;
  const redact = route["x-redact-on-replay"] ?? [];
  const merchant = routeGroupOf(route) === "m";
  return async (c, next) => {
    const idem = createIdempotencyContext({
      mode,
      scope,
      redact,
      actor: c.get("identity")?.actor ?? null,
      key: c.req.header(IDEMPOTENCY_KEY_HEADER) ?? null,
      ...(mode === "required"
        ? {
            request: {
              method: c.req.method,
              pathParams: c.req.param(),
              body: await jsonBody(c),
              // 商家端另计入门店上下文：同一个键在不同门店下视为不同请求（A121）
              storeId: merchant ? (c.req.header(STORE_ID_HEADER) ?? null) : null,
            },
          }
        : {}),
    });
    c.set("idem", idem);
    await next();
    if (idem.replayed) c.res.headers.set(IDEMPOTENT_REPLAYED_HEADER, "true");
    if (c.res.status < 400) {
      assertIdempotencyUsed(idem, { appEnv: runtime.env.APP_ENV, report: runtime.report });
    }
  };
};

/** 处理器里取幂等上下文：没挂幂等中间件即抛错（启动核对会先拦住，这里只是把类型收紧） */
export function idemOf(c: Context<ApiEnv>): IdempotencyContext {
  const idem = c.get("idem");
  if (idem === undefined)
    throw new TypeError("这条路由没有幂等上下文：它不是经 mountRoutes 挂上的");
  return idem;
}
