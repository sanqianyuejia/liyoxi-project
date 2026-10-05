// billing 模块的登记（W1-10 起）：账本内核的九条不变量（billing.I1–I8、I16）。机制见 kernel/assembly/README.md。
// 循环 billing_advance 不是登记项：它是任务进程里的进程内循环，用例函数在 sweep.ts，由 ops 的 worker 装配接上。
// 建计费账户的端口实现、读侧事实、剧目积分价端口的实现，由 W1-11a、W1-13 在这里各加一行。
import { defineRegistration } from "../kernel/index.js";
import { billingInvariants } from "./invariants.js";

export const registration = defineRegistration("billing", { invariants: billingInvariants });
