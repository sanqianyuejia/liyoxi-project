// staff 模块登记的 x01 名字（docs/api/x01-events-jobs.md）。名字写出即冻结：改名等于新开一个（x01 第 6 节 V1、V7、V8）。
import { command, defineRegistry, event, subscriber, timer } from "./define.js";

export const registry = defineRegistry("staff", {
  events: [
    event("staff.created", "staff"),
    event("staff.enabled", "staff"),
    event("staff.disabled", "staff"),
    event("assignment.transferred", "assignment_history"),
    event("assignment.sla_breached", "assignment_history"),
  ],
  subscribers: [subscriber("staff.onCalendarImported", "M2")],
  timers: [timer("sla.breach", "assignment_history", "M2")],
  commands: [command("staff_bootstrap", "staff:bootstrap", "M1")],
});
