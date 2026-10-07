import { adminFeatureFlagList, adminFeatureFlagUpdate } from "@liyoxi/contract";
import { ok } from "../../http/errors.js";
import { idemOf } from "../../http/idempotency.js";
import { defineAdminHandler } from "../../routing/admin.js";
import { configActor, configError } from "./system-config-context.js";
export const adminFeatureFlagHandlers = [
  defineAdminHandler(adminFeatureFlagList, null, async (c) => {
    c.header("Cache-Control", "no-store");
    return ok(c, await c.var.runtime.configAdmin.flags().catch(configError));
  }),
  defineAdminHandler(adminFeatureFlagUpdate, null, async (c, staff) =>
    ok(
      c,
      await c.var.runtime.configAdmin
        .updateFlag(configActor(c, staff), c.req.valid("param").flagKey, c.req.valid("json"), {
          idem: idemOf(c),
        })
        .catch(configError),
    ),
  ),
];
