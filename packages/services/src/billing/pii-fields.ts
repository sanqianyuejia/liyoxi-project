import { assertIssuedScope, byEntity } from "../authz/index.js";
import { implementPiiFields } from "../kernel/index.js";
export const billingPiiFields = [
  implementPiiFields("invoice_request", async (db, query) => {
    const scope = assertIssuedScope(query.scope);
    const fields = {
      taxNo: "taxNoEnc",
      addrTel: "addrTelEnc",
      bankAccount: "bankAccountEnc",
      recvEmail: "recvEmailEnc",
      mailTo: "mailToEnc",
    } as const;
    if (!Object.hasOwn(fields, query.field)) return null;
    const row = await db.invoiceRequest.findFirst({
      where: { id: query.subjectId, ...byEntity(scope) },
      select: {
        taxNoEnc: true,
        addrTelEnc: true,
        bankAccountEnc: true,
        recvEmailEnc: true,
        mailToEnc: true,
        entityId: true,
        requestNo: true,
      },
    });
    return row
      ? {
          enc: row[fields[query.field as keyof typeof fields]],
          entityId: row.entityId,
          storeId: null,
          label: row.requestNo,
        }
      : null;
  }),
  implementPiiFields("refund_txn", async (db, query) => {
    const scope = assertIssuedScope(query.scope);
    if (query.field !== "payeeAccount") return null;
    const row = await db.refundTxn.findFirst({
      where: { id: query.subjectId, ...byEntity(scope) },
      select: { payeeAccountEnc: true, entityId: true, outRefundNo: true },
    });
    return row
      ? { enc: row.payeeAccountEnc, entityId: row.entityId, storeId: null, label: row.outRefundNo }
      : null;
  }),
  implementPiiFields("finance_config_revision", async (db, query) => {
    const scope = assertIssuedScope(query.scope);
    // 平台配置无主体范围：非全量范围没有合法归属事实，受控404。
    if (query.field !== "accountNo" || scope.kind !== "all") return null;
    const row = await db.financeConfigRevision.findUnique({
      where: { id: query.subjectId },
      select: { accountNoEnc: true, configKey: true },
    });
    return row
      ? { enc: row.accountNoEnc, entityId: null, storeId: null, label: row.configKey }
      : null;
  }),
];
