// 后台：登录、员工、权限与系统 · feature-flags（docs/api/a01-system.md）。由 routemap.json 接管（W0-10），之后以本文件为准：
// 改接口同 PR 改 routemap.json 与分组文档，pnpm contract:docs-check 对账。归属的里程碑在 ../milestones.ts。

export const adminFeatureFlagList = adminRoute({
  method: "get",
  path: "/admin/feature-flags",
  operationId: "admin.featureFlag.list",
  summary: "特性开关列表：键、说明、默认值、规则（平台、版本、环境、主体白名单）",
  "x-permission": "sys.super_admin",
  "x-idempotent-reason": "纯查询（GET 不写库，A19）",
  responses: {
    ...okResponse(FeatureFlagListSchema),
    ...errorResponses(400, 401, 403, 404, 409, 429, 503),
  },
});

export const adminFeatureFlagUpdate = adminRoute({
  method: "patch",
  path: "/admin/feature-flags/{flagKey}",
  operationId: "admin.featureFlag.update",
  summary: "修改开关的默认值或规则（写审计，触发即时播报）",
  "x-permission": "sys.super_admin",
  "x-idempotent": "required",
  responses: {
    ...okResponse(FeatureFlagViewSchema),
    ...errorResponses(400, 401, 403, 404, 409, 429, 503),
  },
  request: {
    body: {
      content: { "application/json": { schema: FeatureFlagUpdateBodySchema } },
      required: true,
    },
    params: z.object({ flagKey: z.string().min(1) }),
  },
});

import { adminRoute } from "../builders.js";
import { okResponse, errorResponses } from "../../common/index.js";
import { z } from "../../zod.js";

export {
  FeatureFlagListSchema,
  FeatureFlagUpdateBodySchema,
  FeatureFlagViewSchema,
} from "./system-config.schemas.js";
import {
  FeatureFlagListSchema,
  FeatureFlagUpdateBodySchema,
  FeatureFlagViewSchema,
} from "./system-config.schemas.js";
