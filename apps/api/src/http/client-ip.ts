// 客户端 IP（W0-22b；D4 第 9.5 节）。限流、审计、会话、后台 IP 白名单用的都是这同一个结果（c.var.clientIp）。
//
//   对端 = 套接字的对端地址
//   对端不在可信网段内            → 取对端（不是从自家代理进来的，转发头一概不看）
//   X-Forwarded-For 不够跳数那么长 → 取对端
//   否则                          → 取 X-Forwarded-For 从右往左数第 N 个（N = 自家代理的层数）
//
// 客户端自己伪造的 X-Forwarded-For 只会出现在左侧，从右取不受影响。跳数与可信网段是部署配置：
// 现在走 server.ts 的命令行参数（--trusted-proxy-hops、--trusted-proxy-cidrs），缺省 1 跳、回环与私有网段
//（预发先行阶段是“宿主机 nginx 一跳”，01 第 10 节）。负载均衡的回源网段要在预发实测后改成实际值。
import { BlockList, isIP } from "node:net";

import type { MiddlewareHandler } from "hono";

import type { ApiEnv } from "../context.js";

export interface TrustedProxySettings {
  /** 请求经过的自家代理层数；0 = 不看转发头 */
  readonly hops: number;
  /** 自家代理的网段，如 10.0.0.0/8；单个地址也可以 */
  readonly cidrs: readonly string[];
}

/** 回环与私有网段 */
export const PRIVATE_CIDRS: readonly string[] = [
  "127.0.0.0/8",
  "10.0.0.0/8",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "::1/128",
  "fc00::/7",
];

export const DEFAULT_TRUSTED_PROXY: TrustedProxySettings = { hops: 1, cidrs: PRIVATE_CIDRS };

/** 去掉 IPv4 映射成 IPv6 的前缀与方括号；不是合法的 IP 返回 null */
export function normalizeIp(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  let text = value.trim();
  if (text.startsWith("[") && text.endsWith("]")) text = text.slice(1, -1);
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(text);
  if (mapped?.[1] !== undefined) text = mapped[1];
  return isIP(text) === 0 ? null : text.toLowerCase();
}

const family = (ip: string): "ipv4" | "ipv6" => (isIP(ip) === 4 ? "ipv4" : "ipv6");

export type ClientIpResolver = (
  peer: string | null | undefined,
  forwardedFor: string | null | undefined,
) => string | null;

/** 按给定的跳数与可信网段建取法。配置不合法即抛错（进程起不来） */
export function createClientIpResolver(
  settings: TrustedProxySettings = DEFAULT_TRUSTED_PROXY,
): ClientIpResolver {
  const { hops, cidrs } = settings;
  if (!Number.isInteger(hops) || hops < 0 || hops > 8) {
    throw new RangeError("可信代理的跳数要是 0 到 8 之间的整数");
  }
  const trusted = new BlockList();
  for (const cidr of cidrs) {
    const [address = "", prefix] = cidr.trim().split("/");
    const ip = normalizeIp(address);
    const bits =
      prefix === undefined ? (ip !== null && family(ip) === "ipv4" ? 32 : 128) : Number(prefix);
    const max = ip !== null && family(ip) === "ipv4" ? 32 : 128;
    if (ip === null || !Number.isInteger(bits) || bits < 0 || bits > max) {
      throw new RangeError(`可信代理的网段写法不对：${cidr}`);
    }
    trusted.addSubnet(ip, bits, family(ip));
  }

  return (peer, forwardedFor) => {
    const from = normalizeIp(peer);
    if (from === null) return null;
    if (hops === 0 || !trusted.check(from, family(from))) return from;
    const chain = (forwardedFor ?? "")
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part !== "");
    if (chain.length < hops) return from;
    // 那一格写的不是 IP（代理不该这样写）：退到对端，不拿一段随便的文字当来源
    return normalizeIp(chain[chain.length - hops]) ?? from;
  };
}

/** 全局中间件：把客户端 IP 放进上下文。拿不到对端地址（用例里的 app.request()）时是 null */
export function clientIp(settings?: TrustedProxySettings): MiddlewareHandler<ApiEnv> {
  const resolve = createClientIpResolver(settings);
  return async (c, next) => {
    // @hono/node-server 把 Node 的请求对象放在 c.env.incoming；别的运行方式下没有
    const peer = c.env?.incoming?.socket?.remoteAddress;
    c.set("clientIp", resolve(peer, c.req.header("x-forwarded-for")));
    await next();
  };
}
