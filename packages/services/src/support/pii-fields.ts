import { assertIssuedScope, taskScope } from "../authz/index.js";
import type { Prisma } from "@liyoxi/db";
import { implementPiiFields } from "../kernel/index.js";
export const supportPiiFields = implementPiiFields("service_ticket", async (db, query) => {
  const scope = assertIssuedScope(query.scope);
  if (query.field !== "contactPhone") return null;
  const row = await db.serviceTicket.findFirst({
    where: {
      id: query.subjectId,
      ...taskScope<Prisma.ServiceTicketWhereInput>(scope, {
        store: (where) => ({ store: where }),
        assignees: [{ col: "ownerStaffId", pool: "service_ticket" }],
      }),
    },
    select: { contactPhoneEnc: true, entityId: true, storeId: true, ticketNo: true },
  });
  return row
    ? {
        enc: row.contactPhoneEnc,
        entityId: row.entityId,
        storeId: row.storeId,
        label: row.ticketNo,
      }
    : null;
});
