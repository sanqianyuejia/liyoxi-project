// support 模块登记的 x01 名字（docs/api/x01-events-jobs.md）。名字写出即冻结：改名等于新开一个（x01 第 6 节 V1、V7、V8）。
import { defineRegistry, event, subscriber, timer } from "./define.js";

export const registry = defineRegistry("support", {
  events: [
    event("service_ticket.created", "service_ticket"),
    event("service_ticket.replied", "service_ticket"),
    event("service_ticket.supplemented", "service_ticket"),
    event("service_ticket.result_submitted", "service_ticket"),
    event("service_ticket.resolved", "service_ticket"),
    event("service_ticket.reopened", "service_ticket"),
    event("service_ticket.closed", "service_ticket"),
    event("service_ticket.solution_overdue", "service_ticket"),
    event("service_ticket.transferred", "service_ticket"),
    event("service_ticket.escalated", "service_ticket"),
  ],
  subscribers: [
    subscriber("support.onBizEvent", "M7"),
    subscriber("support.onCalendarImported", "M7"),
  ],
  timers: [
    timer("service.first_response_due", "service_ticket", "M7"),
    timer("service.solution_due", "service_ticket", "M7"),
    timer("service.auto_resolve", "service_ticket", "M7", "critical"),
  ],
});
