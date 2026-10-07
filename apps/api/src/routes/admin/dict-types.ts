import { adminDictTypeList, DictTypeListSchema } from "@liyoxi/contract";
import { ok } from "../../http/errors.js";
import { defineAdminHandler } from "../../routing/admin.js";
export const adminDictTypeHandlers = [
  defineAdminHandler(adminDictTypeList, { module: "system", need: "view" }, async (c) =>
    ok(c, DictTypeListSchema.parse(await c.var.runtime.configAdmin.dictTypes())),
  ),
];
