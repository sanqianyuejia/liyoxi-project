// flow 模块的登记（W0-16）：两个端口的声明，与不变量 flow.I12。调度与落库在 W0-24。
// 状态机的守卫、副作用、随迁列、活动流默认描述由各域在自己的 register.ts 里实现 machinePort；
// 工作分钟端口的真实实现要读工作日历与工作时段，由 sla 在它的 register.ts 里登记（W0-30a）。
import { defineRegistration } from "../kernel/index.js";
import { machinePort, workMinutesPort } from "./bindings.js";
import { findI12Violations } from "./invariants.js";

export const registration = defineRegistration("flow", {
  ports: [machinePort, workMinutesPort],
  invariants: [
    {
      code: "flow.I12",
      severity: "P2",
      modes: ["full"],
      heal: "none",
      run: (tx) => findI12Violations(tx),
    },
  ],
});
