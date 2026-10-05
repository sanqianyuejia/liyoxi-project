// 处理器的登记（W0-22）：一条契约路由配一个薄壳处理器（取参 → 调一个用例函数 → 回包；硬性规则 6）。
//
//   export const orderHandlers = [
//     defineHandler(orderCreateRoute, async (c) => {
//       const input = c.req.valid("json");
//       const { runtime, identity } = c.var;
//       const order = await submitOrder(runtime, identity, input, { idem: idemOf(c) });
//       return ok(c, order);
//     }),
//   ];
//
// 各域一个文件，汇在 routes/index.ts。路由对象只能是契约构造器的产出：元数据与结构都取自契约。
import type { RouteHandler } from "@hono/zod-openapi";
import type { AnyContractRoute } from "@liyoxi/contract";
import type { Handler } from "hono";

import type { ApiEnv } from "../context.js";

export interface HandlerEntry {
  readonly route: AnyContractRoute;
  // 登记之后只按路由对象分发，处理器的入参与返回类型在 defineHandler 那一刻已经对过
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly handler: Handler<ApiEnv, any, any, any>;
}

export function defineHandler<R extends AnyContractRoute>(
  route: R,
  handler: RouteHandler<R, ApiEnv>,
): HandlerEntry {
  return { route, handler };
}
