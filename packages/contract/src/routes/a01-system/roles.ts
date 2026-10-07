// 后台：登录、员工、权限与系统 · roles（docs/api/a01-system.md）。由 routemap.json 接管（W0-10），之后以本文件为准：
// 改接口同 PR 改 routemap.json 与分组文档，pnpm contract:docs-check 对账。归属的里程碑在 ../milestones.ts。
import { adminRoute } from "../builders.js";
import { InstantSchema, errorResponses, okResponse, openEnum, orNull } from "../../common/index.js";
import {
  STAFF_ROLE_AVAILABLE_FROM,
  STAFF_ROLE_DATA_SCOPE,
  STAFF_ROLE_KEY,
} from "../../enums/index.js";
import { z } from "../../zod.js";
import { StaffBriefSchema } from "./structures.js";
import { ADMIN_MODULE_KEYS } from "../../authz/index.js";

export const RoleConfigSchema = z
  .object({
    roleKey: z.enum(STAFF_ROLE_KEY.values),
    moduleLevels: z
      .object(
        Object.fromEntries(
          ADMIN_MODULE_KEYS.map((key) => [key, z.enum(["n", "v", "o", "e"])]),
        ) as Record<
          (typeof ADMIN_MODULE_KEYS)[number],
          z.ZodEnum<{ n: "n"; v: "v"; o: "o"; e: "e" }>
        >,
      )
      .strict(),
    actions: z.record(z.string(), z.object({ on: z.boolean(), leadOnly: z.boolean() }).strict()),
    dataScope: z.enum(STAFF_ROLE_DATA_SCOPE.values),
  })
  .strict()
  .openapi("RoleConfig");
export type RoleConfigView = z.infer<typeof RoleConfigSchema>;
export const RoleReplaceBodySchema = RoleConfigSchema.omit({ roleKey: true })
  .extend({ lockVersion: z.int().nonnegative() })
  .openapi("RoleReplaceBody");
export type RoleReplaceBody = z.infer<typeof RoleReplaceBodySchema>;

export const RoleSummarySchema = z
  .object({
    roleKey: openEnum(STAFF_ROLE_KEY.values),
    name: z.string(),
    description: z.string(),
    dataScope: openEnum(STAFF_ROLE_DATA_SCOPE.values),
    isLocked: z.boolean(),
    availableFrom: openEnum(STAFF_ROLE_AVAILABLE_FROM.values),
    members: z.array(StaffBriefSchema),
    memberCount: z.int().nonnegative(),
    updatedAt: InstantSchema,
    updatedBy: orNull(StaffBriefSchema),
  })
  .openapi("RoleSummary");
export type RoleSummary = z.infer<typeof RoleSummarySchema>;
export const RoleSummaryListSchema = z
  .object({ items: z.array(RoleSummarySchema) })
  .openapi("RoleSummaryList");
export const RoleDetailSchema = RoleSummarySchema.extend({
  moduleLevels: RoleConfigSchema.shape.moduleLevels,
  actions: RoleConfigSchema.shape.actions,
  lockVersion: z.int().nonnegative(),
  isDefault: z.boolean(),
}).openapi("RoleDetail");
export type RoleDetail = z.infer<typeof RoleDetailSchema>;
const roleParams = z.object({ roleKey: z.string().min(1).max(64) });

export const adminRoleList = adminRoute({
  method: "get",
  path: "/admin/roles",
  operationId: "admin.role.list",
  summary: "8 个内置角色：名称、职责、成员数、是否锁定、未保存标记由前端维护",
  "x-permission": null,
  "x-idempotent-reason": "纯查询（GET 不写库，A19）",
  responses: { ...okResponse(RoleSummaryListSchema), ...errorResponses(401, 403, 429) },
});

export const adminRoleGet = adminRoute({
  method: "get",
  path: "/admin/roles/{roleKey}",
  operationId: "admin.role.get",
  summary: "角色详情：13 个模块等级、按角色预置的敏感权限点（含“仅主管”）、数据范围",
  "x-permission": null,
  "x-idempotent-reason": "纯查询（GET 不写库，A19）",
  request: { params: roleParams },
  responses: { ...okResponse(RoleDetailSchema), ...errorResponses(401, 403, 404, 429) },
});

export const adminRoleReplace = adminRoute({
  method: "put",
  path: "/admin/roles/{roleKey}",
  operationId: "admin.role.replace",
  summary: "保存角色权限（整体替换，带 lockVersion），员工刷新页面后生效",
  "x-permission": "sys.role.edit",
  "x-idempotent": "required",
  request: {
    params: roleParams,
    body: { required: true, content: { "application/json": { schema: RoleReplaceBodySchema } } },
  },
  responses: { ...okResponse(RoleDetailSchema), ...errorResponses(400, 401, 403, 404, 409, 429) },
});

export const adminRoleDefaultsGet = adminRoute({
  method: "get",
  path: "/admin/roles/{roleKey}/defaults",
  operationId: "admin.role.defaults.get",
  summary: "角色的代码默认配置（“恢复默认”回填用，保存后才生效）",
  "x-permission": null,
  "x-idempotent-reason": "纯查询（GET 不写库，A19）",
  request: { params: roleParams },
  responses: { ...okResponse(RoleConfigSchema), ...errorResponses(401, 403, 404, 429) },
});
