// exports 模块的枚举。取值的中文含义见 docs/data-model/ 下 14 分组文档的第 3 节。
// 一列一个枚举，名字是“表名_列名”；同一模块里几列同组同义的合成一个。跨模块共用的在 shared.ts。
import { defineEnum } from "./define.js";

export const EXPORT_JOB_FORMAT = defineEnum(
  "export_job_format",
  ["export_job.format"],
  ["xlsx", "csv"],
);

export const EXPORT_JOB_STATUS = defineEnum(
  "export_job_status",
  ["export_job.status"],
  ["queued", "running", "succeeded", "failed", "expired", "cancelled"],
);
