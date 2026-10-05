// docs 模块的登记（W1-03）：两条不变量。调度与落库由 ops（W0-24）。
// 本模块在 M1 没有订阅者、定时器、周期任务：docs.sweep、evidence.consent_digest 随 M2，授权书随 M5。
import { defineRegistration } from "../kernel/index.js";
import { findN13Violations, findN4Violations } from "./invariants.js";

export const registration = defineRegistration("docs", {
  invariants: [
    {
      code: "docs.N4",
      severity: "P2",
      modes: ["full"],
      heal: "none",
      run: (tx) => findN4Violations(tx),
    },
    {
      code: "docs.N13",
      severity: "P2",
      modes: ["full"],
      heal: "none",
      run: (tx) => findN13Violations(tx),
    },
  ],
});
