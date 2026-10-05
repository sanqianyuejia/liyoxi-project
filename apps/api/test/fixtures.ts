// 接口层用例的样例路由与处理器：四组各一条，外加几条专门用来验“声明即挂载”的。
// 路由由契约的构造器构造（不进契约的登记表），名字带 lyxtest，免得与真实资源混淆。
import {
  adminRoute,
  errorResponses,
  hookRoute,
  IdSchema,
  merchantRoute,
  okResponse,
  portalRoute,
  z,
} from "@liyoxi/contract";
import { AppError, uuidv7 } from "@liyoxi/services";

import { ok } from "../src/http/errors.js";
import { idemOf } from "../src/http/idempotency.js";
import { defineHandler } from "../src/routing/define.js";

const ThingSchema = z.object({ id: IdSchema, name: z.string(), count: z.int(), serial: z.int() });
const ThingParams = z.object({ thingId: IdSchema });
const ThingInput = z.object({ name: z.string().min(1), count: z.int().min(0) });

/** 商家端写路由：要登录（member）、required 幂等、路径带参数 */
export const thingUpdateRoute = merchantRoute({
  method: "put",
  path: "/m/lyxtest-things/{thingId}",
  operationId: "m.lyxtestThing.update",
  "x-clerk-view": "same",
  "x-idempotent": "required",
  request: {
    params: ThingParams,
    body: { required: true, content: { "application/json": { schema: ThingInput } } },
  },
  responses: { ...okResponse(ThingSchema), ...errorResponses(400, 409) },
});

/** 商家端公开的读路由：按查询参数决定抛哪种错，用来验错误映射 */
export const thingGetRoute = merchantRoute({
  method: "get",
  path: "/m/lyxtest-things/{thingId}",
  operationId: "m.lyxtestThing.get",
  "x-auth": "public",
  "x-clerk-view": "same",
  request: {
    params: ThingParams,
    query: z.object({ fail: z.enum(["app", "busy", "crash", "details"]).optional() }),
  },
  responses: { ...okResponse(ThingSchema), ...errorResponses(400, 404, 409, 500, 503) },
});

/** 商家端：required 的写路由，处理器故意不把幂等上下文交给 tx.run */
export const thingForgetfulRoute = merchantRoute({
  method: "post",
  path: "/m/lyxtest-things/forgetful",
  operationId: "m.lyxtestThing.forgetful",
  "x-clerk-view": "same",
  "x-idempotent": "required",
  responses: okResponse(z.null()),
});

export const adminListRoute = adminRoute({
  method: "get",
  path: "/admin/lyxtest-things",
  operationId: "admin.lyxtestThing.list",
  "x-auth": "public",
  "x-permission": null,
  responses: okResponse(z.object({ items: z.array(ThingSchema) })),
});

export const portalGetRoute = portalRoute({
  method: "get",
  path: "/portal/lyxtest-things/current",
  operationId: "portal.lyxtestThing.get",
  "x-auth": "public",
  responses: okResponse(z.object({ surface: z.literal("portal") })),
});

/** 回调：x-auth 固定 signed，自然幂等；应答不套信封 */
export const hookReceiveRoute = hookRoute({
  method: "post",
  path: "/hooks/lyxtest/events",
  operationId: "hooks.lyxtest.event.receive",
  "x-idempotent": "natural",
  "x-idempotent-by": ["uq_webhook_event_provider_event_id"],
  responses: { 200: { description: "按 Provider 协议应答" } },
});

/** 声明了能力点 */
export const capabilityRoute = merchantRoute({
  method: "get",
  path: "/m/lyxtest-things/guarded",
  operationId: "m.lyxtestThing.guarded",
  "x-auth": "member",
  "x-capability": "order.create",
  "x-clerk-view": "none",
  responses: okResponse(z.null()),
});

/** 声明了限流档位 */
export const rateLimitedRoute = merchantRoute({
  method: "get",
  path: "/m/lyxtest-things/limited",
  operationId: "m.lyxtestThing.limited",
  "x-auth": "public",
  "x-clerk-view": "same",
  "x-rate-limit": "m.global",
  responses: okResponse(z.null()),
});

/** 处理器被执行了几次：用例据此断言“重放不再执行” */
export const executions = { update: 0 };

export const thingUpdateHandler = defineHandler(thingUpdateRoute, async (c) => {
  const { thingId } = c.req.valid("param");
  const input = c.req.valid("json");
  const { runtime } = c.var;
  // 样例用例函数：开事务，写一行出站事件当作“业务写”，返回值进幂等记录
  const thing = await runtime.tx.run(
    async (tx) => {
      executions.update += 1;
      await tx.outboxEvent.create({
        data: {
          id: uuidv7(),
          eventType: "lyxtest.thing_updated",
          payload: { v: 1, thingId, name: input.name },
          actorType: "system",
          occurredAt: runtime.clock.now(),
        },
      });
      return { id: thingId, ...input, serial: executions.update };
    },
    { idem: idemOf(c) },
  );
  return ok(c, thing);
});

export const thingGetHandler = defineHandler(thingGetRoute, (c) => {
  const { thingId } = c.req.valid("param");
  const { fail } = c.req.valid("query");
  if (fail === "app") throw new AppError("STATE_NOT_ALLOWED", { message: "这件东西已经处理过了" });
  if (fail === "busy") throw new AppError("BUSY");
  if (fail === "details") {
    throw new AppError("REMINDED_TODAY", {
      details: { scene: "lyxtest", nextAvailableDate: "2026-01-06" },
    });
  }
  if (fail === "crash") throw new Error("连接串 postgresql://user:hunter2@db/内部细节");
  return ok(c, { id: thingId, name: "样例", count: 1, serial: 0 });
});

export const thingForgetfulHandler = defineHandler(thingForgetfulRoute, (c) => ok(c, null));

export const adminListHandler = defineHandler(adminListRoute, (c) => ok(c, { items: [] }));

export const portalGetHandler = defineHandler(portalGetRoute, (c) =>
  ok(c, { surface: "portal" as const }),
);

export const hookReceiveHandler = defineHandler(hookReceiveRoute, (c) => c.text("success"));

export const capabilityHandler = defineHandler(capabilityRoute, (c) => ok(c, null));

export const rateLimitedHandler = defineHandler(rateLimitedRoute, (c) => ok(c, null));

/** 四组各一条加几条辅助的：配上 fakeAuth 与 signature 的顶替件就挂得上 */
export const SAMPLE_HANDLERS = [
  thingUpdateHandler,
  thingGetHandler,
  thingForgetfulHandler,
  adminListHandler,
  portalGetHandler,
  hookReceiveHandler,
];
