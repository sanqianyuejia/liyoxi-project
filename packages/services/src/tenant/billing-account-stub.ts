// 计费账户端口的桩（W1-03 留桩，docs/plan/stubs/m1-tenant-billing-account-port.md）：什么都不建。
// billing 的账本侧（W1-11a）注册真实现时删掉本文件与 register.ts 里登记它的那一行。
// 在那之前，建出来的主体没有 billing_account 行：钱包、订购等读到的是“未开通”。
import type { BillingAccountOpener } from "./ports.js";

export const billingAccountStub: BillingAccountOpener = {
  ensureForEntity: () => Promise.resolve(),
};
