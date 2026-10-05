// tenant 模块的登记（W1-03）：
//   端口     声明计费账户端口；W1-11a 合并之前由桩顶着（它注册真实现时删掉下面登记桩的那一行与桩文件）。
//   状态机   entity、store、entity_member 五条链的随迁列、活动流默认描述，与本包用到的十行迁移的守卫。
//   不变量   tenant.I1、I7、I27、I29；调度与落库由 ops（W0-24）。
// 订阅者 tenant.onEntitlementChanged、定时器 invitation.expire 随 M2。
import { defineRegistration, implement } from "../kernel/index.js";
import type { InvariantRegistration } from "../kernel/index.js";
import { billingAccountStub } from "./billing-account-stub.js";
import {
  findI1Violations,
  findI27Violations,
  findI29Violations,
  findI7Violations,
} from "./invariants.js";
import { machineImplementations } from "./machines.js";
import { billingAccountPort } from "./ports.js";

const check = (
  code: string,
  run: NonNullable<InvariantRegistration["run"]>,
): InvariantRegistration => ({ code, severity: "P2", modes: ["full"], heal: "none", run });

export const registration = defineRegistration("tenant", {
  ports: [billingAccountPort],
  portImplementations: [
    implement(billingAccountPort, billingAccountStub),
    ...machineImplementations(),
  ],
  invariants: [
    check("tenant.I1", (tx) => findI1Violations(tx)),
    check("tenant.I7", (tx) => findI7Violations(tx)),
    check("tenant.I27", (tx) => findI27Violations(tx)),
    check("tenant.I29", (tx) => findI29Violations(tx)),
  ],
});
