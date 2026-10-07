import { assertIssuedScope, entityScope, storeScope } from "../authz/index.js";
import { implementPiiFields } from "../kernel/index.js";
export const profilePiiFields = [
  implementPiiFields("store_profile", async (db, query) => {
    const scope = assertIssuedScope(query.scope);
    if (query.field !== "contactPhone") return null;
    const row = await db.storeProfile.findFirst({
      where: { storeId: query.subjectId, store: storeScope(scope) },
      select: { contactPhoneEnc: true, entityId: true, storeId: true },
    });
    return row
      ? { enc: row.contactPhoneEnc, entityId: row.entityId, storeId: row.storeId, label: null }
      : null;
  }),
  implementPiiFields("entity", async (db, query) => {
    const scope = assertIssuedScope(query.scope);
    if (!["uscc", "legalRepName"].includes(query.field)) return null;
    const row = await db.entity.findFirst({
      where: { id: query.subjectId, ...entityScope(scope) },
      select: { id: true, usccEnc: true, legalRepNameEnc: true, name: true },
    });
    return row
      ? {
          enc: query.field === "uscc" ? row.usccEnc : row.legalRepNameEnc,
          entityId: row.id,
          storeId: null,
          label: row.name,
        }
      : null;
  }),
  implementPiiFields("qualification_doc", async (db, query) => {
    const scope = assertIssuedScope(query.scope);
    const fields = {
      certNo: "certNoEnc",
      principalName: "principalNameEnc",
      submittedFields: "submittedFieldsEnc",
      reviewedFields: "reviewedFieldsEnc",
    } as const;
    if (!Object.hasOwn(fields, query.field)) return null;
    const row = await db.qualificationDoc.findFirst({
      where: {
        id: query.subjectId,
        ...(scope.kind === "all"
          ? {}
          : {
              OR: [
                { scope: "store", store: storeScope(scope) },
                { scope: "entity", entity: entityScope(scope) },
              ],
            }),
      },
      select: {
        certNoEnc: true,
        principalNameEnc: true,
        submittedFieldsEnc: true,
        reviewedFieldsEnc: true,
        entityId: true,
        storeId: true,
        holderName: true,
      },
    });
    return row
      ? {
          enc: row[fields[query.field as keyof typeof fields]],
          entityId: row.entityId,
          storeId: row.storeId,
          label: row.holderName,
        }
      : null;
  }),
];
