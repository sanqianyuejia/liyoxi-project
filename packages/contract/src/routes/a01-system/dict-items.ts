// 后台：登录、员工、权限与系统 · dict-items（docs/api/a01-system.md）。由 routemap.json 接管（W0-10），之后以本文件为准：
// 改接口同 PR 改 routemap.json 与分组文档，pnpm contract:docs-check 对账。归属的里程碑在 ../milestones.ts。
import { IdSchema, InstantSchema, errorResponses, okResponse } from "../../common/index.js";
import { z } from "../../zod.js";
import { adminRoute } from "../builders.js";
import { ApprovalBooleanQuerySchema } from "./approvals.schemas.js";

export const DictItemViewSchema = z
  .object({
    dictItemId: IdSchema,
    typeKey: z.string(),
    code: z.string(),
    parentCode: z.union([z.string(), z.null()]),
    name: z.string(),
    description: z.union([z.string(), z.null()]),
    isEnabled: z.boolean(),
    tags: z.array(z.string()),
    ext: z.record(z.string(), z.unknown()),
    position: z.int(),
    refCount: z.union([z.int().min(0), z.null()]),
    updatedAt: InstantSchema,
    lockVersion: z.int().min(0),
  })
  .openapi("DictItemView");
export const DictItemListSchema = z
  .object({
    items: z.array(DictItemViewSchema),
    types: z.array(z.object({ typeKey: z.string(), versionNo: z.int() })),
  })
  .openapi("DictItemList");
export const DictItemListQuerySchema = z.object({
  typeKey: z
    .string()
    .refine(
      (value) =>
        value.split(",").length <= 10 &&
        value.split(",").every((key) => /^[a-z][a-z0-9_]*$/.test(key)),
      "类型键须为 1–10 个",
    )
    .transform((value) => [...new Set(value.split(","))]),
  parentCode: z.string().min(1).optional(),
  scene: z.string().min(1).optional(),
  includeDisabled: ApprovalBooleanQuerySchema.optional().default(false),
  withRefCount: ApprovalBooleanQuerySchema.optional().default(false),
});
export const adminDictItemList = adminRoute({
  method: "get",
  path: "/admin/dict-items",
  operationId: "admin.dictItem.list",
  summary: "字典项：按类型查询（树形，可带引用计数）；后台各处下拉与原因单选共用",
  request: { query: DictItemListQuerySchema },
  responses: { ...okResponse(DictItemListSchema), ...errorResponses(400, 401, 403, 404) },
  "x-permission": "assert-in-handler",
  "x-idempotent-reason": "纯查询（GET 不写库，A19）",
});

export const adminDictItemCreate = adminRoute({
  method: "post",
  path: "/admin/dict-items",
  operationId: "admin.dictItem.create",
  summary: "新增字典项（编码由系统按顺序生成，保存后不可改；同级不重名）",
  "x-permission": "sys.dict.edit",
  "x-idempotent": "required",
  responses: {
    ...okResponse(DictItemViewSchema),
    ...errorResponses(400, 401, 403, 404, 409, 429, 503),
  },
  request: {
    body: { content: { "application/json": { schema: DictItemCreateBodySchema } }, required: true },
  },
});

export const adminDictItemUpdate = adminRoute({
  method: "patch",
  path: "/admin/dict-items/{dictItemId}",
  operationId: "admin.dictItem.update",
  summary: "修改字典项名称、说明，或启用 / 停用",
  "x-permission": "sys.dict.edit",
  "x-idempotent": "required",
  responses: {
    ...okResponse(DictItemViewSchema),
    ...errorResponses(400, 401, 403, 404, 409, 429, 503),
  },
  request: {
    body: { content: { "application/json": { schema: DictItemUpdateBodySchema } }, required: true },
    params: z.object({ dictItemId: IdSchema }),
  },
});

export { DictItemCreateBodySchema, DictItemUpdateBodySchema } from "./system-config.schemas.js";
import { DictItemCreateBodySchema, DictItemUpdateBodySchema } from "./system-config.schemas.js";
