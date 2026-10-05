// 商家端：账号与登录 · agreement-versions（docs/api/m01-account.md）。由 routemap.json 接管（W0-10），之后以本文件为准：
// 改接口同 PR 改 routemap.json 与分组文档，pnpm contract:docs-check 对账。归属的里程碑在 ../milestones.ts。
import { errorResponses, okResponse } from "../../common/index.js";
import { merchantRoute } from "../builders.js";

import { AgreementVersionDetailSchema, AgreementVersionParamsSchema } from "./agreement.schemas.js";

export const mAgreementVersionGet = merchantRoute({
  method: "get",
  path: "/m/agreement-versions/{agreementVersionId}",
  operationId: "m.agreementVersion.get",
  summary: "某一协议版本的正文（展示版）与 PDF 文件地址",
  "x-auth": "public",
  "x-clerk-view": "same",
  "x-idempotent-reason": "纯查询，GET 不写库（A18、A19）",
  request: { params: AgreementVersionParamsSchema },
  responses: { ...okResponse(AgreementVersionDetailSchema), ...errorResponses(400, 404) },
});
