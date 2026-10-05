// 后台处理器的登记（W1-01a；任务书 第 10 节第 2 项；docs/plan/tasks/README.md 第 7.5 节）。
// 后台要会话的路由（x-auth: staff）一律用它登记，不用 defineHandler：
//
//   export const refundHandlers = [
//     defineAdminHandler(adminRefundExecute, { module: "finance", need: "view" }, async (c, staff) => {
//       const body = c.req.valid("json");
//       const refund = await executeRefund(c.var.runtime, c.var.identity, staff.scope, body, { idem: idemOf(c) });
//       return ok(c, refund);
//     }),
//   ];
//
// 第二个参数是模块等级的要求：{ module, need }，need 取 view（等级不是 n）或 edit（e 或 o）；没有模块要求写 null。
// 契约的路由元数据里没有“模块等级”这个键（约定 C75），所以在这里声明；权限点仍只取路由的 x-permission。
// 判定由权限中间件做（http/admin/authz.ts）：模块等级 × 权限点，再按注册表查再验证；处理器不自己写判定。
// 权限矩阵回放的期望就由这两处声明算出（test/admin-matrix.test.ts）。
//
// 处理器的第二个入参 staff：
//   principal、ctx   会话校验的结果与判权用的上下文（ctx.permissions、ctx.moduleLevels）
//   scope            数据范围，交给带范围的仓储函数：范围之外与不存在都是 404
//   taskScope        声明的模块等级是“本人任务”（o）时只含本人、不带待分配池，否则同 scope。任务类资源的写操作
//                    （与约定 C58 的“本人任务”列表）一律用它取资源：o 级只能动分派给自己的任务，这一条只在这里定
//   assertPermission(key)   x-permission: assert-in-handler 的路由在取到对象后调：没有这个权限点 403 PERMISSION_DENIED，
//                    它标了再验证且已过期 403 STEP_UP_REQUIRED（路由声明了 x-step-up: skip 的不查再验证）
// 公开的后台路由（登录前的六条）没有员工，仍用 defineHandler。
import type { RouteHandler } from "@hono/zod-openapi";
import type { AnyContractRoute, PermissionKey } from "@liyoxi/contract";
import { authz } from "@liyoxi/services";
import type { DataScope, StaffContext, StaffPrincipal } from "@liyoxi/services";

import type { ApiEnv } from "../context.js";

import type { HandlerEntry } from "./define.js";

/** 模块等级的要求；没有写 null */
export type AdminModuleRequirement = authz.ModuleRequirement | null;

export interface AdminStaff {
  readonly principal: StaffPrincipal;
  readonly ctx: StaffContext;
  readonly scope: DataScope;
  readonly taskScope: DataScope;
  assertPermission(key: PermissionKey): void;
}

const declared = new WeakMap<object, AdminModuleRequirement>();

/** 这条路由用 defineAdminHandler 声明的模块要求；没有用它登记返回 undefined */
export function adminRequirementOf(route: AnyContractRoute): AdminModuleRequirement | undefined {
  return declared.get(route);
}

type HandlerContext<R extends AnyContractRoute> = Parameters<RouteHandler<R, ApiEnv>>[0];
type HandlerResult<R extends AnyContractRoute> = ReturnType<RouteHandler<R, ApiEnv>>;

export function defineAdminHandler<R extends AnyContractRoute>(
  route: R,
  requirement: AdminModuleRequirement,
  handler: (c: HandlerContext<R>, staff: AdminStaff) => HandlerResult<R>,
): HandlerEntry {
  if (route["x-auth"] !== "staff") {
    throw new TypeError(
      `${route.operationId}：defineAdminHandler 只登记 x-auth: staff 的后台路由，公开的用 defineHandler`,
    );
  }
  declared.set(route, requirement);
  const skipStepUp = route["x-step-up"] === "skip";
  const wrapped = ((c: HandlerContext<R>) => {
    const current = c.get("staff");
    // 会话中间件没跑到：装配出了问题，不是调用方的错
    if (current === undefined) throw new Error(`${route.operationId}：上下文里没有员工`);
    const { principal, ctx } = current;
    const ownTask = requirement !== null && ctx.moduleLevels[requirement.module] === "o";
    return handler(c, {
      principal,
      ctx,
      scope: ctx.scope,
      taskScope: ownTask ? authz.ownTaskScope(ctx.staff) : ctx.scope,
      assertPermission: (key) =>
        authz.assertPermission(ctx, key, c.get("runtime").clock.now(), { skipStepUp }),
    });
  }) as unknown as RouteHandler<R, ApiEnv>;
  return { route, handler: wrapped };
}
