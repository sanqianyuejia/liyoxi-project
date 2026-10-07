import { assertIssuedScope, scopeCovers } from "../authz/index.js";
import { implementPiiFields } from "../kernel/index.js";
export const staffPiiFields = implementPiiFields("staff", async (db, query) => {
  const scope = assertIssuedScope(query.scope);
  if (query.field !== "phone" || !scopeCovers(scope, query.subjectId)) return null;
  const row = await db.staff.findUnique({
    where: { id: query.subjectId },
    select: { phoneEnc: true, name: true },
  });
  return row ? { enc: row.phoneEnc, entityId: null, storeId: null, label: row.name } : null;
});
