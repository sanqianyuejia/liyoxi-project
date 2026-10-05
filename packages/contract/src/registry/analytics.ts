// analytics 模块登记的 x01 名字（docs/api/x01-events-jobs.md）。名字写出即冻结：改名等于新开一个（x01 第 6 节 V1、V7、V8）。
import { command, defineRegistry, job, subscriber } from "./define.js";

export const registry = defineRegistry("analytics", {
  subscribers: [subscriber("analytics.fromOutbox", "M7")],
  jobs: [job("analytics.partitions", "M2"), job("analytics.dedup_purge", "M2")],
  commands: [command("analytics_repartition", "ops analytics:repartition <YYYY-MM>", "M2")],
});
