import { adminDictItemCreate, adminDictItemUpdate } from "@liyoxi/contract";
import { ok } from "../../http/errors.js";
import { idemOf } from "../../http/idempotency.js";
import { defineAdminHandler } from "../../routing/admin.js";
import { configActor, configError } from "./system-config-context.js";
export const adminDictItemHandlers = [
  defineAdminHandler(adminDictItemCreate, null, async (c, staff) =>
    ok(
      c,
      await c.var.runtime.configAdmin
        .createDictItem(configActor(c, staff), c.req.valid("json"), { idem: idemOf(c) })
        .catch(configError),
    ),
  ),
  defineAdminHandler(adminDictItemUpdate, null, async (c, staff) =>
    ok(
      c,
      await c.var.runtime.configAdmin
        .updateDictItem(
          configActor(c, staff),
          c.req.valid("param").dictItemId,
          c.req.valid("json"),
          { idem: idemOf(c) },
        )
        .catch(configError),
    ),
  ),
];
