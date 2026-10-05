// delivery 模块登记的 x01 名字（docs/api/x01-events-jobs.md）。名字写出即冻结：改名等于新开一个（x01 第 6 节 V1、V7、V8）。
import { defineRegistry, event, loop, subscriber, timer } from "./define.js";

export const registry = defineRegistry("delivery", {
  events: [
    event("ticket.created", "delivery_ticket"),
    event("ticket.assigned", "delivery_ticket"),
    event("ticket.step_changed", "delivery_ticket"),
    event("ticket.held", "delivery_ticket"),
    event("ticket.resumed", "delivery_ticket"),
    event("ticket.terminated", "delivery_ticket"),
    event("ticket.archived", "delivery_ticket"),
    event("ticket.sla_breached", "delivery_ticket"),
    event("ticket.episode_qc_failed", "delivery_ticket"),
    event("plan.pushed", "delivery_plan"),
    event("plan.change_requested", "delivery_plan"),
    event("plan.confirmed", "delivery_plan"),
    event("sample.uploaded", "sample"),
    event("sample.check_rejected", "sample"),
    event("sample.qc_failed", "sample"),
    event("sample.qc_passed", "sample"),
    event("sample.pushed", "sample"),
    event("sample.confirmed", "sample"),
    event("sample.change_requested", "sample"),
    event("sample.superseded", "sample"),
    event("package.delivered", "delivery_release"),
    event("package.reissued", "delivery_reissue"),
    event("package.reissue_opened", "delivery_reissue"),
    event("publish_list.updated", "publish_list"),
    event("sample.remind_due", null, "not_emitted"),
  ],
  subscribers: [
    subscriber("delivery.onProductionChecked", "M3"),
    subscriber("delivery.onCalendarImported", "M5"),
  ],
  timers: [
    timer("usage.end", "order_item", "M6", "critical"),
    timer("sla.breach", "delivery_ticket_stage", "M5"),
  ],
  loops: [loop("flow_reevaluate_sweep", "flow.reevaluate_sweep", "M1")],
});
