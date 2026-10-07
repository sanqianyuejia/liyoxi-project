// 后台：登录、员工、权限与系统 · audit-logs（docs/api/a01-system.md）。由 routemap.json 接管（W0-10），之后以本文件为准：
// 改接口同 PR 改 routemap.json 与分组文档，pnpm contract:docs-check 对账。归属的里程碑在 ../milestones.ts。
import { adminRoute } from "../builders.js";
import { errorResponses, okResponse } from "../../common/index.js";
import { AdminCursorQuerySchema, adminCursorPage } from "./structures.js";
import { z } from "../../zod.js";
export const AuditLogListQuerySchema = AdminCursorQuerySchema.extend({
  stream: z.enum(["ops", "access"]).default("ops"),
  category: z.string().min(1).max(500).optional(),
  actorType: z.enum(["staff", "merchant", "system"]).optional(),
  actorId: z.string().uuid().optional(),
  targetType: z.string().min(1).max(100).optional(),
  targetId: z.string().uuid().optional(),
  targetKey: z.string().max(200).optional(),
  entityId: z.string().uuid().optional(),
  storeId: z.string().uuid().optional(),
  q: z.string().max(200).optional(),
  createdFrom: z.iso.date().optional(),
  createdTo: z.iso.date().optional(),
})
  .superRefine((value, ctx) => {
    if (value.targetId && value.targetKey)
      ctx.addIssue({ code: "custom", message: "对象id与key不能同时提供" });
    if (value.createdFrom && value.createdTo && value.createdFrom > value.createdTo)
      ctx.addIssue({ code: "custom", message: "日期起止不合法" });
  })
  .openapi("AuditLogListQuery");
export type AuditLogListQuery = z.infer<typeof AuditLogListQuerySchema>;
export const AuditLogItemSchema = z
  .object({
    auditLogId: z.string().uuid(),
    logNo: z.string(),
    createdAt: z.string().datetime(),
    stream: z.enum(["ops", "activity", "access"]),
    category: z.string(),
    action: z.string(),
    summary: z.string(),
    actor: z.object({
      actorType: z.string(),
      actorId: z.string().uuid().nullable(),
      name: z.string(),
      role: z.string(),
      client: z.string().nullable(),
    }),
    target: z
      .object({
        type: z.string(),
        id: z.string().uuid().nullable(),
        key: z.string().nullable(),
        label: z.string().nullable(),
      })
      .nullable(),
    entityId: z.string().uuid().nullable(),
    storeId: z.string().uuid().nullable(),
  })
  .openapi("AuditLogItem");
export type AuditLogItem = z.infer<typeof AuditLogItemSchema>;
const json = z.record(z.string(), z.unknown()).nullable();
export const AuditLogDetailSchema = AuditLogItemSchema.extend({
  reason: z.object({ code: z.string(), text: z.string().nullable() }).nullable(),
  before: json,
  after: json,
  meta: json,
  authMethod: z.string().nullable(),
  ipMask: z.string().nullable(),
  requestId: z.string().nullable(),
  jobName: z.string().nullable(),
  onBehalfOfEntityId: z.string().uuid().nullable(),
  link: z
    .object({ route: z.string(), params: z.record(z.string(), z.string()), label: z.string() })
    .nullable(),
}).openapi("AuditLogDetail");
export type AuditLogDetail = z.infer<typeof AuditLogDetailSchema>;
export const AuditLogPageSchema = adminCursorPage(AuditLogItemSchema).openapi("AuditLogPage");

export const adminAuditLogList = adminRoute({
  method: "get",
  path: "/admin/audit-logs",
  operationId: "admin.auditLog.list",
  summary: "操作日志列表：时间范围、类型、操作人（含“系统”），游标分页",
  "x-permission": "assert-in-handler",
  "x-idempotent-reason": "纯查询（GET 不写库，A19）",
  request: { query: AuditLogListQuerySchema },
  responses: { ...okResponse(AuditLogPageSchema), ...errorResponses(400, 401, 403, 429) },
});

export const adminAuditLogGet = adminRoute({
  method: "get",
  path: "/admin/audit-logs/{auditLogId}",
  operationId: "admin.auditLog.get",
  summary: "操作日志详情：键值、变更前后、登录方式、来源 IP（脱敏）、关联页面",
  "x-permission": "assert-in-handler",
  "x-idempotent-reason": "纯查询（GET 不写库，A19）",
  request: { params: z.object({ auditLogId: z.string().uuid() }) },
  responses: { ...okResponse(AuditLogDetailSchema), ...errorResponses(401, 403, 404, 429) },
});
