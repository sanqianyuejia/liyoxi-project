// publish 模块的枚举。取值的中文含义见 docs/data-model/ 下 11 分组文档的第 3 节。
// 一列一个枚举，名字是“表名_列名”；同一模块里几列同组同义的合成一个。跨模块共用的在 shared.ts。
import { defineEnum } from "./define.js";

export const CHANNEL_ACCOUNT_ACCOUNT_TYPE = defineEnum(
  "channel_account_account_type",
  ["channel_account.account_type"],
  ["enterprise", "personal", "none"],
);

export const CHANNEL_ACCOUNT_STATUS = defineEnum(
  "channel_account_status",
  ["channel_account.status"],
  ["pending_verify", "available", "abnormal", "unbound"],
);

export const CHANNEL_ACCOUNT_ABNORMAL_SOURCE = defineEnum(
  "channel_account_abnormal_source",
  ["channel_account.abnormal_source"],
  ["verify", "manual"],
);

export const CHANNEL_ACCOUNT_SUBMISSION_KIND = defineEnum(
  "channel_account_submission_kind",
  ["channel_account_submission.kind"],
  ["new_binding", "resubmit"],
);

export const LAUNCH_TASK_REVIEW_STATUS = defineEnum(
  "launch_task_review_status",
  ["launch_task.review_status"],
  ["pending", "verifying", "need_fix", "passed", "void"],
);

export const LAUNCH_TASK_LAST_PATROL_RESULT = defineEnum(
  "launch_task_last_patrol_result",
  ["launch_task.last_patrol_result"],
  ["normal", "abnormal", "recovered"],
);

export const LAUNCH_TASK_VOID_REASON = defineEnum(
  "launch_task_void_reason",
  ["launch_task.void_reason"],
  ["terminated", "usage_expired", "account_changed"],
);

export const LAUNCH_SUBMISSION_LINK_KIND = defineEnum(
  "launch_submission_link_kind",
  ["launch_submission.link_kind"],
  ["collection", "episodes"],
);

export const LAUNCH_SUBMISSION_RESULT = defineEnum(
  "launch_submission_result",
  ["launch_submission.result"],
  ["pending", "passed", "passed_partial", "returned", "revoked", "withdrawn"],
);

export const PATROL_TASK_SOURCE = defineEnum(
  "patrol_task_source",
  ["patrol_task.source"],
  ["weekly_sample", "manual", "reissue"],
);

export const PATROL_TASK_STATUS = defineEnum(
  "patrol_task_status",
  ["patrol_task.status"],
  ["pending", "normal", "abnormal", "recovered", "void"],
);

export const TAKEDOWN_TASK_TRIGGER_KIND = defineEnum(
  "takedown_task_trigger_kind",
  ["takedown_task.trigger_kind"],
  ["expiry", "early_end", "platform_termination", "terminated_after_delivery"],
);

export const TAKEDOWN_TASK_BASIS = defineEnum(
  "takedown_task_basis",
  ["takedown_task.basis"],
  ["live", "delivered_unverified"],
);

export const TAKEDOWN_TASK_STATUS = defineEnum(
  "takedown_task_status",
  ["takedown_task.status"],
  ["pending_merchant", "merchant_confirmed", "checked", "void"],
);

export const TAKEDOWN_TASK_MERCHANT_METHOD = defineEnum(
  "takedown_task_merchant_method",
  ["takedown_task.merchant_method"],
  ["delete", "private", "not_published"],
);

export const TAKEDOWN_TASK_CHECK_METHOD = defineEnum(
  "takedown_task_check_method",
  ["takedown_task.check_method"],
  ["evidence", "sampled_out"],
);
