// 请求编号（约定 C17、C18；D7 第 3.1 节）：只接受 36 个字符的 UUID，不符合即丢弃并重新生成；
// 写进上下文，回包头总是带上，错误响应也带。顺手把进程运行时放进上下文。
import { uuidv7 } from "@liyoxi/services";
import type { Runtime } from "@liyoxi/services";
import type { MiddlewareHandler } from "hono";

import type { ApiEnv } from "../context.js";

export const REQUEST_ID_HEADER = "X-Request-Id";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requestId(runtime: Runtime): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    const given = c.req.header(REQUEST_ID_HEADER);
    const id = given !== undefined && UUID.test(given) ? given : uuidv7();
    c.set("runtime", runtime);
    c.set("requestId", id);
    c.set("log", runtime.logger.child({ reqId: id }));
    c.header(REQUEST_ID_HEADER, id);
    await next();
    // 处理器绕开 c.json 直接返回 Response 时，上面那一句带不过去
    if (!c.res.headers.has(REQUEST_ID_HEADER)) c.res.headers.set(REQUEST_ID_HEADER, id);
  };
}
