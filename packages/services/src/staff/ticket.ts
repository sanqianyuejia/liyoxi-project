// 登录前的票据与设备 Cookie（W1-01a；a01 第 2.4 节；D4 第 6.3、6.4 节）。两样都是 HMAC 签名的短串，都不是会话：
// 拿着它访问不了任何业务接口。签名密钥各用各的（security 的 AuthKeys），互不通用。
//   票据：<base64url(JSON{s 员工, p 用途, e 过期毫秒, n 随机数, a? 激活码行})>.<base64url(HMAC)>
//         mfa 5 分钟；set_password、enroll_totp 15 分钟。无状态：过期之前可以重复出示，重放由各用例自己挡
//        （动态口令的时间步、激活码的 used_at、totp_enrolled_at）。
//   设备 Cookie：<员工 id>.<签发秒>.<随机数>.<base64url(HMAC)>，90 天。只证明“这台浏览器用这个账号成功登录过”，
//         登录失败时按它选桶。
import { randomBytes } from "node:crypto";

import { isUuid } from "../kernel/index.js";
import type { AuthKeys } from "../security/index.js";

export const TICKET_PURPOSES = ["mfa", "set_password", "enroll_totp"] as const;
export type TicketPurpose = (typeof TICKET_PURPOSES)[number];

const MINUTE = 60_000;
export const TICKET_TTL_MS: Readonly<Record<TicketPurpose, number>> = {
  mfa: 5 * MINUTE,
  set_password: 15 * MINUTE,
  enroll_totp: 15 * MINUTE,
};
export const DEVICE_COOKIE_DAYS = 90;
const DAY_MS = 24 * 60 * MINUTE;

export interface TicketClaims {
  readonly staffId: string;
  readonly purpose: TicketPurpose;
  readonly expiresAt: Date;
  /** set_password 票据带着的激活码行：设置密码成功时据此标记已用 */
  readonly activationId: string | null;
}

export interface IssuedTicket {
  readonly ticket: string;
  readonly expiresAt: Date;
}

/** 签发一张票据 */
export function issueTicket(
  keys: AuthKeys,
  input: { staffId: string; purpose: TicketPurpose; now: Date; activationId?: string | null },
): IssuedTicket {
  const expiresAt = new Date(input.now.getTime() + TICKET_TTL_MS[input.purpose]);
  const body = Buffer.from(
    JSON.stringify({
      s: input.staffId,
      p: input.purpose,
      e: expiresAt.getTime(),
      n: randomBytes(9).toString("base64url"),
      ...(input.activationId ? { a: input.activationId } : {}),
    }),
  ).toString("base64url");
  return { ticket: `${body}.${keys.sign("ticket", body).toString("base64url")}`, expiresAt };
}

/** 验一张票据：签名对、没过期、用途相符才给出内容；其余一律 null，不区分原因 */
export function readTicket(
  keys: AuthKeys,
  ticket: string,
  purpose: TicketPurpose,
  now: Date,
): TicketClaims | null {
  const [body, mac, ...rest] = ticket.length > 512 ? [] : ticket.split(".");
  if (!body || !mac || rest.length > 0) return null;
  if (!keys.verify("ticket", body, Buffer.from(mac, "base64url"))) return null;
  let claims: { s?: unknown; p?: unknown; e?: unknown; a?: unknown };
  try {
    claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as typeof claims;
  } catch {
    return null;
  }
  const { s, p, e, a } = claims;
  if (typeof s !== "string" || !isUuid(s) || p !== purpose) return null;
  if (typeof e !== "number" || e <= now.getTime()) return null;
  const activationId = typeof a === "string" && isUuid(a) ? a : null;
  return { staffId: s, purpose, expiresAt: new Date(e), activationId };
}

/** 签发设备 Cookie 的值 */
export function issueDeviceCookie(keys: AuthKeys, staffId: string, now: Date): string {
  const body = `${staffId}.${Math.floor(now.getTime() / 1000)}.${randomBytes(9).toString("base64url")}`;
  return `${body}.${keys.sign("device", body).toString("base64url")}`;
}

/** 设备 Cookie 是不是这名员工的、验签通过、没过 90 天。是 → 走 trusted 桶 */
export function deviceCookieMatches(
  keys: AuthKeys,
  value: string | null | undefined,
  staffId: string,
  now: Date,
): boolean {
  if (!value || value.length > 256) return false;
  const [id, issued, nonce, mac, ...rest] = value.split(".");
  if (!id || !issued || !nonce || !mac || rest.length > 0 || id !== staffId) return false;
  if (!keys.verify("device", `${id}.${issued}.${nonce}`, Buffer.from(mac, "base64url")))
    return false;
  const issuedMs = Number(issued) * 1000;
  return Number.isFinite(issuedMs) && now.getTime() - issuedMs < DEVICE_COOKIE_DAYS * DAY_MS;
}
