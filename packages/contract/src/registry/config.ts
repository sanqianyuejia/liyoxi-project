// config 模块登记的 x01 名字（docs/api/x01-events-jobs.md）。名字写出即冻结：改名等于新开一个（x01 第 6 节 V1、V7、V8）。
import { defineRegistry, event } from "./define.js";

export const registry = defineRegistry("config", {
  events: [
    event("site_notice.announced", "site_notice"),
    event("site_notice.withdrawn", "site_notice"),
  ],
});
