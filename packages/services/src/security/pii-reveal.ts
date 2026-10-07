// W2-04 专用明文查看：先判权和合法范围，独立提交 access 审计后才解密。
import { PiiRevealBodySchema } from "@liyoxi/contract";
import type { PiiRevealBody, PiiRevealResult, PermissionKey } from "@liyoxi/contract";
import { assertAccess, assertPermission, hasPermission } from "../authz/index.js";
import type { StaffContext } from "../authz/index.js";
import { record } from "../audit/index.js";
import type { AuditRequestMeta } from "../audit/index.js";
import { AppError, isInTransaction, KernelViolation } from "../kernel/index.js";
import type {
  Actor,
  Clock,
  TxRunner,
  PiiFactDb,
  PiiFieldProvider,
  Alerts,
} from "../kernel/index.js";
import type { Keyring } from "./keyring.js";
import { openField } from "./pii.js";
import type { SensitiveColumn } from "./crypto.js";
export interface PiiRevealDeps {
  db: PiiFactDb;
  tx: TxRunner;
  clock: Clock;
  keyring: () => Keyring;
  facts: { read: PiiFieldProvider };
  alerts: Alerts;
  audit?: typeof record;
  open?: (keyring: Keyring, column: SensitiveColumn, enc: string) => string | Promise<string>;
}
const COLUMNS = {
  merchant_user: { phone: "phone_enc" },
  store_profile: { contactPhone: "contact_phone_enc" },
  service_ticket: { contactPhone: "contact_phone_enc" },
  account_change_request: { newPhone: "new_phone_enc" },
  staff: { phone: "phone_enc" },
  entity: { uscc: "uscc_enc", legalRepName: "legal_rep_name_enc" },
  qualification_doc: {
    certNo: "cert_no_enc",
    principalName: "principal_name_enc",
    submittedFields: "submitted_fields_enc",
    reviewedFields: "reviewed_fields_enc",
  },
  invoice_request: {
    taxNo: "tax_no_enc",
    addrTel: "addr_tel_enc",
    bankAccount: "bank_account_enc",
    recvEmail: "recv_email_enc",
    mailTo: "mail_to_enc",
  },
  refund_txn: { payeeAccount: "payee_account_enc" },
  finance_config_revision: { accountNo: "account_no_enc" },
  agreement_consent: { phone: "phone_enc", uscc: "uscc_enc" },
} as const;
export function createPiiReveal(deps: PiiRevealDeps) {
  return {
    async raiseLimit(staffId: string, window: string, limit: number): Promise<void> {
      try {
        await deps.alerts.raise({
          rule: "pii.reveal_limit",
          severity: "P2",
          dimension: staffId,
          detail: { window, limit },
        });
      } catch {
        /* 告警失败不得替换既定429 */
      }
    },
    async reveal(
      ctx: StaffContext,
      actor: Actor,
      meta: AuditRequestMeta,
      input: PiiRevealBody,
    ): Promise<PiiRevealResult> {
      if (isInTransaction())
        throw new KernelViolation(
          "nested_transaction",
          "明文查看必须在业务事务外调用，access 审计独立提交",
        );
      if (!PiiRevealBodySchema.safeParse(input).success) throw new AppError("VALIDATION_FAILED");
      let permission: PermissionKey = "pii.phone.reveal";
      if (["entity", "qualification_doc"].includes(input.subjectType))
        permission = "pii.license.view";
      if (["invoice_request", "refund_txn", "finance_config_revision"].includes(input.subjectType))
        permission = "pii.bank.reveal";
      if (input.subjectType === "agreement_consent") permission = "docs.consent.evidence";
      if (input.subjectType === "qualification_doc" && !hasPermission(ctx, permission))
        permission = "merchant.qualification.review";
      assertPermission(ctx, permission, deps.clock.now());
      if (input.subjectType === "staff")
        assertAccess(ctx, { module: { module: "system", need: "view" }, permission: null });
      const fact = await deps.facts.read(deps.db, {
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        field: input.field,
        scope: ctx.scope,
      });
      if (fact === null) throw new AppError("NOT_FOUND");
      const column = (COLUMNS[input.subjectType] as Record<string, string>)[input.field]!;
      const audit = await deps.tx.run((tx) =>
        (deps.audit ?? record)(tx, actor, meta, {
          stream: "access",
          category: "pii_reveal",
          action: `pii.${column.replace(/_enc$/, "")}.reveal`,
          summary: `查看${input.field}字段`,
          target: { type: input.subjectType, id: input.subjectId, label: fact.label },
          ...(fact.entityId !== null
            ? { entityId: fact.entityId, storeId: fact.storeId }
            : { entityId: null, storeId: null }),
          meta: { purpose: input.purpose, note: input.note ?? null },
        }),
      );
      let value: PiiRevealResult["value"] = null;
      if (fact.enc !== null) {
        const plaintext = await (deps.open ?? openField)(
          deps.keyring(),
          (input.subjectType === "agreement_consent"
            ? input.field === "phone"
              ? "merchant_user.phone_enc"
              : "entity.uscc_enc"
            : `${input.subjectType}.${column}`) as SensitiveColumn,
          fact.enc,
        );
        if (["submittedFields", "reviewedFields"].includes(input.field)) {
          let parsed: unknown;
          try {
            parsed = JSON.parse(plaintext);
          } catch {
            // SyntaxError可能包含已解密内容；只抛固定领域错误，不保留原message、stack或cause。
            throw new AppError("INTERNAL");
          }
          if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
            throw new AppError("INTERNAL");
          value = parsed as Record<string, unknown>;
        } else value = plaintext;
      }
      return { value, field: input.field, auditLogId: audit.id };
    },
  };
}
