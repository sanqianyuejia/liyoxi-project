// “声明即挂载”的规则表（约定 C75：路由声明了什么就得挂上什么中间件，漏挂即启动失败）。
// 一行 = 路由的一种声明 → 必须出现在这条路由的中间件链里的槽位（pipeline.ts 的 PIPELINE_ORDER）。
// 后面的包（鉴权链、能力点与权限点、回调验签）交付中间件时登记到对应的槽位；它们没到之前，
// 声明了这些的路由挂不上去，进程起不来。往后只增行：新的声明（开关、再验证、店员视图……）由交付它的包加。
// 入参校验不在表里：它由 app.openapi() 按契约的 request 结构自带，绕不开。
//
// 限流档位与三段式不只看路由上的键：约定 C68、C51 是按 operationId 登记的，登记表在契约里
//（rateLimitTiersOf、isThreePhaseRoute）。每一组都有缺省档位，所以每条路由都要限流中间件。
import {
  ASSERT_IN_HANDLER,
  isThreePhaseRoute,
  RATE_LIMIT_TIERS,
  routeGroupOf,
} from "@liyoxi/contract";
import type { AnyContractRoute, RateLimitTierDef } from "@liyoxi/contract";

import type { PipelineSlot } from "./pipeline.js";

export interface MiddlewareRequirement {
  /** 要有的中间件：它的槽位 */
  readonly slot: PipelineSlot;
  /** 对应的声明，写进报错 */
  readonly declared: string;
  /** 这条路由要不要它 */
  when(route: AnyContractRoute): boolean;
}

/** 设了点（不是 null、不是“处理器内判定”） */
const pointed = (value: string | null | undefined): boolean =>
  value !== undefined && value !== null && value !== ASSERT_IN_HANDLER;

const tierDefs: readonly RateLimitTierDef[] = Object.values(RATE_LIMIT_TIERS);

/** 有没有限流档位：自己写了 x-rate-limit、名下登记了专用档位，或所在的组有缺省档位 */
const rateLimited = (route: AnyContractRoute): boolean =>
  route["x-rate-limit"] !== undefined ||
  tierDefs.some(
    (tier) =>
      tier.defaultFor === routeGroupOf(route) || tier.operations.includes(route.operationId),
  );

export const MIDDLEWARE_REQUIREMENTS: readonly MiddlewareRequirement[] = [
  {
    slot: "auth",
    declared: "x-auth（optional、user、member、staff、portal）",
    when: (route) => route["x-auth"] !== "public" && route["x-auth"] !== "signed",
  },
  {
    slot: "signature",
    declared: "x-auth: signed",
    when: (route) => route["x-auth"] === "signed",
  },
  {
    slot: "authz",
    declared: "x-capability / x-permission",
    when: (route) => pointed(route["x-capability"]) || pointed(route["x-permission"]),
  },
  {
    slot: "rateLimit",
    declared: "x-rate-limit（档位按 operationId 登记，约定 C68）",
    when: rateLimited,
  },
  {
    slot: "idempotency",
    declared: "x-idempotent",
    when: () => true,
  },
  {
    // 三段式的占用、续做、写回都落在幂等记录上，要的是同一个幂等上下文
    slot: "idempotency",
    declared: "x-three-phase（约定 C51）",
    when: isThreePhaseRoute,
  },
  {
    // W1-04：商家端要门店上下文的路由，没有成员关系中间件就没有人查 X-Store-Id
    slot: "membership",
    declared: "x-auth: member",
    when: (route) => route["x-auth"] === "member",
  },
];

/** 一条路由按声明必须挂的中间件 */
export function requiredMiddlewares(route: AnyContractRoute): MiddlewareRequirement[] {
  return MIDDLEWARE_REQUIREMENTS.filter((requirement) => requirement.when(route));
}
