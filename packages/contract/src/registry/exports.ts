// exports 模块登记的 x01 名字（docs/api/x01-events-jobs.md）。名字写出即冻结：改名等于新开一个（x01 第 6 节 V1、V7、V8）。
import { defineRegistry, event, job, queue } from "./define.js";

export const registry = defineRegistry("exports", {
  events: [event("export.succeeded", "export_job"), event("export.failed", "export_job")],
  jobs: [job("export.sweep", "M7")],
  queues: [queue("export", "export（并发 1）", "M7")],
});
