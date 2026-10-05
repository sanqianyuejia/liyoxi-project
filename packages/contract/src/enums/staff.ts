// staff 模块的枚举。取值的中文含义见 docs/data-model/ 下 03 分组文档的第 3 节。
// 一列一个枚举，名字是“表名_列名”；同一模块里几列同组同义的合成一个。跨模块共用的在 shared.ts。
import { defineEnum } from "./define.js";

export const STAFF_STATUS = defineEnum(
  "staff_status",
  ["staff.status"],
  ["pending", "active", "disabled"],
);

export const STAFF_WECOM_BIND_STATUS = defineEnum(
  "staff_wecom_bind_status",
  ["staff.wecom_bind_status"],
  ["none", "invited", "bound", "unbound"],
);

export const STAFF_DISABLED_REASON = defineEnum(
  "staff_disabled_reason",
  ["staff.disabled_reason"],
  ["resigned", "reassigned", "long_leave", "other"],
);

export const STAFF_ROLE_KEY = defineEnum(
  "staff_role_key",
  ["staff_role.key"],
  [
    "super_admin",
    "cs",
    "delivery_manager",
    "editor",
    "publisher",
    "content_ops",
    "channel_ops",
    "finance",
  ],
);

export const STAFF_ROLE_DATA_SCOPE = defineEnum(
  "staff_role_data_scope",
  ["staff_role.data_scope"],
  ["own", "group", "all"],
);

export const STAFF_ROLE_AVAILABLE_FROM = defineEnum(
  "staff_role_available_from",
  ["staff_role.available_from"],
  ["v1.0", "v1.1"],
);

export const STAFF_ACTIVATION_PURPOSE = defineEnum(
  "staff_activation_purpose",
  ["staff_activation.purpose"],
  ["activate", "reset_password"],
);

export const STAFF_ACTIVATION_DELIVERY = defineEnum(
  "staff_activation_delivery",
  ["staff_activation.delivery"],
  ["sms", "manual"],
);

export const STAFF_SESSION_AUTH_METHOD = defineEnum(
  "staff_session_auth_method",
  ["staff_session.auth_method"],
  ["password+totp", "password+recovery"],
);

export const STAFF_SESSION_REVOKE_REASON = defineEnum(
  "staff_session_revoke_reason",
  ["staff_session.revoke_reason"],
  ["logout", "disabled", "password_reset", "mfa_reset", "phone_changed", "admin"],
);

/** 分配池 */
export const ASSIGNMENT_POOL = defineEnum(
  "assignment_pool",
  ["assignment_pool_member.pool", "assignment_cursor.pool"],
  ["delivery_manager", "editor", "publisher", "cs"],
);

/** 操作人只会是员工或系统的两张表；actor_type 的子集 */
export const STAFF_SYSTEM_ACTOR_TYPE = defineEnum(
  "staff_system_actor_type",
  ["assignment_history.actor_type", "follow_up.actor_type"],
  ["staff", "system"],
);

/** 只有后台一个来源的两张表；client 的子集 */
export const ADMIN_ONLY_CLIENT = defineEnum(
  "admin_only_client",
  ["assignment_history.client", "follow_up.client"],
  ["admin"],
);

export const ASSIGNMENT_HISTORY_SOURCE = defineEnum(
  "assignment_history_source",
  ["assignment_history.source"],
  [
    "store_manager",
    "ticket_editor",
    "ticket_publisher",
    "ad_editor",
    "service_ticket_owner",
    "follow_up_owner",
  ],
);

export const ASSIGNMENT_HISTORY_SUBJECT_TYPE = defineEnum(
  "assignment_history_subject_type",
  ["assignment_history.subject_type"],
  ["store", "drama_order", "delivery_ticket", "ad", "service_ticket", "follow_up"],
);

export const ASSIGNMENT_HISTORY_REASON_CODE = defineEnum(
  "assignment_history_reason_code",
  ["assignment_history.reason_code"],
  [
    "resigned",
    "reassigned",
    "long_leave",
    "workload",
    "merchant_request",
    "staff_change",
    "invariant_fix",
    "other",
  ],
);

export const FOLLOW_UP_SUBJECT_TYPE = defineEnum(
  "follow_up_subject_type",
  ["follow_up.subject_type"],
  ["order_item", "subscription_term", "store", "patrol_task", "takedown_task", "delivery_reissue"],
);

export const FOLLOW_UP_CHANNEL = defineEnum(
  "follow_up_channel",
  ["follow_up.channel"],
  ["wecom", "phone", "visit", "system"],
);
