// 再验证（step-up，W1-01a）：跟权限点注册表走，路由不另行声明（约定 C66）；唯一例外是 x-step-up: skip（约定 C86）。
// 依据：D4 第 7.5 节 L2；a01 第 2.3 节 session.stepUpValidUntil。登录本身算一次验证。
import { permissionByKey } from "@liyoxi/contract/authz";
import type { PermissionKey } from "@liyoxi/contract/authz";

import { AppError } from "../kernel/index.js";

/** 再验证的窗口：最近一次第二因子验证之后 10 分钟内不再要求（任务书 第 10 节第 6 项：代码常量） */
export const STEP_UP_TTL_MS = 10 * 60_000;

/** 这个权限点在注册表里标没标再验证 */
export function requiresStepUp(key: PermissionKey): boolean {
  return permissionByKey(key)?.stepUp === true;
}

/** 再验证有效到什么时候；没验证过为 null */
export function stepUpValidUntil(stepUpAt: Date | null): Date | null {
  return stepUpAt === null ? null : new Date(stepUpAt.getTime() + STEP_UP_TTL_MS);
}

/** 此刻再验证还在不在窗口内（恰好 10 分钟算在内） */
export function isStepUpFresh(stepUpAt: Date | null, now: Date): boolean {
  return stepUpAt !== null && now.getTime() - stepUpAt.getTime() <= STEP_UP_TTL_MS;
}

/**
 * 权限点标了再验证且已超出窗口即抛 STEP_UP_REQUIRED。中间件与处理器（assert-in-handler）调的是同一个。
 * skipStepUp：路由声明了 x-step-up: skip，不查。
 */
export function assertStepUp(
  session: { readonly stepUpAt: Date | null },
  key: PermissionKey,
  now: Date,
  options: { skipStepUp?: boolean } = {},
): void {
  if (options.skipStepUp === true || !requiresStepUp(key)) return;
  if (!isStepUpFresh(session.stepUpAt, now)) throw new AppError("STEP_UP_REQUIRED");
}
