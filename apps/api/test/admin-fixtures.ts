// 后台接口层用例的样例路由与处理器（W1-01a）：验模块等级、权限点与“仅主管”、再验证、处理器内判定、“本人任务”的范围。
// 路由由契约的构造器构造（不进契约的登记表），名字带 lyxtest。处理器都用 defineAdminHandler 登记。
import { adminRoute, errorResponses, IdSchema, okResponse, z } from "@liyoxi/contract";
import { authz, uuidv7 } from "@liyoxi/services";

import { ok } from "../src/http/errors.js";
import { idemOf } from "../src/http/idempotency.js";
import { defineAdminHandler } from "../src/routing/admin.js";

const Params = z.object({ thingId: IdSchema });
const NONE = { "x-idempotent": "none", "x-idempotent-reason": "样例路由，不写库" } as const;

/** 只要模块等级：财务模块查看 */
export const financeViewRoute = adminRoute({
  method: "get",
  path: "/admin/lyxtest-finance",
  operationId: "admin.lyxtestFinance.list",
  "x-permission": null,
  responses: { ...okResponse(z.null()), ...errorResponses(401, 403) },
});

/** 模块等级要编辑：交付模块（剪辑师在这里是“本人任务”）。回包是两种范围的快照 */
export const deliveryEditRoute = adminRoute({
  method: "post",
  path: "/admin/lyxtest-delivery/{thingId}/submit",
  operationId: "admin.lyxtestDelivery.submit",
  "x-permission": null,
  ...NONE,
  request: { params: Params },
  responses: { ...okResponse(z.unknown()), ...errorResponses(401, 403) },
});

/** 权限点带“仅主管”：撤销链接核验通过（发布专员主管、交付经理主管） */
export const leadOnlyRoute = adminRoute({
  method: "post",
  path: "/admin/lyxtest-links/{thingId}/revoke",
  operationId: "admin.lyxtestLink.revoke",
  "x-permission": "publish.link.verify_revoke",
  ...NONE,
  request: { params: Params },
  responses: { ...okResponse(z.null()), ...errorResponses(401, 403) },
});

/** 权限点标了再验证，required 幂等：再验证之后拿原键重放 */
export const stepUpRoute = adminRoute({
  method: "put",
  path: "/admin/lyxtest-roles/{thingId}",
  operationId: "admin.lyxtestRole.replace",
  "x-permission": "sys.role.edit",
  "x-idempotent": "required",
  request: { params: Params },
  responses: {
    ...okResponse(z.object({ id: IdSchema, serial: z.int() })),
    ...errorResponses(400, 401, 403),
  },
});

/** 同一个权限点，声明了 x-step-up: skip（约定 C86 的驳回接口）：不查再验证 */
export const stepUpSkipRoute = adminRoute({
  method: "post",
  path: "/admin/lyxtest-roles/{thingId}/reject",
  operationId: "admin.lyxtestRole.reject",
  "x-permission": "sys.role.edit",
  "x-step-up": "skip",
  ...NONE,
  request: { params: Params },
  responses: { ...okResponse(z.null()), ...errorResponses(401, 403) },
});

/** 处理器内判定：权限点取决于对象，取到之后由处理器查（同一个判定函数） */
export const inHandlerRoute = adminRoute({
  method: "post",
  path: "/admin/lyxtest-roles/{thingId}/reveal",
  operationId: "admin.lyxtestRole.reveal",
  "x-permission": "assert-in-handler",
  ...NONE,
  request: { params: Params },
  responses: { ...okResponse(z.null()), ...errorResponses(401, 403) },
});

/** 处理器被执行了几次 */
export const adminExecutions = { stepUp: 0 };

export const financeViewHandler = defineAdminHandler(
  financeViewRoute,
  { module: "finance", need: "view" },
  (c) => ok(c, null),
);

export const deliveryEditHandler = defineAdminHandler(
  deliveryEditRoute,
  { module: "delivery", need: "edit" },
  (c, staff) =>
    ok(c, {
      scope: authz.scopeSnapshot(staff.scope),
      taskScope: authz.scopeSnapshot(staff.taskScope),
    }),
);

export const leadOnlyHandler = defineAdminHandler(
  leadOnlyRoute,
  { module: "publish", need: "view" },
  (c) => ok(c, null),
);

export const stepUpHandler = defineAdminHandler(
  stepUpRoute,
  { module: "system", need: "view" },
  async (c) => {
    const { thingId } = c.req.valid("param");
    const { runtime } = c.var;
    // 样例用例函数：开事务，写一行出站事件当作“业务写”，返回值进幂等记录
    const result = await runtime.tx.run(
      async (tx) => {
        adminExecutions.stepUp += 1;
        await tx.outboxEvent.create({
          data: {
            id: uuidv7(),
            eventType: "lyxtest.role_replaced",
            payload: { v: 1, thingId },
            actorType: "system",
            occurredAt: runtime.clock.now(),
          },
        });
        return { id: thingId, serial: adminExecutions.stepUp };
      },
      { idem: idemOf(c) },
    );
    return ok(c, result);
  },
);

export const stepUpSkipHandler = defineAdminHandler(
  stepUpSkipRoute,
  { module: "system", need: "view" },
  (c) => ok(c, null),
);

export const inHandlerHandler = defineAdminHandler(inHandlerRoute, null, (c, staff) => {
  staff.assertPermission("sys.role.edit");
  return ok(c, null);
});

export const ADMIN_SAMPLE_HANDLERS = [
  financeViewHandler,
  deliveryEditHandler,
  leadOnlyHandler,
  stepUpHandler,
  stepUpSkipHandler,
  inHandlerHandler,
];
