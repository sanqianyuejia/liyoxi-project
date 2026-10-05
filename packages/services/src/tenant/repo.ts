// tenant 的仓储（W1-03）：本模块的查询只写在这里。依据：02 分组 第 2.9–2.12 节；D4 第 5.1 节；m02 第 2.1、2.3 节。
// 读 merchant_user 的几列（来源、称呼）是只读查表，不 import identity（docs/plan/tasks/README.md 第 7.5 节末条）。
import type { MerchantRole } from "@liyoxi/contract/enums";

import type { Tx } from "../kernel/index.js";

/** 只读的库句柄：事务句柄与 Prisma 客户端都合 */
export type TenantReader = Pick<
  Tx,
  "$queryRaw" | "entity" | "store" | "entityMember" | "storeMember" | "invitation" | "merchantUser"
>;

/** 一个账号此刻的有效成员关系（V1.0 至多一条，uq_entity_member_one_entity） */
export interface ActiveMembership {
  readonly memberId: string;
  readonly entityId: string;
  readonly role: MerchantRole;
  readonly lastStoreId: string | null;
  readonly displayName: string | null;
}

export async function selectActiveMembership(
  db: TenantReader,
  merchantUserId: string,
): Promise<ActiveMembership | null> {
  const row = await db.entityMember.findFirst({
    where: { merchantUserId, status: "active" },
    select: { id: true, entityId: true, role: true, lastStoreId: true, displayName: true },
  });
  if (row === null) return null;
  return {
    memberId: row.id,
    entityId: row.entityId,
    role: row.role as MerchantRole,
    lastStoreId: row.lastStoreId,
    displayName: row.displayName,
  };
}

export interface MembershipRow {
  readonly memberId: string;
  readonly entityId: string;
  readonly role: string;
  readonly storeLifecycle: string;
  readonly archiveReason: string | null;
  readonly entityLifecycle: string;
  /** 店员在 store_member 里有没有这家门店 */
  readonly listed: boolean;
}

/** D4 第 5.1 节的那条查询：账号在某家门店所属主体里的有效成员关系；没有即空 */
export async function selectMembershipForStore(
  db: TenantReader,
  merchantUserId: string,
  storeId: string,
): Promise<MembershipRow | null> {
  const rows = await db.$queryRaw<MembershipRow[]>`
    SELECT em.id::text AS "memberId", em.entity_id::text AS "entityId", em.role,
           st.lifecycle AS "storeLifecycle", st.archive_reason AS "archiveReason",
           e.lifecycle AS "entityLifecycle", (sm.store_id IS NOT NULL) AS listed
      FROM store st
      JOIN entity e ON e.id = st.entity_id
      JOIN entity_member em ON em.entity_id = st.entity_id
                           AND em.merchant_user_id = ${merchantUserId}::uuid AND em.status = 'active'
      LEFT JOIN store_member sm ON sm.entity_member_id = em.id AND sm.store_id = st.id
     WHERE st.id = ${storeId}::uuid`;
  return rows[0] ?? null;
}

/** 老板建议进入的门店：上次选择的（没被草稿删除），没有则首家门店 */
export async function selectEntryStoreId(
  db: TenantReader,
  entityId: string,
  lastStoreId: string | null,
): Promise<string | null> {
  if (lastStoreId !== null) {
    const last = await db.store.findFirst({
      where: { id: lastStoreId, entityId, NOT: { archiveReason: "draft_deleted" } },
      select: { id: true },
    });
    if (last !== null) return last.id;
  }
  const primary = await db.store.findFirst({
    where: { entityId, isPrimary: true },
    select: { id: true },
  });
  return primary?.id ?? null;
}

/** 店员所在的门店里取一家的名称（ALREADY_IN_ENTITY 的 details 用）：按加入门店的先后取第一家 */
export async function selectClerkStoreName(
  db: TenantReader,
  memberId: string,
): Promise<string | null> {
  const row = await db.storeMember.findFirst({
    where: { entityMemberId: memberId },
    orderBy: { createdAt: "asc" },
    select: { store: { select: { name: true } } },
  });
  return row?.store.name ?? null;
}

export interface UsageCounts {
  /** 启用中的门店数（草稿门店也算；已停用的不算） */
  readonly storesUsed: number;
  /** 有效店员数（老板不占名额） */
  readonly clerks: number;
  /** 待接受且未过期的邀请数 */
  readonly pendingInvitations: number;
}

/** 额度用量的三个现数（m02 第 2.1 节）：不落库，读时现算 */
export async function selectUsageCounts(
  db: TenantReader,
  entityId: string,
  now: Date,
): Promise<UsageCounts> {
  const [row] = await db.$queryRaw<UsageCounts[]>`
    SELECT
      (SELECT count(*)::int FROM store
        WHERE entity_id = ${entityId}::uuid AND lifecycle = 'active') AS "storesUsed",
      (SELECT count(*)::int FROM entity_member
        WHERE entity_id = ${entityId}::uuid AND status = 'active' AND role = 'clerk') AS clerks,
      (SELECT count(*)::int FROM invitation
        WHERE entity_id = ${entityId}::uuid AND status = 'pending' AND expires_at > ${now})
        AS "pendingInvitations"`;
  return row ?? { storesUsed: 0, clerks: 0, pendingInvitations: 0 };
}

export interface StoreRow {
  readonly id: string;
  readonly name: string | null;
  readonly isPrimary: boolean;
  readonly lifecycle: string;
  readonly archiveReason: string | null;
  readonly archivedAt: Date | null;
  readonly qualificationStatus: string;
  readonly createdAt: Date;
  readonly clerkCount: number;
  readonly pendingInvitationCount: number;
}

/**
 * 观察者可见的门店，连同两个按门店的现数。老板：本主体除草稿删除外的全部门店；店员：本人 store_member 所列门店。
 * 次序：启用中的在前（首家门店最前，其余按创建时间），已停用的在后（按停用时间倒序）。
 */
export async function selectVisibleStores(
  db: TenantReader,
  membership: Pick<ActiveMembership, "memberId" | "entityId" | "role">,
  now: Date,
): Promise<StoreRow[]> {
  const clerkMemberId = membership.role === "clerk" ? membership.memberId : null;
  return db.$queryRaw<StoreRow[]>`
    SELECT st.id::text AS id, st.name, st.is_primary AS "isPrimary", st.lifecycle,
           st.archive_reason AS "archiveReason", st.archived_at AS "archivedAt",
           st.qualification_status AS "qualificationStatus", st.created_at AS "createdAt",
           (SELECT count(*)::int FROM store_member sm WHERE sm.store_id = st.id) AS "clerkCount",
           (SELECT count(*)::int FROM invitation i
             WHERE i.store_id = st.id AND i.status = 'pending' AND i.expires_at > ${now})
             AS "pendingInvitationCount"
      FROM store st
     WHERE st.entity_id = ${membership.entityId}::uuid
       AND st.archive_reason IS DISTINCT FROM 'draft_deleted'
       AND (${clerkMemberId}::uuid IS NULL OR EXISTS (
             SELECT 1 FROM store_member mine
              WHERE mine.store_id = st.id AND mine.entity_member_id = ${clerkMemberId}::uuid))
     ORDER BY (st.lifecycle = 'active') DESC,
              CASE WHEN st.lifecycle = 'active' THEN st.is_primary END DESC,
              CASE WHEN st.lifecycle = 'active' THEN st.created_at END ASC,
              st.archived_at DESC, st.id`;
}

export interface MemberPreviewRow {
  /** 老板隐含全部门店：storeId 为空 */
  readonly storeId: string | null;
  readonly role: string;
  readonly displayName: string | null;
}

/** 头像组的原料：本主体的老板，与各门店的店员（按加入该门店的先后）。称呼为空取账号称呼 */
export async function selectMemberPreviews(
  db: TenantReader,
  entityId: string,
): Promise<MemberPreviewRow[]> {
  return db.$queryRaw<MemberPreviewRow[]>`
    SELECT NULL::text AS "storeId", em.role,
           coalesce(em.display_name, mu.display_name) AS "displayName"
      FROM entity_member em
      JOIN merchant_user mu ON mu.id = em.merchant_user_id
     WHERE em.entity_id = ${entityId}::uuid AND em.status = 'active' AND em.role = 'owner'
    UNION ALL
    SELECT clerk."storeId", clerk.role, clerk."displayName" FROM (
      SELECT sm.store_id::text AS "storeId", em.role,
             coalesce(em.display_name, mu.display_name) AS "displayName"
        FROM store_member sm
        JOIN entity_member em ON em.id = sm.entity_member_id AND em.status = 'active'
        JOIN merchant_user mu ON mu.id = em.merchant_user_id
       WHERE sm.entity_id = ${entityId}::uuid
       ORDER BY sm.created_at, sm.entity_member_id
    ) clerk`;
}

/** 一条链上最近一次进入 pending 之前的状态（资质撤回要回到它）；没有历史即空 */
export async function selectStateBeforePending(
  db: Pick<Tx, "$queryRaw">,
  machine: "store" | "entity",
  stateField: string,
  subjectId: string,
): Promise<string | null> {
  const rows = await db.$queryRaw<{ fromState: string | null }[]>`
    SELECT from_state AS "fromState" FROM status_transition
     WHERE machine = ${machine} AND subject_id = ${subjectId}::uuid
       AND state_field = ${stateField} AND to_state = 'pending'
     ORDER BY seq DESC LIMIT 1`;
  return rows[0]?.fromState ?? null;
}
