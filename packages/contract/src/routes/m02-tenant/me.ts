// 商家端：主体、门店与成员 · me（docs/api/m02-tenant.md）。由 routemap.json 接管（W0-10），之后以本文件为准：
// 改接口同 PR 改 routemap.json 与分组文档，pnpm contract:docs-check 对账。归属的里程碑在 ../milestones.ts。
import { errorResponses, okResponse } from "../../common/index.js";
import { merchantRoute } from "../builders.js";
import { merchantMeta } from "../meta-only.js";

import { CurrentStoreBodySchema, CurrentStoreSchema } from "./tenant.schemas.js";

export const mMeCurrentStoreReplace = merchantRoute({
  method: "put",
  path: "/m/me/current-store",
  operationId: "m.me.currentStore.replace",
  summary: "记住当前门店（写 entity_member.last_store_id，供下次启动恢复）",
  "x-capability": "me.*",
  "x-clerk-view": "same",
  "x-idempotent": "required",
  request: {
    body: { required: true, content: { "application/json": { schema: CurrentStoreBodySchema } } },
  },
  responses: { ...okResponse(CurrentStoreSchema), ...errorResponses(400, 401, 403, 404) },
});

export const mMeMembershipLeave = merchantMeta({
  method: "post",
  path: "/m/me/membership/leave",
  operationId: "m.me.membership.leave",
  summary: "店员主动退出所在主体（同移除，原因 self，通知老板）",
  "x-capability": "me.*",
  "x-clerk-view": "same",
  "x-idempotent": "required",
});
