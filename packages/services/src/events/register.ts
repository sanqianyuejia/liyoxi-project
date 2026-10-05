// events 模块的登记（W0-15）：不变量 events.I8。调度与落库在 W0-24。
// 本模块自己没有订阅者：订阅者由各域在自己的 register.ts 里登记，名字以契约为准。
import { defineRegistration } from "../kernel/index.js";
import { findI8Violations } from "./invariants.js";

export const registration = defineRegistration("events", {
  invariants: [
    {
      code: "events.I8",
      severity: "P2",
      modes: ["full"],
      heal: "none",
      run: (tx) => findI8Violations(tx),
    },
  ],
});
