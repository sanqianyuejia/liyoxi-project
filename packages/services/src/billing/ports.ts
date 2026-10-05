// billing 实现的两个端口（W1-11a）。
//
//   1. tenant 的计费账户端口：建主体的事务里同时建 billing_account 行（07 分组 第 2.8、5.4 节）。
//      端口的实现是装配时登记的静态对象，拿不到注入的时钟：建账户的时间取主体行的 created_at——
//      它是同一个事务里 tenant 按注入的时钟刚写的。建完再锁一遍，只为让内核记下这把锁
//      （计费账户排在加锁顺序的最后：之后同一事务再锁别的表，锁序断言会报）。
//   2. 商家读侧事实端口的 billing 键：门店额度卡要的当前（或最近一期）套餐与名额，
//      “我的”页套餐与积分卡要的项。两段都取 getWalletView，与钱包页同一个口径；只读。
import { lockRows } from "../kernel/index.js";
import type { MerchantFactsProvider, Tx } from "../kernel/index.js";
import type { BillingAccountOpener } from "../tenant/index.js";
import { ensureAccount } from "./ledger/context.js";
import { getWalletView } from "./read/index.js";

/** 给刚建的主体建计费账户行。可重入：已有即不动 */
export async function openAccountForEntity(tx: Tx, entityId: string): Promise<void> {
  const { createdAt } = await tx.entity.findUniqueOrThrow({
    where: { id: entityId },
    select: { createdAt: true },
  });
  await ensureAccount(tx, { now: () => createdAt }, entityId);
  await lockRows(tx, "billing_account", [entityId]);
}

export const billingAccountOpener: BillingAccountOpener = {
  ensureForEntity: (tx, _ctx, entityId) => openAccountForEntity(tx, entityId),
};

/** 事实端口的 billing 键：订阅是否生效按周期起止现算；从未开通时 subscription 为空 */
export const billingMerchantFacts: MerchantFactsProvider<"billing"> = async (tx, query) => {
  const { subscription, points } = await getWalletView(tx, query.entityId, query.now);
  const { plan, endDate, benefits } = subscription;
  return {
    subscription:
      plan === null || endDate === null || benefits === null
        ? null
        : {
            planName: plan.name,
            endDate,
            isActive: subscription.status === "active",
            maxStores: benefits.maxStores,
            maxMembers: benefits.maxMembers,
          },
    wallet: {
      status: subscription.status,
      isRefundPending: subscription.isRefundPending,
      planName: plan?.name ?? null,
      endDate,
      remainingDays: subscription.remainingDays,
      spendablePoints: points.spendablePoints,
      planAvailablePoints: points.planAvailablePoints,
      addonAvailablePoints: points.addonAvailablePoints,
      planPointsExpireAt: points.planPointsExpireAt,
      isAddonSuspended: points.isAddonSuspended,
    },
  };
};
