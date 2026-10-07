import { assertIssuedScope, entityScope } from "../authz/index.js";
import { implementPiiFields } from "../kernel/index.js";
export const docsPiiFields = implementPiiFields("agreement_consent", async (db, query) => {
  const scope = assertIssuedScope(query.scope);
  if (!["phone", "uscc"].includes(query.field)) return null;
  const row = await db.agreementConsent.findFirst({
    where: { id: query.subjectId, ...(scope.kind === "all" ? {} : { entity: entityScope(scope) }) },
    select: { phoneEnc: true, usccEnc: true, entityId: true, storeId: true, seq: true },
  });
  return row
    ? {
        enc: query.field === "phone" ? row.phoneEnc : row.usccEnc,
        entityId: row.entityId,
        storeId: row.storeId,
        label: String(row.seq),
      }
    : null;
});
