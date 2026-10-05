// 额度与名额（W1-03；m02 第 2.1 节）：读时现算、不落库。全仓唯一的口径，别处展示同一组量都调它。
//
//   storeLimit   主体上的覆盖值；为空时，订阅生效取当前周期的门店数上限，否则取参数 tenant.default_store_limit
//   memberLimit  主体上的覆盖值；为空时，订阅生效取当前周期的成员数上限（空 = 不限），否则取参数 tenant.default_member_limit
//   storesUsed   启用中的门店数；seatsUsed 有效店员数加待接受且未过期的邀请数（老板不占名额）
//
// 订阅的事实经事实端口的 billing 键取（tenant 读不到 billing 的表）：没人注册时按“未开通”算。
import { paramsAt } from "../config/index.js";
import { AppError } from "../kernel/index.js";
import type { BillingSubscriptionFacts, MerchantFactsReader, Tx } from "../kernel/index.js";
import { selectUsageCounts } from "./repo.js";

export interface QuotaUsage {
  readonly storesUsed: number;
  readonly storeLimit: number;
  readonly seatsUsed: number;
  /** null = 不限 */
  readonly memberLimit: number | null;
  readonly storesOver: number;
  readonly seatsOver: number;
  /** 套餐生效 / 未开通或已过期：只用于文案（引导升级，或引导开通、续费） */
  readonly limitReason: "plan" | "inactive";
  /** 待接受且未过期的邀请数（已含在 seatsUsed 里） */
  readonly pendingInvitationCount: number;
}

export interface QuotaDeps {
  readonly facts: MerchantFactsReader;
}

/** 额度连同算它用到的订阅事实：门店列表的主体卡两样都要，只问一次端口 */
export async function quotaWithSubscription(
  tx: Tx,
  deps: QuotaDeps,
  now: Date,
  entityId: string,
): Promise<{ usage: QuotaUsage; subscription: BillingSubscriptionFacts | null }> {
  const entity = await tx.entity.findUnique({
    where: { id: entityId },
    select: { storeLimitOverride: true, memberLimitOverride: true },
  });
  if (entity === null) throw new AppError("NOT_FOUND");
  const { subscription } = await deps.facts.source(tx, "billing", {
    entityId,
    storeIds: [],
    viewerRole: "owner",
    merchantUserId: null,
    now,
  });
  const active = subscription?.isActive === true;
  const defaults = await paramsAt(
    tx,
    ["tenant.default_store_limit", "tenant.default_member_limit"],
    now,
  );
  const storeLimit =
    entity.storeLimitOverride ??
    (active ? subscription.maxStores : defaults["tenant.default_store_limit"]);
  const memberLimit =
    entity.memberLimitOverride ??
    (active ? subscription.maxMembers : defaults["tenant.default_member_limit"]);
  const counts = await selectUsageCounts(tx, entityId, now);
  const seatsUsed = counts.clerks + counts.pendingInvitations;
  return {
    subscription,
    usage: {
      storesUsed: counts.storesUsed,
      storeLimit,
      seatsUsed,
      memberLimit,
      storesOver: Math.max(0, counts.storesUsed - storeLimit),
      seatsOver: memberLimit === null ? 0 : Math.max(0, seatsUsed - memberLimit),
      limitReason: active ? "plan" : "inactive",
      pendingInvitationCount: counts.pendingInvitations,
    },
  };
}

export async function getQuotaUsage(
  tx: Tx,
  deps: QuotaDeps,
  now: Date,
  entityId: string,
): Promise<QuotaUsage> {
  return (await quotaWithSubscription(tx, deps, now, entityId)).usage;
}
