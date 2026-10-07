// approval 模块的登记（W1-06）：声明按键端口 approval.kind；登记审批单状态机的守卫、处理器的挂点与随迁列；
// 五项每日校验 approval.I1–I5（调度与落库在 ops 的 invariant.full）。
// 真实的审批类型由各域在自己的 register.ts 里实现 approvalKindPort：qualification 归 profile，
// channel_account、launch_link 归 publish，其余随各自的里程碑。W2-05 登记决定时限与日历订阅。
import { machinePort } from "../flow/index.js";
import { defineRegistration, implementKeyed, invariantNow } from "../kernel/index.js";

import { findI1Violations, findI2Violations, findI4Violations } from "./invariants.js";
import { boundApprovalSla, onApprovalCalendarImported, handleApprovalSlaBreach } from "./sla.js";
import { findI3Violations, findI5Violations } from "./sla-invariants.js";
import { approvalKindPort } from "./kinds.js";
import { APPROVAL_CHAIN, approvalBinding } from "./machine.js";

export const registration = defineRegistration("approval", {
  ports: [approvalKindPort],
  subscribers: [
    {
      name: "approval.onCalendarImported",
      events: ["calendar.imported"],
      handle: (tx, event) => onApprovalCalendarImported(tx, boundApprovalSla(), event),
    },
  ],
  timerHandlers: [
    {
      kind: "sla.breach",
      handle: (tx, timer) => handleApprovalSlaBreach(tx, boundApprovalSla(), timer),
    },
  ],
  portImplementations: [implementKeyed(machinePort, APPROVAL_CHAIN, approvalBinding)],
  invariants: [
    {
      code: "approval.I3",
      severity: "P2",
      modes: ["full"],
      heal: "none",
      run: (tx, _scope, ctx) => findI3Violations(tx, invariantNow(ctx)),
    },
    {
      code: "approval.I5",
      severity: "P2",
      modes: ["full"],
      heal: "none",
      run: (tx, _scope, ctx) => findI5Violations(tx, invariantNow(ctx)),
    },
    {
      code: "approval.I1",
      severity: "P2",
      modes: ["full"],
      heal: "none",
      run: (tx) => findI1Violations(tx),
    },
    {
      code: "approval.I2",
      severity: "P2",
      modes: ["full"],
      heal: "none",
      run: (tx) => findI2Violations(tx),
    },
    {
      code: "approval.I4",
      severity: "P2",
      modes: ["full"],
      heal: "none",
      run: (tx) => findI4Violations(tx),
    },
  ],
});
