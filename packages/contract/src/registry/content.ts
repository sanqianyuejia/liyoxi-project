// content 模块登记的 x01 名字（docs/api/x01-events-jobs.md）。名字写出即冻结：改名等于新开一个（x01 第 6 节 V1、V7、V8）。
import { defineRegistry, event, job, subscriber, timer } from "./define.js";

export const registry = defineRegistry("content", {
  events: [
    event("drama.created", "drama"),
    event("drama.listed", "drama"),
    event("drama.delisted", "drama"),
    event("drama.tier_changed", "drama"),
    event("drama.license_extended", "drama"),
    event("drama.license_shortened", "drama"),
    event("drama.license_scope_changed", "drama"),
    event("drama.permit_changed", "drama"),
  ],
  subscribers: [
    subscriber("content.onMastersChanged", "M3"),
    subscriber("content.onTrailerReady", "M3"),
  ],
  timers: [timer("content.license_end", "drama", "M3")],
  jobs: [job("content.stat_refresh", "M3"), job("content.archive_sweep", "M3")],
});
