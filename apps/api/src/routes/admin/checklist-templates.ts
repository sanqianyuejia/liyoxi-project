import {
  adminChecklistTemplateCreate,
  adminChecklistTemplateActivate,
  adminChecklistTemplateDiscard,
} from "@liyoxi/contract";
import { ok } from "../../http/errors.js";
import { idemOf } from "../../http/idempotency.js";
import { defineAdminHandler } from "../../routing/admin.js";
import { configActor, configError } from "./system-config-context.js";
export const adminChecklistTemplateHandlers = [
  defineAdminHandler(adminChecklistTemplateCreate, null, async (c, staff) =>
    ok(
      c,
      await c.var.runtime.configAdmin
        .createChecklist(configActor(c, staff), c.req.valid("json"), { idem: idemOf(c) })
        .catch(configError),
    ),
  ),
  defineAdminHandler(adminChecklistTemplateActivate, null, async (c, staff) =>
    ok(
      c,
      await c.var.runtime.configAdmin
        .activateChecklist(configActor(c, staff), c.req.valid("param").checklistTemplateId, {
          idem: idemOf(c),
        })
        .catch(configError),
    ),
  ),
  defineAdminHandler(adminChecklistTemplateDiscard, null, async (c, staff) =>
    ok(
      c,
      await c.var.runtime.configAdmin
        .discardChecklist(configActor(c, staff), c.req.valid("param").checklistTemplateId, {
          idem: idemOf(c),
        })
        .catch(configError),
    ),
  ),
];
