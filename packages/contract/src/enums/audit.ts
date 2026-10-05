// audit 模块的枚举。取值的中文含义见 docs/data-model/ 下 03 分组文档的第 3 节。
// 一列一个枚举，名字是“表名_列名”；同一模块里几列同组同义的合成一个。跨模块共用的在 shared.ts。
import { defineEnum } from "./define.js";

export const AUDIT_LOG_STREAM = defineEnum(
  "audit_log_stream",
  ["audit_log.stream"],
  ["ops", "activity", "access"],
);

export const AUDIT_LOG_CLIENT = defineEnum(
  "audit_log_client",
  ["audit_log.client"],
  ["weapp", "portal", "admin", "cli"],
);

export const AUTH_EVENT_SPACE = defineEnum(
  "auth_event_space",
  ["auth_event.space"],
  ["merchant", "staff", "portal"],
);

export const AUTH_EVENT_EVENT = defineEnum(
  "auth_event_event",
  ["auth_event.event"],
  [
    "login_success",
    "login_fail",
    "locked",
    "step_up",
    "identity_rebound",
    "identity_removed",
    "reverify_required",
    "logout",
    "offnet_denied",
  ],
);
