import { BlockList, isIP } from "node:net";
import { AppError, security } from "@liyoxi/services";
import type { Runtime } from "@liyoxi/services";
import type { MiddlewareHandler } from "hono";
import type { ApiEnv } from "../context.js";
import { normalizeIp } from "./client-ip.js";

export function createAdminIpPolicy(cidrs: readonly string[]): (value: string | null) => boolean {
  const allowed = new BlockList();
  for (const cidr of cidrs) {
    const [address = "", prefix, extra] = cidr.split("/");
    const ip = normalizeIp(address),
      version = ip === null ? 0 : isIP(ip),
      max = version === 4 ? 32 : 128;
    const bits = prefix === undefined ? max : Number(prefix);
    if (
      ip === null ||
      extra !== undefined ||
      (prefix !== undefined && !/^\d+$/.test(prefix)) ||
      !Number.isInteger(bits) ||
      bits < 0 ||
      bits > max
    )
      throw new RangeError("后台来源白名单配置不合法");
    allowed.addSubnet(ip, bits, version === 4 ? "ipv4" : "ipv6");
  }
  return (value) => {
    if (cidrs.length === 0) return true;
    const ip = normalizeIp(value);
    return ip !== null && allowed.check(ip, isIP(ip) === 4 ? "ipv4" : "ipv6");
  };
}
/** clientIp 解析后的全局来源门禁；每条后台路由鉴权之前执行，登录态同样受限。 */
export function adminIp(runtime: Runtime): MiddlewareHandler<ApiEnv> {
  const permits = createAdminIpPolicy(runtime.env.ADMIN_IP_ALLOWLIST ?? []);
  return async (c, next) => {
    if (
      (c.req.path === "/api/v1/admin" || c.req.path.startsWith("/api/v1/admin/")) &&
      !permits(c.get("clientIp"))
    ) {
      await security.recordOffnetDenied(
        { tx: runtime.tx, clock: runtime.clock, logger: runtime.logger },
        {
          ip: c.get("clientIp"),
          userAgent: c.req.header("user-agent") ?? null,
          requestId: c.get("requestId"),
        },
      );
      throw new AppError("IP_NOT_ALLOWED");
    }
    await next();
  };
}
