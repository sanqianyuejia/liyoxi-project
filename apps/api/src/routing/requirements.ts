// “声明即挂载”的规则表（约定 C75：路由声明了什么就得挂上什么中间件，漏挂即启动失败）。
// 一行 = 路由元数据里的一种声明 → 必须出现在这条路由的中间件链里的名字。
// 后面的包（鉴权链、能力点与权限点、回调验签、限流）交付中间件时，名字照这里写；它们没到之前，
// 声明了这些的路由挂不上去，进程起不来。往后只增行：新的声明（开关、再验证、店员视图……）由交付它的包加。
// 入参校验不在表里：它由 app.openapi() 按契约的 request 结构自带，绕不开。
import { ASSERT_IN_HANDLER } from "@liyoxi/contract";
import type { AnyContractRoute } from "@liyoxi/contract";

export interface MiddlewareRequirement {
  /** 中间件的名字 */
  readonly middleware: string;
  /** 对应的声明，写进报错 */
  readonly declared: string;
  /** 这条路由要不要它 */
  when(route: AnyContractRoute): boolean;
}

/** 设了点（不是 null、不是“处理器内判定”） */
const pointed = (value: string | null | undefined): boolean =>
  value !== undefined && value !== null && value !== ASSERT_IN_HANDLER;

export const MIDDLEWARE_REQUIREMENTS: readonly MiddlewareRequirement[] = [
  {
    middleware: "auth",
    declared: "x-auth（optional、user、member、staff、portal）",
    when: (route) => route["x-auth"] !== "public" && route["x-auth"] !== "signed",
  },
  {
    middleware: "signature",
    declared: "x-auth: signed",
    when: (route) => route["x-auth"] === "signed",
  },
  {
    middleware: "authz",
    declared: "x-capability / x-permission",
    when: (route) => pointed(route["x-capability"]) || pointed(route["x-permission"]),
  },
  {
    middleware: "rateLimit",
    declared: "x-rate-limit",
    when: (route) => route["x-rate-limit"] !== undefined,
  },
  {
    middleware: "idempotency",
    declared: "x-idempotent",
    when: () => true,
  },
];

/** 一条路由按声明必须挂的中间件名 */
export function requiredMiddlewares(route: AnyContractRoute): MiddlewareRequirement[] {
  return MIDDLEWARE_REQUIREMENTS.filter((requirement) => requirement.when(route));
}
