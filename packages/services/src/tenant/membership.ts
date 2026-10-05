// 成员关系解析（W1-03；D4 第 5.1 节；m02 第 1 节）：账号能不能进某家门店、以什么角色、是不是收尾上下文。
// 门店上下文中间件（W1-04）每个 member 请求调一次；这里只给事实，403 NOT_A_MEMBER、STORE_ARCHIVED 由中间件回。
import type { MerchantRole } from "@liyoxi/contract/enums";

import { isUuid } from "../kernel/index.js";
import { selectMembershipForStore } from "./repo.js";
import type { TenantReader } from "./repo.js";

export interface StoreMembership {
  readonly memberId: string;
  readonly entityId: string;
  readonly storeId: string;
  readonly role: MerchantRole;
  /** active：正常上下文；archived：老板进了自己停用的门店，只有收尾能力点（恢复、下载页授权、me.*） */
  readonly storeMode: "active" | "archived";
}

/**
 * 解析成员关系；进不去即 null（门店不存在与无权访问不作区分）：
 *   主体不是 active → 无；
 *   老板：本主体启用中的门店 → 正常；自己停用的（by_owner）→ 收尾；草稿删除的、随主体停用的 → 无；
 *   店员：store_member 里有、且门店启用中 → 正常；其余 → 无。
 */
export async function resolveMembership(
  db: TenantReader,
  input: { merchantUserId: string; storeId: string },
): Promise<StoreMembership | null> {
  // 请求头里来的门店 id 不是 UUID：按进不去算，不让它走到库里报类型错
  if (!isUuid(input.storeId) || !isUuid(input.merchantUserId)) return null;
  const row = await selectMembershipForStore(db, input.merchantUserId, input.storeId);
  if (row === null || row.entityLifecycle !== "active") return null;
  const base = { memberId: row.memberId, entityId: row.entityId, storeId: input.storeId };
  if (row.role === "owner") {
    if (row.storeLifecycle === "active") return { ...base, role: "owner", storeMode: "active" };
    return row.archiveReason === "by_owner"
      ? { ...base, role: "owner", storeMode: "archived" }
      : null;
  }
  return row.listed && row.storeLifecycle === "active"
    ? { ...base, role: "clerk", storeMode: "active" }
    : null;
}
