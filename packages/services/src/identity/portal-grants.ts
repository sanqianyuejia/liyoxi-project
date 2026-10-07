// W2-10 PR1：02 分组第 5 节规定的同事务精准吊销，不提供 portal 登录或票据入口。
import type { Tx } from "../kernel/index.js";
import type { MembershipAuthorizations, PortalGrantRevocation } from "../tenant/index.js";

/**
 * 调用方在原事务持有主体及相关成员锁。只撤销尚未撤销的行，包括已过期的行；
 * revokedAt 是唯一重入口径，旧原因、时间和授权归属不覆盖。
 */
export async function revokePortalGrants(tx: Tx, input: PortalGrantRevocation): Promise<number> {
  const { count } = await tx.portalSession.updateMany({
    where: {
      entityId: input.entityId,
      revokedAt: null,
      ...(input.scope === "owner" ? { approvedByUserId: input.merchantUserId } : {}),
    },
    data: {
      revokedAt: input.now,
      revokeReason: "membership_changed",
      updatedAt: input.now,
    },
  });
  return count;
}

export const membershipAuthorizations: MembershipAuthorizations = { revokePortalGrants };
