// ops 模块登记的 x01 名字（docs/api/x01-events-jobs.md）。名字写出即冻结：改名等于新开一个（x01 第 6 节 V1、V7、V8）。
import { command, defineRegistry, job, loop } from "./define.js";

export const registry = defineRegistry("ops", {
  jobs: [
    job("invariant.full", "M0"),
    job("invariant.quick", "M0"),
    job("ops.retention", "M0"),
    job("ops.cert_check", "M2"),
    job("backup.pgdump", "M2"),
    job("stg.pay.autorefund", "M4"),
  ],
  loops: [loop("probe", "探针 probe()", "M2")],
  commands: [command("alerts_ack", "cli.alerts.ack / 关闭告警、重置死信回调", "M2")],
});
