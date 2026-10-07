import { adminCalendarDayList, adminCalendarDayBatchImport } from "@liyoxi/contract";
import { ok } from "../../http/errors.js";
import { idemOf } from "../../http/idempotency.js";
import { defineAdminHandler } from "../../routing/admin.js";
import { configActor, configError } from "./system-config-context.js";
export const adminCalendarDayHandlers = [
  defineAdminHandler(adminCalendarDayList, { module: "system", need: "view" }, async (c) =>
    ok(c, await c.var.runtime.calendarAdmin.list(c.req.valid("query")).catch(configError)),
  ),
  defineAdminHandler(adminCalendarDayBatchImport, null, async (c, staff) =>
    ok(
      c,
      await c.var.runtime.calendarAdmin
        .import(configActor(c, staff), c.req.valid("json"), { idem: idemOf(c) })
        .catch(configError),
    ),
  ),
];
