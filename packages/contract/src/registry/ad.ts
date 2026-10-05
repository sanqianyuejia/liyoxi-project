// ad 模块登记的 x01 名字（docs/api/x01-events-jobs.md）。名字写出即冻结：改名等于新开一个（x01 第 6 节 V1、V7、V8）。
import { defineRegistry, event, timer } from "./define.js";

export const registry = defineRegistry("ad", {
  events: [
    event("ad.requested", "ad"),
    event("ad.assigned", "ad"),
    event("ad.returned", "ad"),
    event("ad.resubmitted", "ad"),
    event("ad.version_pushed", "ad"),
    event("ad.confirmed", "ad"),
    event("ad.revision_requested", "ad"),
    event("ad.cancelled", "ad"),
    event("ad.returned_stale", "ad"),
    event("ad.sla_breached", "ad"),
    event("ad.confirm_remind_due", null, "not_emitted"),
  ],
  timers: [timer("sla.breach", "ad", "M5"), timer("ad.returned_stale", "ad", "M5")],
});
