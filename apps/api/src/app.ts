// api 应用的装配（W0-22）。依据：约定 C1、C7、C75；任务书 docs/plan/tasks/W0-22.md。
//
//   全局：请求编号 → 访问日志 → 客户端 IP → Host 判断
//   根路径：探活 5 条
//   /api/v1 下四组（m、admin、portal、hooks）各一个应用：路由按 operationId 的第一段进所属的组，
//   每条路由 = 路由级中间件（先后与登记都在 routing/pipeline.ts，只在那一处定）→ 入参校验 → 处理器
//   出错统一走 onError，没有这条路由走 notFound
//
// 建应用时即做“声明即挂载”的核对：有路由漏挂了它声明的中间件，这里抛 MountError，进程起不来。
import { OpenAPIHono } from "@hono/zod-openapi";
import { ROUTE_GROUPS } from "@liyoxi/contract";
import type { RouteGroup } from "@liyoxi/contract";
import type { Runtime } from "@liyoxi/services";
import { Hono } from "hono";

import type { ApiEnv } from "./context.js";
import { accessLog } from "./http/access-log.js";
import { clientIp } from "./http/client-ip.js";
import type { TrustedProxySettings } from "./http/client-ip.js";
import { notFound, onError } from "./http/errors.js";
import { hostGuard } from "./http/host-guard.js";
import { requestId } from "./http/request-id.js";
import { validationHook } from "./http/validation.js";
import { mountProbes } from "./probes.js";
import type { Readiness } from "./probes.js";
import type { HandlerEntry } from "./routing/define.js";
import { mountRoutes } from "./routing/mount.js";
import type { MountedRoute } from "./routing/mount.js";
import { ROUTE_MIDDLEWARES } from "./routing/pipeline.js";
import type { PipelineEntry } from "./routing/pipeline.js";

export interface CreateAppOptions {
  readonly runtime: Runtime;
  /** 处理器清单：生产取 routes/index.ts 的 HANDLERS */
  readonly handlers: readonly HandlerEntry[];
  /** 路由级中间件的登记表，缺省 ROUTE_MIDDLEWARES；用例里可以换 */
  readonly pipeline?: readonly PipelineEntry[];
  /** 可信代理的跳数与网段（取客户端 IP 用），缺省 1 跳、回环与私有网段 */
  readonly trustedProxy?: TrustedProxySettings;
}

export interface Api {
  readonly app: Hono<ApiEnv>;
  /** 就绪状态：入口在监听之后改成 ready，收到退出信号改成 draining */
  readonly readiness: Readiness;
  /** 已挂载的业务路由 */
  readonly mounted: readonly MountedRoute[];
  /** 已挂载真实处理器的 operationId 与探活登记键，已排序：“已落地”的判定读它 */
  readonly mountedOperations: readonly string[];
}

export function createApp(options: CreateAppOptions): Api {
  const { runtime, handlers, pipeline = ROUTE_MIDDLEWARES } = options;
  const readiness: Readiness = { state: "starting" };

  const app = new Hono<ApiEnv>();
  app.use("*", requestId(runtime));
  app.use("*", accessLog());
  app.use("*", clientIp(options.trustedProxy));
  app.use("*", hostGuard(runtime.env.APP_ENV));
  app.onError(onError);
  app.notFound(notFound);

  const probes = mountProbes(app, { runtime, readiness });

  const groups = Object.fromEntries(
    ROUTE_GROUPS.map((group) => [group, new OpenAPIHono<ApiEnv>({ defaultHook: validationHook })]),
  ) as Record<RouteGroup, OpenAPIHono<ApiEnv>>;
  const mounted = mountRoutes(groups, handlers, pipeline, runtime);
  // 路径里已带 /api/v1/<组>，各组并到根上
  for (const group of ROUTE_GROUPS) app.route("/", groups[group]);

  return {
    app,
    readiness,
    mounted,
    mountedOperations: [...probes, ...mounted.map((route) => route.operationId)].sort(),
  };
}
