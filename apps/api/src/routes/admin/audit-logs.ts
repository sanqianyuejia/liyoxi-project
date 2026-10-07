import { adminAuditLogGet, adminAuditLogList } from "@liyoxi/contract";
import { ok } from "../../http/errors.js";
import { defineAdminHandler } from "../../routing/admin.js";
export const adminAuditLogHandlers = [
  defineAdminHandler(adminAuditLogList, null, async (c, me) => {
    c.header("Cache-Control", "no-store");
    return ok(c, await c.var.runtime.auditRead.list(me.ctx, c.req.valid("query")));
  }),
  defineAdminHandler(adminAuditLogGet, null, async (c, me) => {
    c.header("Cache-Control", "no-store");
    return ok(c, await c.var.runtime.auditRead.get(me.ctx, c.req.valid("param").auditLogId));
  }),
];
