// 路由级中间件的形态（W0-22）：带名字，按路由元数据生成。名字给“声明即挂载”的核对用。
import type { AnyContractRoute } from "@liyoxi/contract";
import type { Runtime } from "@liyoxi/services";
import type { MiddlewareHandler } from "hono";

import type { ApiEnv } from "../context.js";

/** 带名字的中间件 */
export interface NamedMiddleware {
  readonly name: string;
  readonly handler: MiddlewareHandler<ApiEnv>;
}

/** 给一条路由配中间件；这条路由用不着就返回 null */
export type RouteMiddlewareFactory = (
  route: AnyContractRoute,
  runtime: Runtime,
) => NamedMiddleware | null;
