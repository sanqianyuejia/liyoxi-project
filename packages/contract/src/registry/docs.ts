// docs 模块登记的 x01 名字（docs/api/x01-events-jobs.md）。名字写出即冻结：改名等于新开一个（x01 第 6 节 V1、V7、V8）。
import { defineRegistry, event, job, queue, subscriber } from "./define.js";

export const registry = defineRegistry("docs", {
  events: [
    event("license_letter.revision_queued", "license_letter"),
    event("license_letter.issued", "license_letter"),
    event("license_letter.voided", "license_letter"),
  ],
  subscribers: [
    subscriber("docs.onLicenseFacts", "M5", "critical"),
    subscriber("docs.onRevisionQueued", "M5"),
  ],
  jobs: [job("docs.sweep", "M2"), job("evidence.consent_digest", "M2")],
  queues: [queue("docs", "docs（并发 2）", "M5")],
});
