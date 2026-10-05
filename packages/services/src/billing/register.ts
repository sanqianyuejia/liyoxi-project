// billing 模块的登记（W1-10 起）：账户与批次这一半的七条不变量。机制见 kernel/assembly/README.md。
// 循环 billing_advance 不是登记项：它是任务进程里的进程内循环，用例函数在 sweep.ts，由 ops 的 worker 装配接上。
// W1-11a（账本侧）：tenant 的计费账户端口与事实端口 billing 键的实现；订阅一侧的三条不变量（I9、I10、I12）。
// 剧目积分价端口的实现由 W1-13 在这里加一行。
import { defineRegistration, implement, implementMerchantFacts } from "../kernel/index.js";
import { billingAccountPort } from "../tenant/index.js";
import { billingInvariants } from "./invariants.js";
import { billingAccountOpener, billingMerchantFacts } from "./ports.js";
import { subscriptionInvariants } from "./subscription/invariants.js";

export const registration = defineRegistration("billing", {
  portImplementations: [
    implement(billingAccountPort, billingAccountOpener),
    implementMerchantFacts("billing", billingMerchantFacts),
  ],
  invariants: [...billingInvariants, ...subscriptionInvariants],
});
