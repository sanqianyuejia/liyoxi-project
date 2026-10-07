import {
  adminParamValueList,
  adminParamValueReplace,
  adminParamValueWithdraw,
} from "@liyoxi/contract";
import { ok } from "../../http/errors.js";
import { idemOf } from "../../http/idempotency.js";
import { defineAdminHandler } from "../../routing/admin.js";
import { configActor, configError } from "./system-config-context.js";
export const adminParamValueHandlers = [
  defineAdminHandler(adminParamValueList, { module: "system", need: "view" }, async (c) => {
    c.header("Cache-Control", "no-store");
    return ok(c, await c.var.runtime.configAdmin.params(c.req.valid("query")).catch(configError));
  }),
  defineAdminHandler(adminParamValueReplace, null, async (c, staff) =>
    ok(
      c,
      await c.var.runtime.configAdmin
        .replaceParams(configActor(c, staff), c.req.valid("json"), { idem: idemOf(c) })
        .catch(configError),
    ),
  ),
  defineAdminHandler(adminParamValueWithdraw, null, async (c, staff) =>
    ok(
      c,
      await c.var.runtime.configAdmin
        .withdrawParam(
          configActor(c, staff),
          c.req.valid("param").paramValueId,
          c.req.valid("json").reason,
          { idem: idemOf(c) },
        )
        .catch(configError),
    ),
  ),
];
