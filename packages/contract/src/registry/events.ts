// events 模块登记的 x01 名字（docs/api/x01-events-jobs.md）。名字写出即冻结：改名等于新开一个（x01 第 6 节 V1、V7、V8）。
import { defineRegistry, loop, queue } from "./define.js";

export const registry = defineRegistry("events", {
  loops: [loop("outbox_relay", "出站中继", "M0"), loop("outbox_dispatch", "出站派发", "M0")],
  queues: [queue("outbox_delivery", "出站投递", "M0")],
});
