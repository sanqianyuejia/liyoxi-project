// timers 模块登记的 x01 名字（docs/api/x01-events-jobs.md）。名字写出即冻结：改名等于新开一个（x01 第 6 节 V1、V7、V8）。
import { defineRegistry, loop, queue } from "./define.js";

export const registry = defineRegistry("timers", {
  loops: [
    loop("timer_scan", "定时器扫描", "M0"),
    loop("ensure_recurring", "ensureRecurring", "M0"),
  ],
  queues: [queue("timer_run", "定时器执行", "M0")],
});
