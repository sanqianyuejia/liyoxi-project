// order 模块登记的 x01 名字（docs/api/x01-events-jobs.md）。名字写出即冻结：改名等于新开一个（x01 第 6 节 V1、V7、V8）。
import { defineRegistry, event, job, loop, subscriber, timer } from "./define.js";

export const registry = defineRegistry("order", {
  events: [
    event("order.submitted", "drama_order"),
    event("order.started", "drama_order"),
    event("order.status_changed", "drama_order"),
    event("order.rejected_stale", "drama_order"),
    event("order.item.cancelled", "order_item"),
    event("order.item.refunded", "order_item"),
    event("order.item.terminated", "order_item"),
    event("order.item.went_live", "order_item"),
    event("order.item.live_revoked", "order_item"),
    event("order.item.usage_end_changed", "order_item"),
    event("order.item.launch_rescheduled", "order_item"),
    event("cancel.submitted", "cancel_request"),
    event("cancel.approved", "cancel_request"),
    event("cancel.rejected", "cancel_request"),
    event("cancel.withdrawn", "cancel_request"),
    event("cancel.executed", "cancel_request"),
    event("cancel.voided", "cancel_request"),
  ],
  subscribers: [
    subscriber("order.onQualificationDecided", "M1", "critical"),
    subscriber("order.onSubscriptionActivated", "M1", "critical"),
    subscriber("order.onLicenseShortened", "M5"),
    subscriber("order.onCalendarImported", "M5"),
  ],
  timers: [
    timer("order.start", "drama_order", "M1", "critical"),
    timer("order.rejected_stale", "drama_order", "M5"),
    timer("usage.resync", "order_item", "M6", "critical"),
  ],
  jobs: [job("order.pending_start_sweep", "M1")],
  loops: [loop("flow_reconcile_sweep", "flow.reconcile_sweep", "M5")],
});
