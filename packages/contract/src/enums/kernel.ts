// kernel 模块的枚举。取值的中文含义见 docs/data-model/ 下 01 分组文档的第 3 节。
// 一列一个枚举，名字是“表名_列名”；同一模块里几列同组同义的合成一个。跨模块共用的在 shared.ts。
import { defineEnum } from "./define.js";

export const IDEMPOTENCY_RECORD_STATE = defineEnum(
  "idempotency_record_state",
  ["idempotency_record.state"],
  ["done", "in_progress"],
);
