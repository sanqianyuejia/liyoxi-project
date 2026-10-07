import { assertIssuedScope, entityScope } from "../authz/index.js";
import { implementPiiFields } from "../kernel/index.js";
export const identityPiiFields = [
  implementPiiFields("merchant_user", async (db, query) => {
    const scope = assertIssuedScope(query.scope);
    if (query.field !== "phone") return null;
    const row = await db.merchantUser.findFirst({
      where: {
        id: query.subjectId,
        ...(scope.kind === "all"
          ? {}
          : {
              OR: [
                { entityMembers: { some: { entity: entityScope(scope) } } },
                { entities: { some: entityScope(scope) } },
              ],
            }),
      },
      select: { phoneEnc: true },
    });
    return row ? { enc: row.phoneEnc, entityId: null, storeId: null, label: null } : null;
  }),
  implementPiiFields("account_change_request", async (db, query) => {
    const scope = assertIssuedScope(query.scope);
    if (query.field !== "newPhone") return null;
    const row = await db.accountChangeRequest.findFirst({
      where: {
        id: query.subjectId,
        ...(scope.kind === "all" ? {} : { entity: entityScope(scope) }),
      },
      select: { newPhoneEnc: true, entityId: true },
    });
    return row
      ? { enc: row.newPhoneEnc, entityId: row.entityId, storeId: null, label: null }
      : null;
  }),
];
