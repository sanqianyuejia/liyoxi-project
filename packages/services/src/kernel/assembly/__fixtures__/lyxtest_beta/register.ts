// 样例模块 beta 的登记：扮上层模块。六类各登记一项，其中端口实现是给 alpha 定义的端口注册实现。
import { defineRegistration, implement, implementKeyed } from "../../types.js";
import type { DeliveredEvent, FiredTimer, TimerOutcome } from "../../types.js";
import type { Tx } from "../../../tx.js";
import { executorPort, greeterPort } from "../lyxtest_alpha/index.js";

export const calls: string[] = [];

async function onPing(_tx: Tx, event: DeliveredEvent): Promise<void> {
  calls.push(`beta.onPing:${event.type}`);
}

async function followup(_tx: Tx, timer: FiredTimer): Promise<TimerOutcome> {
  calls.push(`beta.followup:${timer.kind}`);
  return "skipped";
}

async function digest(): Promise<void> {
  calls.push("beta.digest");
}

export const registration = defineRegistration("lyxtest_beta", {
  subscribers: [
    { name: "lyxtest.onPingBeta", events: ["lyxtest.ping", "lyxtest.pong"], handle: onPing },
  ],
  timerHandlers: [{ kind: "lyxtest.followup", handle: followup }],
  recurringJobs: [{ kind: "lyxtest.digest", run: digest }],
  portImplementations: [
    implement(greeterPort, { greet: (name) => `你好，${name}` }),
    implementKeyed(executorPort, "refund", (input) => `refund:${input}`),
    implementKeyed(executorPort, "cancel", (input) => `cancel:${input}`),
  ],
  invariants: [
    {
      code: "lyxtest.I2",
      severity: "P1",
      modes: ["quick", "full"],
      every: "hour",
      run: async () => [{ subject: { type: "lyxtest_row", id: "1" }, detail: { expected: 0 } }],
    },
  ],
  cleanups: [{ name: "lyxtest.beta_rows", every: "day", run: async () => 3 }],
});
