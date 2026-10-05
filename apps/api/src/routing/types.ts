// 路由级中间件的形态（W0-22；W0-22b 改成按槽位登记）：一个工厂，按路由元数据决定这条路由要不要它、怎么配。
// 用不着就返回 null。它排在第几位不由工厂说了算：登记时写槽位，先后在 pipeline.ts 的 PIPELINE_ORDER 里定。
// 配置不对（比如档位没有额度）就抛错：挂载时会接住，连同别的问题一次报全，进程起不来。
import type { AnyContractRoute } from "@liyoxi/contract";
import type { Runtime } from "@liyoxi/services";
import type { MiddlewareHandler } from "hono";

import type { ApiEnv } from "../context.js";

/** 给一条路由配中间件；这条路由用不着就返回 null */
export type RouteMiddlewareFactory = (
  route: AnyContractRoute,
  runtime: Runtime,
) => MiddlewareHandler<ApiEnv> | null;
