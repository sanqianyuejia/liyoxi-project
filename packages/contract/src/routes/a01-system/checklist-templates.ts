// 后台：登录、员工、权限与系统 · checklist-templates（docs/api/a01-system.md）。由 routemap.json 接管（W0-10），之后以本文件为准：
// 改接口同 PR 改 routemap.json 与分组文档，pnpm contract:docs-check 对账。归属的里程碑在 ../milestones.ts。

export const adminChecklistTemplateList = adminRoute({
  method: "get",
  path: "/admin/checklist-templates",
  operationId: "admin.checklistTemplate.list",
  summary:
    "清单模板：质检、交付前检查、链接核验、账号核验、巡检、下架核查（按编码取当前启用版本或全部版本）",
  "x-permission": "assert-in-handler",
  "x-idempotent-reason": "纯查询（GET 不写库，A19）",
  request: { query: ChecklistTemplateListQuerySchema },
  responses: {
    ...okResponse(ChecklistTemplateListSchema),
    ...errorResponses(400, 401, 403, 404, 409, 503),
  },
});

export const adminChecklistTemplateCreate = adminRoute({
  method: "post",
  path: "/admin/checklist-templates",
  operationId: "admin.checklistTemplate.create",
  summary: "新建清单模板版本（草稿）",
  "x-permission": "flow.checklist.manage",
  "x-idempotent": "required",
  responses: {
    ...okResponse(ChecklistTemplateViewSchema),
    ...errorResponses(400, 401, 403, 404, 409, 429, 503),
  },
  request: {
    body: {
      content: { "application/json": { schema: ChecklistTemplateCreateBodySchema } },
      required: true,
    },
  },
});

export const adminChecklistTemplateActivate = adminRoute({
  method: "post",
  path: "/admin/checklist-templates/{checklistTemplateId}/activate",
  operationId: "admin.checklistTemplate.activate",
  summary: "启用清单模板版本（同编码旧版本退役）",
  "x-permission": "flow.checklist.manage",
  "x-idempotent": "required",
  responses: {
    ...okResponse(ChecklistTemplateViewSchema),
    ...errorResponses(400, 401, 403, 404, 409, 429, 503),
  },
  request: { params: z.object({ checklistTemplateId: IdSchema }) },
});

export const adminChecklistTemplateDiscard = adminRoute({
  method: "post",
  path: "/admin/checklist-templates/{checklistTemplateId}/discard",
  operationId: "admin.checklistTemplate.discard",
  summary: "放弃清单模板草稿",
  "x-permission": "flow.checklist.manage",
  "x-idempotent": "required",
  responses: {
    ...okResponse(ChecklistTemplateViewSchema),
    ...errorResponses(400, 401, 403, 404, 409, 429, 503),
  },
  request: { params: z.object({ checklistTemplateId: IdSchema }) },
});

import { adminRoute } from "../builders.js";
import { okResponse, errorResponses } from "../../common/index.js";
import {
  ChecklistTemplateListQuerySchema,
  ChecklistTemplateListSchema,
} from "./checklist.schemas.js";
import { IdSchema } from "../../common/index.js";
import { z } from "../../zod.js";
import { ChecklistTemplateViewSchema } from "./checklist.schemas.js";

export { ChecklistTemplateCreateBodySchema } from "./system-config.schemas.js";
import { ChecklistTemplateCreateBodySchema } from "./system-config.schemas.js";
