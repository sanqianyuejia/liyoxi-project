// 商家端：账号与登录 · agreements（docs/api/m01-account.md）。由 routemap.json 接管（W0-10），之后以本文件为准：
// 改接口同 PR 改 routemap.json 与分组文档，pnpm contract:docs-check 对账。归属的里程碑在 ../milestones.ts。
import { errorResponses, okResponse } from "../../common/index.js";
import { merchantRoute } from "../builders.js";

import { AgreementListQuerySchema, AgreementListSchema } from "./agreement.schemas.js";

export const mAgreementList = merchantRoute({
  method: "get",
  path: "/m/agreements",
  operationId: "m.agreement.list",
  summary:
    "当前生效的协议版本清单（?agreementKey= 或 ?scene=）：标题、版本号、生效时间、版本 id；登录前可读",
  "x-auth": "public",
  "x-clerk-view": "same",
  "x-idempotent-reason": "纯查询，GET 不写库（A18、A19）",
  request: { query: AgreementListQuerySchema },
  responses: { ...okResponse(AgreementListSchema), ...errorResponses(400) },
});
