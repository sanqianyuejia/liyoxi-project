// 门店列表与“记住当前门店”（W1-03；m02 第 2.2、2.3、3.2、3.7 节）。
// 门店卡里 tenant 自己的字段做全；城市、品类、审核时间、完整度、上线中与交付中、待办数、素材数、当前套餐
// 经事实端口取（kernel/ports/merchant-facts.ts）：对应的模块没注册时是 0 或 null。
// 按观察者角色返回两种形状；接口层最后一道裁剪（respondByRole）在 W1-04。
import type {
  EntityBrief,
  EntityQuotaCard,
  StoreCard,
  StoreCardForClerk,
  StoreList,
} from "@liyoxi/contract";

import { AppError, lockRows } from "../kernel/index.js";
import type { MerchantFactsReader, Tx } from "../kernel/index.js";
import { resolveMembership } from "./membership.js";
import { quotaWithSubscription } from "./quota.js";
import { selectActiveMembership, selectMemberPreviews, selectVisibleStores } from "./repo.js";
import type { MemberPreviewRow, StoreRow } from "./repo.js";

export interface StoreListDeps {
  readonly facts: MerchantFactsReader;
}

/** 头像组至多几个 */
export const MEMBER_PREVIEW_MAX = 4;

const iso = (value: Date | null): string | null => (value === null ? null : value.toISOString());

/** 门店卡的可执行动作：守卫的最终判断在服务端（停用、删除草稿、恢复的接口随 M2） */
function actionsOf(store: StoreRow, activeStores: number): StoreCard["actions"] {
  if (store.lifecycle === "active") {
    if (activeStores <= 1) return [];
    return store.qualificationStatus === "unsubmitted" ? ["archive", "delete"] : ["archive"];
  }
  return store.archiveReason === "by_owner" ? ["restore"] : [];
}

/** 老板在前、店员按加入门店的先后，至多 4 个 */
function previewOf(rows: readonly MemberPreviewRow[], storeId: string): StoreCard["memberPreview"] {
  return rows
    .filter((row) => row.storeId === null || row.storeId === storeId)
    .slice(0, MEMBER_PREVIEW_MAX)
    .map((row) => ({
      displayName: row.displayName,
      role: row.role as StoreCard["memberPreview"][number]["role"],
    }));
}

/** 我可见的门店与主体额度。viewerRole = none：账号没有有效成员关系 */
export async function listStores(
  tx: Tx,
  deps: StoreListDeps,
  now: Date,
  viewer: { merchantUserId: string },
): Promise<StoreList> {
  const membership = await selectActiveMembership(tx, viewer.merchantUserId);
  if (membership === null) return { viewerRole: "none", entity: null, items: [] };
  const entity = await tx.entity.findUniqueOrThrow({
    where: { id: membership.entityId },
    select: { id: true, name: true, verificationStatus: true, lifecycle: true },
  });
  // 主体不是 active 时成员关系本来也已移除；兜底按没有成员关系出
  if (entity.lifecycle !== "active") return { viewerRole: "none", entity: null, items: [] };
  const brief: EntityBrief = {
    entityId: entity.id,
    name: entity.name,
    verificationStatus: entity.verificationStatus as EntityBrief["verificationStatus"],
  };

  const stores = await selectVisibleStores(tx, membership, now);
  const facts = await deps.facts.read(
    tx,
    {
      entityId: entity.id,
      storeIds: stores.map((store) => store.id),
      viewerRole: membership.role,
      merchantUserId: viewer.merchantUserId,
      now,
    },
    ["profile", "order", "asset"],
  );
  const common = (store: StoreRow): Omit<StoreCardForClerk, "actions"> => {
    const profile = facts.profile.stores[store.id];
    return {
      storeId: store.id,
      name: store.name,
      isPrimary: store.isPrimary,
      lifecycle: store.lifecycle as StoreCard["lifecycle"],
      isLastSelected: membership.lastStoreId === store.id,
      city: profile?.city ?? null,
      category: profile?.category ?? null,
      qualificationStatus: store.qualificationStatus as StoreCard["qualificationStatus"],
      assetCount: facts.asset.stores[store.id]?.assetCount ?? 0,
      clerkCount: store.clerkCount,
      todoCount: facts.order.stores[store.id]?.todoCount ?? 0,
    };
  };

  if (membership.role === "clerk") {
    return {
      viewerRole: "clerk",
      entity: brief,
      items: stores.map((store) => ({ ...common(store), actions: [] })),
    };
  }

  const { usage, subscription } = await quotaWithSubscription(tx, deps, now, entity.id);
  const quotaCard: EntityQuotaCard = {
    ...brief,
    subscription:
      subscription === null
        ? null
        : {
            planName: subscription.planName,
            endDate: subscription.endDate,
            isActive: subscription.isActive,
          },
    storesUsed: usage.storesUsed,
    storeLimit: usage.storeLimit,
    seatsUsed: usage.seatsUsed,
    memberLimit: usage.memberLimit,
    pendingInvitationCount: usage.pendingInvitationCount,
    storesOver: usage.storesOver,
    seatsOver: usage.seatsOver,
    limitReason: usage.limitReason,
    canAddStore: usage.storesUsed < usage.storeLimit,
  };
  const previews = await selectMemberPreviews(tx, entity.id);
  const activeStores = stores.filter((store) => store.lifecycle === "active").length;
  const items = stores.map((store): StoreCard => {
    const profile = facts.profile.stores[store.id];
    const order = facts.order.stores[store.id];
    return {
      ...common(store),
      archiveReason: store.archiveReason as StoreCard["archiveReason"],
      archivedAt: iso(store.archivedAt),
      verifiedAt: iso(profile?.verifiedAt ?? null),
      submittedAt: iso(profile?.submittedAt ?? null),
      expectedDecisionAt: iso(profile?.expectedDecisionAt ?? null),
      completenessPct: profile?.completenessPct ?? 0,
      liveCount: order?.liveCount ?? 0,
      deliveringCount: order?.deliveringCount ?? 0,
      pendingInvitationCount: store.pendingInvitationCount,
      memberPreview: previewOf(previews, store.id),
      actions: actionsOf(store, activeStores),
    };
  });
  return { viewerRole: "owner", entity: quotaCard, items };
}

/**
 * 记住当前门店：写 entity_member.last_store_id，只用于下次启动恢复界面，不参与授权。
 * 门店须是本人能进的：老板为本主体除草稿删除外的门店（含自己停用的），店员为本人所属的门店；否则 NOT_FOUND。
 */
export async function rememberCurrentStore(
  tx: Tx,
  now: Date,
  input: { merchantUserId: string; storeId: string },
): Promise<{ storeId: string }> {
  const membership = await resolveMembership(tx, input);
  if (membership === null) throw new AppError("NOT_FOUND");
  await lockRows(tx, "entity_member", [membership.memberId], "update");
  await tx.entityMember.update({
    where: { id: membership.memberId },
    data: { lastStoreId: input.storeId, updatedAt: now },
  });
  return { storeId: input.storeId };
}
