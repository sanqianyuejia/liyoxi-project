// 后台：登录、员工、权限与系统 · sessions（docs/api/a01-system.md）。由 routemap.json 接管（W0-10），之后以本文件为准：
// 改接口同 PR 改 routemap.json 与分组文档，pnpm contract:docs-check 对账。归属的里程碑在 ../milestones.ts。
import { errorResponses, okResponse } from "../../common/index.js";
import { z } from "../../zod.js";
import { adminRoute } from "../builders.js";

export const adminSessionCurrentDelete = adminRoute({
  method: "delete",
  path: "/admin/sessions/current",
  operationId: "admin.session.current.delete",
  summary: "退出登录：吊销当前会话（当前会话视图别名，A41）",
  "x-permission": null,
  "x-idempotent": "none",
  "x-idempotent-reason": "退出登录（A43）；重复退出无副作用，端上把 401 当作已退出",
  responses: { ...okResponse(z.null()), ...errorResponses(401, 403, 429) },
});
