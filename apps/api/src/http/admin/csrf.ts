// 后台的防跨站检查（W1-01a；槽位 csrf，只给后台这一组；约定 C4；D4 第 6.5 节）。
// 非 GET 请求必须带 X-LYX-Admin: 1，且 Origin 与后台同源，否则 403 ORIGIN_REJECTED。登录前的公开接口同样要过。
// 表单发不出自定义头，跨源的 fetch 带自定义头要过预检，而后台不开 CORS。
// “与后台同源”（任务书 第 10 节第 4 项，不新增环境变量）：Origin 的主机名等于请求的 Host 的主机名，
// 且这个 Host 按 host-guard 的判断属于后台（admin.<域名>）；local、test 下不认域名的地址（localhost）也算。
// 端口不比：网关转给 api 的 Host 不带端口（infra/docker/nginx/proxy.conf 的 $host），本地整套环境走 8080 端口时
// 浏览器的 Origin 却带着它；Cookie 本来也不按端口隔离，同一个主机名的别的端口不算另一个站点。
import { AppError } from "@liyoxi/services";
import type { AppEnv } from "@liyoxi/services";

import type { RouteMiddlewareFactory } from "../../routing/types.js";
import { surfaceOf } from "../host-guard.js";

/** Origin 头里的主机名（小写，不带端口）；不是合法的源即 null */
function originHostname(origin: string | undefined): string | null {
  if (origin === undefined) return null;
  try {
    const url = new URL(origin);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.hostname.toLowerCase()
      : null;
  } catch {
    return null;
  }
}

/** Host 头的主机名（小写，去掉端口） */
const hostnameOf = (host: string): string => host.toLowerCase().replace(/:\d+$/, "");

/** 这次请求的 Origin 是不是后台自己的源 */
export function isAdminOrigin(
  origin: string | undefined,
  host: string | undefined,
  appEnv: AppEnv,
): boolean {
  const from = originHostname(origin);
  if (from === null || host === undefined || from !== hostnameOf(host)) return false;
  const surface = surfaceOf(host);
  return surface === "admin" || (surface === null && (appEnv === "local" || appEnv === "test"));
}

export const adminCsrf: RouteMiddlewareFactory = (route, runtime) => {
  if (route.method === "get") return null;
  const appEnv = runtime.env.APP_ENV;
  return async (c, next) => {
    // 没有 Host 头（用例里直接调应用）就取请求地址里的
    const host = c.req.header("host") ?? new URL(c.req.url).host;
    if (
      c.req.header("x-lyx-admin") !== "1" ||
      !isAdminOrigin(c.req.header("origin"), host, appEnv)
    ) {
      throw new AppError("ORIGIN_REJECTED");
    }
    await next();
  };
};
