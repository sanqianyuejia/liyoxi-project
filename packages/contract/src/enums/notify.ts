// notify 模块的枚举。取值的中文含义见 docs/data-model/ 下 13 分组文档的第 3 节。
// 一列一个枚举，名字是“表名_列名”；同一模块里几列同组同义的合成一个。跨模块共用的在 shared.ts。
import { defineEnum } from "./define.js";

export const NOTIFY_SCENE_AUDIENCE = defineEnum(
  "notify_scene_audience",
  ["notify_scene.audience"],
  ["merchant", "staff"],
);

export const NOTIFY_SCENE_SMS_POLICY = defineEnum(
  "notify_scene_sms_policy",
  ["notify_scene.sms_policy"],
  ["never", "fallback", "always"],
);

export const NOTIFY_SCENE_SEND_WINDOW = defineEnum(
  "notify_scene_send_window",
  ["notify_scene.send_window"],
  ["immediate", "window", "scheduled"],
);

export const WX_TEMPLATE_SLOT_STATUS = defineEnum(
  "wx_template_slot_status",
  ["wx_template_slot.status"],
  ["active", "unconfigured", "disabled"],
);

export const WX_TEMPLATE_SLOT_DISABLED_REASON = defineEnum(
  "wx_template_slot_disabled_reason",
  ["wx_template_slot.disabled_reason"],
  ["template_invalid", "field_mismatch_streak", "manual"],
);

export const SMS_TEMPLATE_KIND = defineEnum(
  "sms_template_kind",
  ["sms_template.kind"],
  ["verify", "notice"],
);

export const SMS_TEMPLATE_STATUS = defineEnum(
  "sms_template_status",
  ["sms_template.status"],
  ["active", "pending_carrier", "unconfigured", "suspect", "disabled"],
);

export const NOTIFICATION_COPY_MODE = defineEnum(
  "notification_copy_mode",
  ["notification.copy_mode"],
  ["in_app", "offline_contract", "hidden"],
);

export const NOTIFICATION_DELIVERY_CHANNEL = defineEnum(
  "notification_delivery_channel",
  ["notification_delivery.channel"],
  ["inbox", "wx_subscribe", "sms", "wecom", "mail"],
);

export const NOTIFICATION_DELIVERY_ORIGIN = defineEnum(
  "notification_delivery_origin",
  ["notification_delivery.origin"],
  ["primary", "fallback", "manual", "direct"],
);

export const NOTIFICATION_DELIVERY_STATUS = defineEnum(
  "notification_delivery_status",
  ["notification_delivery.status"],
  ["pending", "sending", "sent", "failed", "skipped", "cancelled"],
);

export const NOTIFICATION_DELIVERY_REASON = defineEnum(
  "notification_delivery_reason",
  ["notification_delivery.reason"],
  [
    "guard_invalid",
    "scene_disabled",
    "primary_late_success",
    "no_target",
    "no_quota",
    "unconfigured",
    "slot_disabled",
    "policy_suppressed",
    "rate_limited",
    "collapsed",
    "user_refused",
    "provider_rejected",
    "retry_exhausted",
    "unknown_outcome",
    "claim_exhausted",
  ],
);

export const NOTIFICATION_DELIVERY_PURPOSE = defineEnum(
  "notification_delivery_purpose",
  ["notification_delivery.purpose"],
  ["verify_code", "staff_activation", "account_notice", "ops_alert", "keepalive", "test"],
);

export const MERCHANT_MESSAGE_CATEGORY = defineEnum(
  "merchant_message_category",
  ["merchant_message.category"],
  ["order", "delivery", "launch", "plan_points", "review", "store", "service", "system"],
);

export const STAFF_MESSAGE_KIND = defineEnum(
  "staff_message_kind",
  ["staff_message.kind"],
  ["todo", "alert", "approval", "system"],
);

export const WX_SUBSCRIBE_QUOTA_STATE = defineEnum(
  "wx_subscribe_quota_state",
  ["wx_subscribe_quota.state"],
  ["ok", "rejected", "banned"],
);

export const MANUAL_REMINDER_LOG_SUBJECT_TYPE = defineEnum(
  "manual_reminder_log_subject_type",
  ["manual_reminder_log.subject_type"],
  ["delivery_ticket", "ad", "order_item", "takedown_task", "patrol_task", "subscription_term"],
);

export const MANUAL_REMINDER_LOG_SCENE = defineEnum(
  "manual_reminder_log_scene",
  ["manual_reminder_log.scene"],
  [
    "confirm_plan",
    "confirm_ad",
    "confirm_sample",
    "golive",
    "takedown",
    "breach",
    "patrol_fix",
    "renewal",
  ],
);
