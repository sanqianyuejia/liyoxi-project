// 挂载与“声明即挂载”的核对（约定 C75）。先把全部问题查完，有一处不对就整个不挂，抛 MountError：
//   - 路由不是契约构造器的产出；operationId 重复
//   - 路由按声明要的中间件，装配清单没有给出来
// 路由挂到所属分组的应用上：路由级中间件在前，入参校验与处理器由 app.openapi() 接在后面。
import type { OpenAPIHono } from "@hono/zod-openapi";
import { isContractRoute, routeGroupOf } from "@liyoxi/contract";
import type { RouteGroup } from "@liyoxi/contract";
import type { Runtime } from "@liyoxi/services";

import type { ApiEnv } from "../context.js";

import type { HandlerEntry } from "./define.js";
import type { NamedMiddleware, RouteMiddlewareFactory } from "./types.js";
import { requiredMiddlewares } from "./requirements.js";

/** 路由挂不上：进程起不来。issues 里是全部问题 */
export class MountError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`路由挂载核对没过，共 ${issues.length} 处：\n- ${issues.join("\n- ")}`);
    this.name = "MountError";
    this.issues = issues;
  }
}

export interface MountedRoute {
  readonly operationId: string;
  readonly group: RouteGroup;
  readonly method: string;
  /** 带 /api/v1 的路径，契约里的写法（{param}） */
  readonly path: string;
  /** 路由级中间件的名字，按执行先后 */
  readonly middlewares: readonly string[];
}

export function mountRoutes(
  groups: Readonly<Record<RouteGroup, OpenAPIHono<ApiEnv>>>,
  entries: readonly HandlerEntry[],
  pipeline: readonly RouteMiddlewareFactory[],
  runtime: Runtime,
): MountedRoute[] {
  const issues: string[] = [];
  const seen = new Set<string>();
  const plans: { entry: HandlerEntry; chain: NamedMiddleware[] }[] = [];

  for (const entry of entries) {
    const { route } = entry;
    if (!isContractRoute(route)) {
      const what = String(
        (route as { operationId?: unknown } | null)?.operationId ?? "（没有 operationId）",
      );
      issues.push(
        `${what}：不是契约构造器（merchantRoute、adminRoute、portalRoute、hookRoute）的产出`,
      );
      continue;
    }
    if (seen.has(route.operationId)) {
      issues.push(`${route.operationId}：登记了不止一个处理器`);
      continue;
    }
    seen.add(route.operationId);

    const chain = pipeline
      .map((factory) => factory(route, runtime))
      .filter((middleware): middleware is NamedMiddleware => middleware !== null);
    const names = new Set(chain.map((middleware) => middleware.name));
    for (const requirement of requiredMiddlewares(route)) {
      if (!names.has(requirement.middleware)) {
        issues.push(
          `${route.operationId}：声明了 ${requirement.declared}，装配里没有中间件 ${requirement.middleware}`,
        );
      }
    }
    plans.push({ entry, chain });
  }
  if (issues.length > 0) throw new MountError(issues);

  return plans.map(({ entry, chain }) => {
    const { route, handler } = entry;
    const group = routeGroupOf(route);
    const withChain = { ...route, middleware: chain.map((middleware) => middleware.handler) };
    groups[group].openapi(withChain as never, handler as never);
    return {
      operationId: route.operationId,
      group,
      method: route.method.toUpperCase(),
      path: route.path,
      middlewares: chain.map((middleware) => middleware.name),
    };
  });
}
