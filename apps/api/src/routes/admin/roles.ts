import {
  adminRoleList,
  adminRoleGet,
  adminRoleDefaultsGet,
  adminRoleReplace,
  RoleSummaryListSchema,
} from "@liyoxi/contract";
import { idemOf } from "../../http/idempotency.js";
import { ok } from "../../http/errors.js";
import { defineAdminHandler } from "../../routing/admin.js";
import { staffManagementOf } from "./staff.js";

export const adminRoleHandlers = [
  defineAdminHandler(adminRoleList, { module: "system", need: "view" }, async (c, current) => {
    c.header("Cache-Control", "no-store");
    return ok(
      c,
      RoleSummaryListSchema.parse(await staffManagementOf(c.var.runtime).roles(current.ctx)),
    );
  }),
  defineAdminHandler(adminRoleGet, { module: "system", need: "view" }, async (c, me) => {
    c.header("Cache-Control", "no-store");
    return ok(c, await c.var.runtime.staffRoles.get(me.ctx, c.req.valid("param").roleKey));
  }),
  defineAdminHandler(adminRoleDefaultsGet, { module: "system", need: "view" }, async (c, me) => {
    c.header("Cache-Control", "no-store");
    return ok(c, c.var.runtime.staffRoles.defaults(me.ctx, c.req.valid("param").roleKey));
  }),
  defineAdminHandler(adminRoleReplace, null, async (c, me) => {
    c.header("Cache-Control", "no-store");
    return ok(
      c,
      await c.var.runtime.staffRoles.replace(
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
        c.req.valid("param").roleKey,
        c.req.valid("json"),
        { idem: idemOf(c) },
      ),
    );
  }),
];
