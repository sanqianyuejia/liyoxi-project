// 后台的判定（W1-01a）：模块等级 × 权限点（“仅主管”已在生效权限点里算过）。数据范围在 data-scope.ts 与 scope.ts。
// 依据：D4 第 7.1、7.2、7.4、7.5 节；约定 C7、C66、C86；a01 第 2.3 节。
// 先后照请求授权管线：模块等级与权限点不过 → 403 PERMISSION_DENIED；再验证过期 → 403 STEP_UP_REQUIRED。
// 两步都排在幂等上下文之前（约定 C7），所以再验证之后可以拿原幂等键重放。
import type { AdminModuleKey, ModuleLevel, PermissionKey } from "@liyoxi/contract/authz";

import { AppError } from "../kernel/index.js";

import type { StaffContext } from "./context.js";
import { assertStepUp } from "./step-up.js";

/** view 要求等级不是 n；edit 要求 e 或 o（o 的进一步限制在资源层：只能改分派给自己的任务） */
export type ModuleNeed = "view" | "edit";
export interface ModuleRequirement {
  readonly module: AdminModuleKey;
  readonly need: ModuleNeed;
}

/** 路由的 x-permission：权限点；assert-in-handler（由处理器调 assertPermission）；null 不设权限点 */
export type RoutePermission = PermissionKey | "assert-in-handler" | null;

export interface AccessRequirement {
  /** 模块等级的要求；没有写 null */
  readonly module: ModuleRequirement | null;
  readonly permission: RoutePermission;
}

export type AccessDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: "module_level" | "permission" };

const ALLOWED: AccessDecision = Object.freeze({ allowed: true });

/** 只认得出的等级才放行：等级取不到（模块键不在登记里）按不过算 */
export function satisfiesLevel(level: ModuleLevel, need: ModuleNeed): boolean {
  if (level === "e" || level === "o") return true;
  return level === "v" && need === "view";
}

type Subject = Pick<StaffContext, "moduleLevels" | "permissions">;

export function hasPermission(subject: Subject, key: PermissionKey): boolean {
  return subject.permissions.has(key);
}

/** 判定一条要求过不过。纯函数，不抛错：权限矩阵的期望也由它算 */
export function decideAccess(subject: Subject, requirement: AccessRequirement): AccessDecision {
  const { module, permission } = requirement;
  if (module !== null && !satisfiesLevel(subject.moduleLevels[module.module], module.need)) {
    return { allowed: false, reason: "module_level" };
  }
  if (
    permission !== null &&
    permission !== "assert-in-handler" &&
    !hasPermission(subject, permission)
  ) {
    return { allowed: false, reason: "permission" };
  }
  return ALLOWED;
}

const denied = (): AppError => new AppError("PERMISSION_DENIED");

/** 模块等级或权限点不过即抛 PERMISSION_DENIED */
export function assertAccess(subject: Subject, requirement: AccessRequirement): void {
  if (!decideAccess(subject, requirement).allowed) throw denied();
}

export interface AuthorizeOptions {
  /** 路由声明了 x-step-up: skip（约定 C86 登记的驳回接口）：权限点照查，不查再验证 */
  skipStepUp?: boolean;
}

/**
 * 请求授权管线里“权限”与“再验证”两步：路由声明的要求过了，再按注册表查再验证。
 * 权限中间件对每条后台路由调它一次。
 */
export function authorize(
  ctx: StaffContext,
  requirement: AccessRequirement,
  now: Date,
  options: AuthorizeOptions = {},
): void {
  assertAccess(ctx, requirement);
  const { permission } = requirement;
  if (permission !== null && permission !== "assert-in-handler") {
    assertStepUp(ctx, permission, now, options);
  }
}

/**
 * 处理器里的判定（路由声明 assert-in-handler，权限点取决于对象或请求体）：
 * 没有这个权限点抛 PERMISSION_DENIED；它在注册表里标了再验证且已过期抛 STEP_UP_REQUIRED（约定 C66）。
 */
export function assertPermission(
  ctx: StaffContext,
  key: PermissionKey,
  now: Date,
  options: AuthorizeOptions = {},
): void {
  if (!hasPermission(ctx, key)) throw denied();
  assertStepUp(ctx, key, now, options);
}
