// 后台的两个 Cookie 与请求元信息（W1-01a；约定 C4；a01 第 3.2、3.11 节）。
//   会话 Cookie   __Host-lyx_admin：HttpOnly; Secure; SameSite=Strict; Path=/。值是会话令牌，库里只存它的哈希
//   设备 Cookie   __Host-lyx_dev：90 天，只用于登录失败分桶，不是会话
// local、test 用无前缀的名字、不带 Secure（名字由 staff.staffCookieNames 定）。
import { staff } from "@liyoxi/services";
import type { SignedIn } from "@liyoxi/services";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";

import type { ApiEnv } from "../../context.js";

const DAY_SEC = 24 * 60 * 60;

const namesOf = (c: Context<ApiEnv>) => staff.staffCookieNames(c.get("runtime").env.APP_ENV);

/** 请求带来的会话 Cookie 的值；没有即 undefined */
export const sessionCookieOf = (c: Context<ApiEnv>): string | undefined =>
  getCookie(c, namesOf(c).session);

/** 请求带来的设备 Cookie 的值；没有即 null */
export const deviceCookieOf = (c: Context<ApiEnv>): string | null =>
  getCookie(c, namesOf(c).device) ?? null;

/** 建了会话之后：写会话 Cookie 与设备 Cookie */
export function setSessionCookies(c: Context<ApiEnv>, signedIn: SignedIn): void {
  const names = namesOf(c);
  const base = { httpOnly: true, secure: names.secure, sameSite: "Strict", path: "/" } as const;
  setCookie(c, names.session, signedIn.sessionToken, base);
  setCookie(c, names.device, signedIn.deviceCookie, {
    ...base,
    maxAge: staff.DEVICE_COOKIE_DAYS * DAY_SEC,
  });
}

/** 退出登录：清掉会话 Cookie，设备 Cookie 留着 */
export function clearSessionCookie(c: Context<ApiEnv>): void {
  const names = namesOf(c);
  deleteCookie(c, names.session, { path: "/", secure: names.secure });
}

/** 登录与安全事件要记的请求元信息。IP 是全局中间件按可信代理跳数取的那个；拿不到对端地址时记 unknown */
export const requestMetaOf = (c: Context<ApiEnv>) => ({
  ip: c.get("clientIp") ?? "unknown",
  userAgent: c.req.header("user-agent") ?? null,
  requestId: c.get("requestId"),
});
