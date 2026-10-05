// Host 判断（约定 C1：网关与应用各做一层）：域名与分组不配即 404。
//   api.<域名>     只放行 /m、/hooks 与根路径探活
//   admin.<域名>   只放行 /admin
//   portal.<域名>  只放行 /portal
//   /internal/*    只在不是这三种域名时放行（节点内网地址；网关对公网域名的 /internal/* 回 404）
// 只看域名的第一段，不比完整域名（预发是 api.stg.<域名>，同样认得）。第一段不是这三个的（节点内网地址、
// localhost）：local、test 下各组全放行，stg、prod 下只放行探活与 /internal/*。
import { API_PREFIX, ROUTE_GROUPS } from "@liyoxi/contract";
import type { RouteGroup } from "@liyoxi/contract";
import { AppError } from "@liyoxi/services";
import type { AppEnv } from "@liyoxi/services";
import type { MiddlewareHandler } from "hono";

import type { ApiEnv } from "../context.js";

/** 域名的第一段 → 放行的分组 */
export const HOST_SURFACES = {
  api: ["m", "hooks"],
  admin: ["admin"],
  portal: ["portal"],
} as const satisfies Record<string, readonly RouteGroup[]>;
export type HostSurface = keyof typeof HOST_SURFACES;

const ROOT_PROBES: readonly string[] = ["/healthz", "/readyz", "/health"];

/** Host 头属于哪一面；不是三种公网域名之一返回 null */
export function surfaceOf(host: string | undefined): HostSurface | null {
  const name = (host ?? "").toLowerCase().replace(/:\d+$/, "");
  const dot = name.indexOf(".");
  if (dot <= 0) return null;
  const label = name.slice(0, dot);
  return label in HOST_SURFACES ? (label as HostSurface) : null;
}

/** 这个 Host 能不能访问这条路径 */
export function hostAllows(host: string | undefined, path: string, appEnv: AppEnv): boolean {
  const surface = surfaceOf(host);
  if (path.startsWith("/internal/")) return surface === null;
  if (ROOT_PROBES.includes(path)) return surface === null || surface === "api";
  const group = ROUTE_GROUPS.find((name) => path.startsWith(`${API_PREFIX}/${name}/`));
  // 不在任何一组之内的路径：这里不管，落到 404
  if (group === undefined) return true;
  if (surface === null) return appEnv === "local" || appEnv === "test";
  return (HOST_SURFACES[surface] as readonly RouteGroup[]).includes(group);
}

export function hostGuard(appEnv: AppEnv): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    if (!hostAllows(c.req.header("host"), c.req.path, appEnv)) throw new AppError("NOT_FOUND");
    await next();
  };
}
