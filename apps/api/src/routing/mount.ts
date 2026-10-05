// 挂载与“声明即挂载”的核对（约定 C75）。先把全部问题查完，有一处不对就整个不挂，抛 MountError：
//   - 装配的登记表不对：槽位不在 PIPELINE_ORDER 里；同一个槽位同一组登记了不止一件
//   - 路由不是契约构造器的产出；operationId 重复
//   - 中间件的工厂报配置不对（比如限流档位没有额度）
//   - 路由按声明要的中间件，装配里没有给出来
// 一条路由的中间件链按 PIPELINE_ORDER 的先后排（与登记表里写在第几行无关），挂到所属分组的应用上：
// 路由级中间件在前，入参校验与处理器由 app.openapi() 接在后面。
import type { OpenAPIHono } from "@hono/zod-openapi";
import { isContractRoute, ROUTE_GROUPS, routeGroupOf } from "@liyoxi/contract";
import type { AnyContractRoute, RouteGroup } from "@liyoxi/contract";
import type { Runtime } from "@liyoxi/services";
import type { MiddlewareHandler } from "hono";

import type { ApiEnv } from "../context.js";

import type { HandlerEntry } from "./define.js";
import { PIPELINE_ORDER } from "./pipeline.js";
import type { PipelineEntry, PipelineSlot } from "./pipeline.js";
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
  /** 路由级中间件的名字（槽位），按执行先后 */
  readonly middlewares: readonly PipelineSlot[];
}

interface Slotted {
  readonly slot: PipelineSlot;
  readonly handler: MiddlewareHandler<ApiEnv>;
}

/** 登记表有哪些问题；没有问题返回空数组 */
export function pipelineProblems(pipeline: readonly PipelineEntry[]): string[] {
  const problems: string[] = [];
  const taken = new Set<string>();
  for (const entry of pipeline) {
    if (!(PIPELINE_ORDER as readonly string[]).includes(entry.slot)) {
      problems.push(
        `装配：没有 ${String(entry.slot)} 这个槽位（先后在 routing/pipeline.ts 的 PIPELINE_ORDER 里定）`,
      );
      continue;
    }
    for (const group of entry.groups ?? ROUTE_GROUPS) {
      const key = `${entry.slot}@${group}`;
      if (taken.has(key)) {
        problems.push(`装配：槽位 ${entry.slot} 在 ${group} 组登记了不止一件`);
      }
      taken.add(key);
    }
  }
  return [...new Set(problems)];
}

/**
 * 一条路由的中间件链：按槽位的先后，取登记给它这一组、工厂又没有返回 null 的那几件。
 * 工厂抛的错记进 issues，那个槽位记进 failed（它有登记，只是配不上：不再另报一条“没有这件中间件”）。
 */
function chainOf(
  route: AnyContractRoute,
  pipeline: readonly PipelineEntry[],
  runtime: Runtime,
  issues: string[],
): { chain: Slotted[]; failed: Set<PipelineSlot> } {
  const group = routeGroupOf(route);
  const chain: Slotted[] = [];
  const failed = new Set<PipelineSlot>();
  for (const slot of PIPELINE_ORDER) {
    const entry = pipeline.find(
      (candidate) =>
        candidate.slot === slot &&
        (candidate.groups === undefined || candidate.groups.includes(group)),
    );
    if (entry === undefined) continue;
    try {
      const handler = entry.factory(route, runtime);
      if (handler !== null) chain.push({ slot, handler });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      issues.push(`${route.operationId}：中间件 ${slot} 配不上：${reason}`);
      failed.add(slot);
    }
  }
  return { chain, failed };
}

export function mountRoutes(
  groups: Readonly<Record<RouteGroup, OpenAPIHono<ApiEnv>>>,
  entries: readonly HandlerEntry[],
  pipeline: readonly PipelineEntry[],
  runtime: Runtime,
): MountedRoute[] {
  const issues: string[] = pipelineProblems(pipeline);
  if (issues.length > 0) throw new MountError(issues);

  const seen = new Set<string>();
  const plans: { entry: HandlerEntry; chain: Slotted[] }[] = [];

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

    const { chain, failed } = chainOf(route, pipeline, runtime, issues);
    const slots = new Set([...chain.map((item) => item.slot), ...failed]);
    for (const requirement of requiredMiddlewares(route)) {
      if (!slots.has(requirement.slot)) {
        issues.push(
          `${route.operationId}：声明了 ${requirement.declared}，装配里没有中间件 ${requirement.slot}`,
        );
      }
    }
    plans.push({ entry, chain });
  }
  if (issues.length > 0) throw new MountError(issues);

  return plans.map(({ entry, chain }) => {
    const { route, handler } = entry;
    const group = routeGroupOf(route);
    const withChain = { ...route, middleware: chain.map((item) => item.handler) };
    groups[group].openapi(withChain as never, handler as never);
    return {
      operationId: route.operationId,
      group,
      method: route.method.toUpperCase(),
      path: route.path,
      middlewares: chain.map((item) => item.slot),
    };
  });
}
