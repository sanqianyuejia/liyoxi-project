// 限流中间件（W0-22b；约定 C68）。排在鉴权与开关之后、幂等上下文之前（约定 C7）：429 发生在幂等行落库之前。
//
// 一条路由的生效档位取自契约（rateLimitTiersOf：专用档位 + 自己写的 x-rate-limit + 所在组的缺省档位），
// 每个档位的规则取自额度表（rate-limit-quotas.ts）。挂载时把这条路由用得上的规则定下来；
// 档位没有额度、规则写得不对就抛错，api 起不来。
// 每次请求：各条规则各出一个计数键，一并交给 runtime.rateLimiter（Redis 固定窗口；Redis 不可用时进程内计数、
// 限额减半）。有一条超限即 429 RATE_LIMITED，带 Retry-After。
// 一个档位里没有一条规则套得上这次请求（比如只有按会话的规则而请求没登录）：按来源 IP 用第一条规则的额度数，不放开。
import { createHash } from "node:crypto";

import { pathParamNames, rateLimitTiersOf } from "@liyoxi/contract";
import type { RateLimitTier } from "@liyoxi/contract";
import { actorKey } from "@liyoxi/services";
import type { RateLimitCheck } from "@liyoxi/services";
import type { Context } from "hono";

import type { ApiEnv } from "../context.js";
import type { RouteMiddlewareFactory } from "../routing/types.js";

import { RateLimited } from "./errors.js";
import { RATE_LIMIT_QUOTAS } from "./rate-limit-quotas.js";
import type { RateLimitRule } from "./rate-limit-quotas.js";

export interface RateLimitOptions {
  /** 额度表，缺省 RATE_LIMIT_QUOTAS；用例里换成小额度 */
  readonly quotas?: PartialQuotas;
}

/** 运行时换进来的额度表可以缺档位：缺了哪个，用到它的路由挂不上 */
type PartialQuotas = Readonly<Partial<Record<RateLimitTier, readonly RateLimitRule[]>>>;

/** 拿不到客户端 IP 时的计数主体：全算在一起，不放开 */
const UNKNOWN_IP = "unknown";
const PLAIN_SUBJECT = /^[A-Za-z0-9._:-]{1,64}$/;

/** 计数键里的主体：路径参数是没校验过的输入，不像样的先摘要 */
const safeSubject = (value: string): string =>
  PLAIN_SUBJECT.test(value) ? value : createHash("sha256").update(value).digest("hex").slice(0, 32);

const isPositiveInt = (value: number): boolean => Number.isInteger(value) && value > 0;

/** 一条规则写得对不对；对即返回 null */
function ruleProblem(rule: RateLimitRule, params: readonly string[]): string | null {
  if (!isPositiveInt(rule.limit) || !isPositiveInt(rule.windowSec)) {
    return "limit 与 windowSec 要是正整数";
  }
  if (rule.by === "param") {
    if (rule.param === undefined) return "by: param 的规则要写 param";
    if (!params.includes(rule.param)) return `路径里没有参数 ${rule.param}`;
  }
  if (rule.anonymousOnly === true && rule.by !== "ip") return "anonymousOnly 只用于 by: ip";
  return null;
}

/** 这条规则在这次请求上按谁数；不适用返回 null */
function subjectOf(rule: RateLimitRule, c: Context<ApiEnv>): string | null {
  const identity = c.get("identity");
  switch (rule.by) {
    case "ip":
      if (rule.anonymousOnly === true && identity !== undefined) return null;
      return c.get("clientIp") ?? UNKNOWN_IP;
    case "user":
      return identity === undefined ? null : actorKey(identity.actor);
    case "session":
      if (identity === undefined) return null;
      return c.get("sessionId") ?? actorKey(identity.actor);
    case "param": {
      const value = c.req.param(rule.param as string);
      return value === undefined || value === "" ? null : safeSubject(value);
    }
  }
}

const keyOf = (tier: string, rule: RateLimitRule, by: string, subject: string): string =>
  `rl:${tier}:${by}:${subject}:${rule.windowSec}`;

export function rateLimit(options: RateLimitOptions = {}): RouteMiddlewareFactory {
  const quotas: PartialQuotas = options.quotas ?? RATE_LIMIT_QUOTAS;

  return (route, runtime) => {
    const params = pathParamNames(route.path);
    const plans = rateLimitTiersOf(route).map((tier) => {
      const all = quotas[tier];
      if (all === undefined || all.length === 0) {
        throw new Error(`限流档位 ${tier} 没有额度（额度表里补上这个档位）`);
      }
      const rules = all.filter(
        (rule) => rule.only === undefined || rule.only.includes(route.operationId),
      );
      if (rules.length === 0) {
        throw new Error(`限流档位 ${tier} 的规则都用 only 指给了别的接口，没有一条给这条路由`);
      }
      for (const rule of rules) {
        const problem = ruleProblem(rule, params);
        if (problem !== null) throw new Error(`限流档位 ${tier} 的规则写得不对：${problem}`);
      }
      return { tier, rules };
    });
    if (plans.length === 0) return null;

    return async (c, next) => {
      const checks: RateLimitCheck[] = [];
      const tiers: RateLimitTier[] = [];
      for (const { tier, rules } of plans) {
        const before = checks.length;
        for (const rule of rules) {
          const subject = subjectOf(rule, c);
          if (subject === null) continue;
          const by = rule.by === "param" ? `param.${rule.param}` : rule.by;
          checks.push({
            key: keyOf(tier, rule, by, subject),
            limit: rule.limit,
            windowMs: rule.windowSec * 1_000,
          });
          tiers.push(tier);
        }
        if (checks.length === before) {
          const rule = rules[0] as RateLimitRule;
          checks.push({
            key: keyOf(tier, rule, "ip", c.get("clientIp") ?? UNKNOWN_IP),
            limit: rule.limit,
            windowMs: rule.windowSec * 1_000,
          });
          tiers.push(tier);
        }
      }
      const decision = await runtime.rateLimiter.hit(checks);
      if (!decision.allowed) {
        c.get("log").warn(
          {
            evt: "ratelimit.hit",
            operationId: route.operationId,
            tiers: [...new Set(decision.exceeded.map((index) => tiers[index]))],
            degraded: decision.degraded,
          },
          "限流：超出额度",
        );
        if (route.operationId === "admin.piiReveal.create") {
          const index = decision.exceeded.find((index) => tiers[index] === "admin.pii_reveal");
          if (index !== undefined) {
            const check = checks[index]!;
            const limit = decision.degraded
              ? Math.max(1, Math.floor(check.limit / 2))
              : check.limit;
            const window = check.windowMs === 3_600_000 ? "hour" : "day";
            const staffId = c.get("staff")?.principal.staff.id;
            if (staffId !== undefined) await runtime.piiReveal.raiseLimit(staffId, window, limit);
            throw new RateLimited(decision.retryAfterSec, { window, limit });
          }
        }
        throw new RateLimited(decision.retryAfterSec);
      }
      await next();
    };
  };
}
