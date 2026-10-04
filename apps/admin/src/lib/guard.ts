// 路由守卫（D7 第 5.4 节“路由”行）：每个路由的 beforeLoad 按模块等级判断，不满足去 403 占位页。
// 页面包的用法：beforeLoad: ({ context }) => requireModule(context.access, "finance", "v")
import { redirect } from "@tanstack/react-router";

import { canEnterPage, matchPage, type AdminModuleKey, type ModuleLevel } from "./menu";
import { hasModuleLevel, type AccessSnapshot } from "./permissions";

export const FORBIDDEN_PATH = "/403";

/** 模块等级不够就去 403 页；够了什么都不做 */
export function requireModule(
  access: AccessSnapshot | null,
  module: AdminModuleKey,
  need: Exclude<ModuleLevel, "n"> = "v",
): void {
  if (!hasModuleLevel(access, module, need)) throw redirect({ to: FORBIDDEN_PATH });
}

export type PageVerdict = "ok" | "forbidden" | "not-found";

/** 按菜单登记表判一个地址：登记了且能进、登记了但不能进（等级不够或开关没开）、没登记 */
export function judgePath(access: AccessSnapshot | null, pathname: string): PageVerdict {
  const matched = matchPage(pathname);
  if (!matched) return "not-found";
  return canEnterPage(access, matched.page) ? "ok" : "forbidden";
}
