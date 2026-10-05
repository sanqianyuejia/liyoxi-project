// 给 identity 的两个只读函数（W1-04；m01 第 2.3、2.4、2.7 节；02 分组 第 2.11、2.14 节）：
//   成员关系概要   GET /m/me 与两个登录接口响应里的 memberships（V1.0 至多一条）；
//   首触来源的判定 两个码转大写查登记表，邀请码优先，命中且启用才算。
// 都只读、现算；已有的函数不动。
import type { MembershipBrief, MembershipStore } from "@liyoxi/contract";
import type { SourceType } from "@liyoxi/contract/enums";

import type { Tx } from "../kernel/index.js";
import { selectActiveMembership, selectVisibleStores } from "./repo.js";
import type { TenantReader } from "./repo.js";

/**
 * 账号的有效成员关系概要。没有成员关系、或主体已不是 active（成员关系本来也该已移除）即空数组。
 * 门店：老板是主体名下除草稿删除外的全部（含自己停用的）；店员是 store_member 里的。首店在前，其余按创建时间。
 */
export async function membershipBriefs(
  db: TenantReader,
  now: Date,
  merchantUserId: string,
): Promise<MembershipBrief[]> {
  const membership = await selectActiveMembership(db, merchantUserId);
  if (membership === null) return [];
  const [member, entity] = await Promise.all([
    db.entityMember.findUniqueOrThrow({
      where: { id: membership.memberId },
      select: { createdAt: true },
    }),
    db.entity.findUniqueOrThrow({
      where: { id: membership.entityId },
      select: { id: true, name: true, verificationStatus: true, lifecycle: true },
    }),
  ]);
  if (entity.lifecycle !== "active") return [];
  const rows = await selectVisibleStores(db, membership, now);
  const stores = [...rows]
    .sort(
      (a, b) =>
        Number(b.isPrimary) - Number(a.isPrimary) ||
        a.createdAt.getTime() - b.createdAt.getTime() ||
        a.id.localeCompare(b.id),
    )
    .map((store): MembershipStore => ({
      storeId: store.id,
      name: store.name,
      isPrimary: store.isPrimary,
      lifecycle: store.lifecycle as MembershipStore["lifecycle"],
      qualificationStatus: store.qualificationStatus as MembershipStore["qualificationStatus"],
    }));
  const { lastStoreId } = membership;
  return [
    {
      memberId: membership.memberId,
      role: membership.role,
      memberDisplayName: membership.displayName,
      joinedAt: member.createdAt.toISOString(),
      lastStoreId:
        lastStoreId !== null && stores.some((store) => store.storeId === lastStoreId)
          ? lastStoreId
          : null,
      entity: {
        entityId: entity.id,
        name: entity.name,
        verificationStatus:
          entity.verificationStatus as MembershipBrief["entity"]["verificationStatus"],
      },
      stores,
    },
  ];
}

/** 判定首触来源时命中的登记行 */
export interface ReferralHit {
  readonly referralCodeId: string;
  readonly sourceType: Exclude<SourceType, "organic">;
}

/**
 * 按码查启用的登记行：两个码转大写（登记表统一存大写），邀请码优先，取第一个命中且 status = active 的。
 * 都没命中即 null（来源记 organic）。
 */
export async function findActiveReferralCode(
  db: Pick<Tx, "referralCode">,
  codes: { inviteCode?: string | undefined; channelCode?: string | undefined },
): Promise<ReferralHit | null> {
  for (const raw of [codes.inviteCode, codes.channelCode]) {
    const code = raw?.trim().toUpperCase();
    if (code === undefined || code === "") continue;
    const row = await db.referralCode.findUnique({
      where: { code },
      select: { id: true, sourceType: true, status: true },
    });
    if (row !== null && row.status === "active") {
      return { referralCodeId: row.id, sourceType: row.sourceType as ReferralHit["sourceType"] };
    }
  }
  return null;
}
