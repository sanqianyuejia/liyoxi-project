// 样例模块 alpha 的登记：扮下层模块。六类里除端口实现外各登记一项，另声明三个端口。
// 名字都带 lyxtest 前缀，不进契约的正式登记；只在用例里装配。
import { defineRegistration } from "../../types.js";
import type { DeliveredEvent, FiredTimer, TimerOutcome } from "../../types.js";
import type { Tx } from "../../../tx.js";
import { executorPort, greeterPort, meterPort } from "./ports.js";

/** 处理函数被调到时记一笔，用例据此确认装配结果里拿到的就是这里登记的函数 */
export const calls: string[] = [];

async function onPing(_tx: Tx, event: DeliveredEvent): Promise<void> {
  calls.push(`alpha.onPing:${event.type}`);
}

async function remind(_tx: Tx, timer: FiredTimer): Promise<TimerOutcome> {
  calls.push(`alpha.remind:${timer.kind}`);
  return "fired";
}

async function sweep(): Promise<{ swept: number }> {
  calls.push("alpha.sweep");
  return { swept: 0 };
}

export const registration = defineRegistration("lyxtest_alpha", {
  subscribers: [{ name: "lyxtest.onPingAlpha", events: ["lyxtest.ping"], handle: onPing }],
  timerHandlers: [{ kind: "lyxtest.remind", handle: remind }],
  recurringJobs: [
    { kind: "lyxtest.sweep", run: sweep },
    // 预发专用：生产配置下不出现（D7 第 10.7 节的 stg.pay.autorefund 是这种形态）
    { kind: "lyxtest.stg_autorefund", envs: ["stg"], run: sweep },
  ],
  invariants: [{ code: "lyxtest.I1", severity: "P2", modes: ["full"], run: async () => [] }],
  cleanups: [{ name: "lyxtest.alpha_rows", every: "hour", run: async () => 0 }],
  ports: [greeterPort, meterPort, executorPort],
});
