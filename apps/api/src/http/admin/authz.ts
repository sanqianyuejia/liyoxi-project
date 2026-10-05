// 后台的权限与再验证（W1-01a；槽位 authz、stepUp，只给后台这一组；D4 第 7.4、7.5 节；约定 C7、C66、C86）。
//   adminAuthz    模块等级 × 权限点（“仅主管”已算进生效的权限点）：不过 → 403 PERMISSION_DENIED
//   adminStepUp   权限点在注册表里标了再验证、会话的 stepup_at 超过 10 分钟 → 403 STEP_UP_REQUIRED；
//                 路由声明 x-step-up: skip 的不挂
// 模块要求取 defineAdminHandler 的声明，权限点取路由的 x-permission；x-permission: assert-in-handler 的权限点
// 由处理器取到对象后查（defineAdminHandler 给的 assertPermission，同一个判定函数）。
// 两件都排在限流与幂等上下文之前：再验证之后可以拿原幂等键重放。
// 要会话的后台路由没用 defineAdminHandler 登记、权限点不在注册表里：建应用即失败。
import { ASSERT_IN_HANDLER, isPermissionKey } from "@liyoxi/contract";
import type { AnyContractRoute, PermissionKey } from "@liyoxi/contract";
import { authz } from "@liyoxi/services";
import type { StaffContext } from "@liyoxi/services";
import type { Context } from "hono";

import type { ApiEnv } from "../../context.js";
import { adminRequirementOf } from "../../routing/admin.js";
import type { RouteMiddlewareFactory } from "../../routing/types.js";

/** 路由声明的权限点：登记过的键、处理器内判定，或 null。写了注册表外的键即抛错 */
export function routePermissionOf(route: AnyContractRoute): authz.RoutePermission {
  const value = route["x-permission"] ?? null;
  if (value === null || value === ASSERT_IN_HANDLER) return value;
  if (!isPermissionKey(value)) throw new Error(`x-permission 写的 ${value} 不在权限点注册表里`);
  return value;
}

/** 一条要会话的后台路由的判权要求：模块等级取 defineAdminHandler 的声明，权限点取 x-permission */
export function accessRequirementOf(route: AnyContractRoute): authz.AccessRequirement {
  const module = adminRequirementOf(route);
  if (module === undefined) {
    throw new Error(
      "要会话的后台路由须用 defineAdminHandler 登记并声明模块等级（没有模块要求写 null）",
    );
  }
  return { module, permission: routePermissionOf(route) };
}

function staffContextIn(c: Context<ApiEnv>): StaffContext {
  const current = c.get("staff");
  if (current === undefined) throw new Error("上下文里没有员工：会话中间件要排在权限之前");
  return current.ctx;
}

/** 要查再验证的权限点：标了再验证、路由没有声明 skip；不用查返回 null */
function stepUpKeyOf(route: AnyContractRoute): PermissionKey | null {
  const permission = routePermissionOf(route);
  if (permission === null || permission === ASSERT_IN_HANDLER) return null;
  return authz.requiresStepUp(permission) && route["x-step-up"] !== "skip" ? permission : null;
}

export const adminAuthz: RouteMiddlewareFactory = (route) => {
  if (route["x-auth"] !== "staff") return null;
  const requirement = accessRequirementOf(route);
  const { module, permission } = requirement;
  if (module === null && (permission === null || permission === ASSERT_IN_HANDLER)) return null;
  return async (c, next) => {
    authz.assertAccess(staffContextIn(c), requirement);
    await next();
  };
};

export const adminStepUp: RouteMiddlewareFactory = (route, runtime) => {
  if (route["x-auth"] !== "staff") return null;
  const key = stepUpKeyOf(route);
  if (key === null) return null;
  return async (c, next) => {
    authz.assertStepUp(staffContextIn(c), key, runtime.clock.now());
    await next();
  };
};
