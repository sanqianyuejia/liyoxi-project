// tenant 定义的端口（W1-03）。
//
// 计费账户端口：建主体的事务里要同时建 billing_account 行（07 分组 第 2.8 节；02 分组 第 2.9 节），
// 而 tenant 在 L1，不能调 L2 的 billing：由 tenant 定义端口，billing 注册实现，同一事务调用（01 第 5 节调用规则 5）。
// 不给默认实现：没人实现就装配失败、进程起不来，免得生产上悄悄不建账户。
// 实现在 billing 的 ports.ts（W1-11a 起；此前本目录有一个什么都不建的桩，已删）。
import { definePort } from "../kernel/index.js";
import type { IdentityContext, Tx } from "../kernel/index.js";

export interface BillingAccountOpener {
  /**
   * 给刚建的主体建计费账户行。在建主体的事务里、锁完门店之后调：计费账户排在加锁顺序的最后。
   * 实现要可重入：同一主体再调一次不多建。
   */
  ensureForEntity(tx: Tx, ctx: IdentityContext, entityId: string): Promise<void>;
}

export const billingAccountPort = definePort<BillingAccountOpener>("tenant.billingAccount");
