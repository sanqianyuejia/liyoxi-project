// 后台：登录、员工、权限与系统 · pii-reveals（docs/api/a01-system.md）。由 routemap.json 接管（W0-10），之后以本文件为准：
// 改接口同 PR 改 routemap.json 与分组文档，pnpm contract:docs-check 对账。归属的里程碑在 ../milestones.ts。
import { adminRoute } from "../builders.js";
import { errorResponses, okResponse } from "../../common/index.js";
import { z } from "../../zod.js";
export const PII_SUBJECT_FIELDS = {
  merchant_user: ["phone"],
  store_profile: ["contactPhone"],
  service_ticket: ["contactPhone"],
  account_change_request: ["newPhone"],
  staff: ["phone"],
  entity: ["uscc", "legalRepName"],
  qualification_doc: ["certNo", "principalName", "submittedFields", "reviewedFields"],
  invoice_request: ["taxNo", "addrTel", "bankAccount", "recvEmail", "mailTo"],
  refund_txn: ["payeeAccount"],
  finance_config_revision: ["accountNo"],
  agreement_consent: ["phone", "uscc"],
} as const;
export type PiiSubjectType = keyof typeof PII_SUBJECT_FIELDS;
export const PiiRevealBodySchema = z
  .object({
    subjectType: z.enum(Object.keys(PII_SUBJECT_FIELDS) as [PiiSubjectType, ...PiiSubjectType[]]),
    subjectId: z.string().uuid(),
    field: z.enum([
      "phone",
      "contactPhone",
      "newPhone",
      "uscc",
      "legalRepName",
      "certNo",
      "principalName",
      "submittedFields",
      "reviewedFields",
      "taxNo",
      "addrTel",
      "bankAccount",
      "recvEmail",
      "mailTo",
      "payeeAccount",
      "accountNo",
    ]),
    purpose: z.enum(["contact_merchant", "verify_identity", "finance_ops", "other"]),
    note: z.string().trim().max(100).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!(PII_SUBJECT_FIELDS[value.subjectType] as readonly string[]).includes(value.field))
      ctx.addIssue({ code: "custom", path: ["field"], message: "字段与对象类型不匹配" });
    if (value.purpose === "other" && !value.note)
      ctx.addIssue({ code: "custom", path: ["note"], message: "其他用途需要说明" });
  })
  .openapi("PiiRevealBody");
export type PiiRevealBody = z.infer<typeof PiiRevealBodySchema>;
export const PiiRevealResultSchema = z
  .object({
    value: z.union([z.string(), z.record(z.string(), z.unknown()), z.null()]),
    field: z.string(),
    auditLogId: z.string().uuid(),
  })
  .openapi("PiiRevealResult");
export type PiiRevealResult = z.infer<typeof PiiRevealResultSchema>;

export const adminPiiRevealCreate = adminRoute({
  method: "post",
  path: "/admin/pii-reveals",
  operationId: "admin.piiReveal.create",
  summary: "查看字段明文（手机号、信用代码、银行账号等）：先写 access 审计再返回；限频",
  "x-permission": "assert-in-handler",
  "x-idempotent": "none",
  "x-idempotent-reason": "明文查看，结果含明文，不进幂等记录（A51）",
  request: {
    body: { required: true, content: { "application/json": { schema: PiiRevealBodySchema } } },
  },
  responses: {
    ...okResponse(PiiRevealResultSchema),
    ...errorResponses(400, 401, 403, 404, 429, 500),
  },
});
