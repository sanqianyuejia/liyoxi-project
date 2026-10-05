// 商家端：主体、门店与成员 · stores（docs/api/m02-tenant.md）。由 routemap.json 接管（W0-10），之后以本文件为准：
// 改接口同 PR 改 routemap.json 与分组文档，pnpm contract:docs-check 对账。归属的里程碑在 ../milestones.ts。
import { errorResponses, okResponse } from "../../common/index.js";
import { merchantRoute } from "../builders.js";
import { merchantMeta } from "../meta-only.js";

import { StoreListSchema } from "./tenant.schemas.js";

export const mStoreList = merchantRoute({
  method: "get",
  path: "/m/stores",
  operationId: "m.store.list",
  summary:
    "我可见的门店：审核状态、完整度、提交与预计完成时间、上线中/交付中/素材/店员计数、待办数；主体额度（门店 n/N、成员名额 n/N，店员不含）；含已停用门店并标注",
  "x-auth": "user",
  "x-clerk-view": "trimmed",
  "x-idempotent-reason": "纯查询，GET 不写库（A18、A19）",
  responses: { ...okResponse(StoreListSchema), ...errorResponses(401) },
});

export const mStoreCreate = merchantMeta({
  method: "post",
  path: "/m/stores",
  operationId: "m.store.create",
  summary:
    "新增门店并按勾选复制档案（基础信息、服务与价格、门店形象、品牌故事素材）；校验主体门店额度",
  "x-capability": "store.create",
  "x-clerk-view": "none",
  "x-idempotent": "required",
});

export const mStoreArchive = merchantMeta({
  method: "post",
  path: "/m/stores/{storeId}/archive",
  operationId: "m.store.archive",
  summary:
    "停用门店：返回阻断项清单（在办订购、未归档工单、制作中广告、审核中的资质与账号）或停用成功",
  "x-capability": "store.archive",
  "x-clerk-view": "none",
  "x-idempotent": "required",
});

export const mStoreDelete = merchantMeta({
  method: "post",
  path: "/m/stores/{storeId}/delete",
  operationId: "m.store.delete",
  summary: "删除草稿门店（从未提交资质且无业务数据、不是最后一家）；不物理删除，置为已停用",
  "x-capability": "store.archive",
  "x-clerk-view": "none",
  "x-idempotent": "required",
});

export const mStoreRestore = merchantMeta({
  method: "post",
  path: "/m/stores/{storeId}/restore",
  operationId: "m.store.restore",
  summary: "恢复老板停用的门店（重新校验门店额度）",
  "x-capability": "store.restore",
  "x-clerk-view": "none",
  "x-idempotent": "required",
});
