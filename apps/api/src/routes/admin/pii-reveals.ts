import { adminPiiRevealCreate } from "@liyoxi/contract";
import { ok } from "../../http/errors.js";
import { defineAdminHandler } from "../../routing/admin.js";
export const adminPiiRevealHandlers = [
  defineAdminHandler(adminPiiRevealCreate, null, async (c, me) => {
    c.header("Cache-Control", "no-store");
    return ok(
      c,
      await c.var.runtime.piiReveal.reveal(
        me.ctx,
        c.var.identity!.actor,
        {
          requestId: c.var.identity!.requestId,
          ip: c.var.identity!.ip,
          userAgent: c.var.identity!.userAgent,
          sessionId: me.principal.session.id,
          authMethod: me.principal.session.authMethod as "password+totp" | "password+recovery",
          actorName: me.principal.staff.name,
          actorRole: me.principal.role.name,
        },
        c.req.valid("json"),
      ),
    );
  }),
];
