// approval 模块登记的 x01 名字（docs/api/x01-events-jobs.md）。名字写出即冻结：改名等于新开一个（x01 第 6 节 V1、V7、V8）。
import { defineRegistry, event, subscriber, timer } from "./define.js";

export const registry = defineRegistry("approval", {
  events: [
    event("approval.submitted", "approval_request"),
    event("approval.approved", "approval_request"),
    event("approval.rejected", "approval_request"),
    event("approval.withdrawn", "approval_request"),
    event("approval.executed", "approval_request"),
    event("approval.sla_breached", "approval_request"),
  ],
  subscribers: [subscriber("approval.onCalendarImported", "M2")],
  timers: [timer("sla.breach", "approval_request", "M2")],
});
