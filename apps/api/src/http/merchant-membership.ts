// 成员关系与能力点（W1-04；约定 C17、C55、C56、C66；D4 第 5.1、5.2 节）。两件中间件，各占一个槽位：
//
// merchantMembership（membership 槽位，只挂 x-auth: member 的路由）
//   必带 X-Store-Id；缺失、不是 UUID、门店不存在、对它没有成员关系 → 403 NOT_A_MEMBER（不作区分）。
//   每请求现查，主体由门店推出；老板进自己停用的门店得到收尾上下文。
//   店员调 x-clerk-view: none 的路由 → 403 ROLE_FORBIDDEN，不等到处理器（任务书 第 10 节第 4 项）。
//   通过后把角色与归属补进 identity，并把成员关系放进 c.var.membership。
//
// merchantCapability（authz 槽位，只挂声明了 x-capability 的路由）
//   按“角色 × 门店状态”查契约的能力点矩阵：店员没有 → ROLE_FORBIDDEN；已停用门店的老板超出收尾范围 → STORE_ARCHIVED。
//   user 路由没有门店上下文：按账号此刻的有效成员关系的角色判，没有成员关系按店员那一列（最小的一列）。
//   optional 路由上的匿名请求不判（游客视图由响应的裁剪管）。assert-in-handler 的由处理器自己判。
import { ASSERT_IN_HANDLER } from "@liyoxi/contract";
import { AppError, assertCapability, createIdentityContext, standingOf } from "@liyoxi/services";

import { merchantServicesOf } from "../merchant/services.js";
import type { RouteMiddlewareFactory } from "../routing/types.js";

import { STORE_ID_HEADER } from "./idempotency.js";
import { merchantSessionOf } from "./merchant-auth.js";

export const merchantMembership: RouteMiddlewareFactory = (route, runtime) => {
  if (route["x-auth"] !== "member") return null;
  const clerkBarred = route["x-clerk-view"] === "none";
  const { tenant } = merchantServicesOf(runtime);
  return async (c, next) => {
    const session = merchantSessionOf(c);
    const storeId = c.req.header(STORE_ID_HEADER)?.trim().toLowerCase() ?? "";
    const membership =
      storeId === ""
        ? null
        : await runtime.tx.run((tx) =>
            tenant.resolveMembership(tx, { merchantUserId: session.merchantUserId, storeId }),
          );
    if (membership === null) throw new AppError("NOT_A_MEMBER");
    if (membership.role === "clerk" && clerkBarred) throw new AppError("ROLE_FORBIDDEN");
    c.set(
      "identity",
      createIdentityContext({
        actor: {
          type: "merchant",
          id: session.merchantUserId,
          client: "weapp",
          role: membership.role,
        },
        entityId: membership.entityId,
        storeId: membership.storeId,
        requestId: c.get("requestId"),
        ip: c.get("clientIp"),
        userAgent: c.req.header("User-Agent") ?? null,
      }),
    );
    c.set("membership", membership);
    await next();
  };
};

export const merchantCapability: RouteMiddlewareFactory = (route, runtime) => {
  const key = route["x-capability"];
  if (key === undefined || key === null || key === ASSERT_IN_HANDLER) return null;
  const { tenant } = merchantServicesOf(runtime);
  return async (c, next) => {
    const session = c.get("merchantSession");
    if (session === undefined) return next();
    const membership = c.get("membership");
    if (membership !== undefined) {
      assertCapability(standingOf(membership.role, membership.storeMode), key);
    } else {
      const active = await runtime.tx.run((tx) =>
        tenant.activeMembership(tx, session.merchantUserId),
      );
      assertCapability(active?.role === "owner" ? "owner" : "clerk", key);
    }
    return next();
  };
};
