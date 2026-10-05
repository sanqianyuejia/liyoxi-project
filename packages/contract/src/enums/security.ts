// security 模块的枚举。取值的中文含义见 docs/data-model/ 下 15 分组文档的第 3 节。
// 一列一个枚举，名字是“表名_列名”；同一模块里几列同组同义的合成一个。跨模块共用的在 shared.ts。
import { defineEnum } from "./define.js";

export const WEBHOOK_EVENT_PROVIDER = defineEnum(
  "webhook_event_provider",
  ["webhook_event.provider"],
  ["wechatpay", "wechat", "wecom", "ci", "asr", "sms", "esign"],
);

export const WEBHOOK_EVENT_MODE = defineEnum(
  "webhook_event_mode",
  ["webhook_event.mode"],
  ["inline", "inbox"],
);

export const WEBHOOK_EVENT_PROCESS_STATE = defineEnum(
  "webhook_event_process_state",
  ["webhook_event.process_state"],
  ["received", "processed", "ignored", "failed", "dead"],
);
