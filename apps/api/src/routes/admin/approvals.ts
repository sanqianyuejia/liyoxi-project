// 审批读侧与字典下拉（W1-06②）；权限、范围与展示规则均在服务层。
import {
  adminApprovalGet,
  adminApprovalList,
  adminApprovalSummary,
  adminDictItemList,
} from "@liyoxi/contract";
import { authz } from "@liyoxi/services";
import { ok } from "../../http/errors.js";
import { defineAdminHandler } from "../../routing/admin.js";

export const adminApprovalHandlers = [
  defineAdminHandler(adminApprovalList, null, async (c, staff) => {
    const runtime = c.var.runtime;
    const query = c.req.valid("query");
    return ok(c, await runtime.tx.run((tx) => runtime.approval.list(tx, staff.ctx, query)));
  }),
  defineAdminHandler(adminApprovalSummary, null, async (c, staff) => {
    const runtime = c.var.runtime;
    const query = c.req.valid("query");
    return ok(c, await runtime.tx.run((tx) => runtime.approval.summary(tx, staff.ctx, query)));
  }),
  defineAdminHandler(adminApprovalGet, null, async (c, staff) => {
    const runtime = c.var.runtime;
    const { approvalId } = c.req.valid("param");
    return ok(c, await runtime.tx.run((tx) => runtime.approval.get(tx, staff.ctx, approvalId)));
  }),
  defineAdminHandler(adminDictItemList, null, async (c, staff) => {
    const query = c.req.valid("query");
    if (query.includeDisabled || query.withRefCount)
      authz.assertAccess(staff.ctx, {
        module: { module: "system", need: "view" },
        permission: null,
      });

    const result = await c.var.runtime.config.dicts.listForAdmin(query.typeKey, {
      includeDisabled: query.includeDisabled,
      ...(query.parentCode === undefined ? {} : { parentCode: query.parentCode }),
      ...(query.scene === undefined ? {} : { scene: query.scene }),
    });
    if (query.withRefCount) {
      const counts = await c.var.runtime.configAdmin.dictReferences(result.items);
      return ok(c, {
        ...result,
        items: result.items.map((item) => ({
          ...item,
          refCount: counts.get(`${item.typeKey}:${item.code}`) ?? null,
        })),
      });
    }
    return ok(c, result);
  }),
];
