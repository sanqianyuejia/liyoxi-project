// media 模块登记的 x01 名字（docs/api/x01-events-jobs.md）。名字写出即冻结：改名等于新开一个（x01 第 6 节 V1、V7、V8）。
import { callback, defineRegistry, event, job, loop, queue, subscriber, timer } from "./define.js";

export const registry = defineRegistry("media", {
  events: [
    event("file.uploaded", "file_object"),
    event("file.stored", "file_object"),
    event("file.rejected", "file_object"),
    event("file.moderated", "file_object"),
    event("media.production.checked", "production_record"),
    event("media.production.derived", "production_record"),
    event("media.playable.ready", "playable_asset"),
    event("media.playable.failed", "playable_asset"),
    event("media.release.zip_ready", "zip_bundle"),
    event("media.ocr.completed", "ocr_result"),
    event("asset.processed", "store_asset"),
    event("asset.review_needed", "store_asset"),
    event("asset.reviewed", "store_asset"),
    event("asset.adopted", "store_asset"),
    event("asset.demand_created", "store_asset_demand"),
    event("asset.feedback_submitted", "store_asset"),
    event("asset.sla_breached", "store_asset"),
    event("drama.masters_changed", "drama"),
    event("drama.trailer_ready", "drama"),
  ],
  subscribers: [subscriber("media.onCalendarImported", "M3")],
  timers: [timer("sla.breach", "store_asset", "M3")],
  jobs: [job("media.sweep", "M3")],
  loops: [loop("media_job_run", "media_job 执行循环", "M3")],
  queues: [
    queue("promote", "promote", "M1"),
    queue("media_job", "媒体任务", "M3"),
    queue("zip_package", "zip_package", "M6"),
  ],
  callbacks: [callback("hooks.ci.mediaJob.wake", "M3"), callback("hooks.asr.mediaJob.wake", "M3")],
});
