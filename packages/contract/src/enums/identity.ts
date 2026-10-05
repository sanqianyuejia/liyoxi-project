// identity 模块的枚举。取值的中文含义见 docs/data-model/ 下 02 分组文档的第 3 节。
// 一列一个枚举，名字是“表名_列名”；同一模块里几列同组同义的合成一个。跨模块共用的在 shared.ts。
import { defineEnum } from "./define.js";

export const MERCHANT_USER_STATUS = defineEnum(
  "merchant_user_status",
  ["merchant_user.status"],
  ["active", "disabled", "deleted"],
);

export const USER_SESSION_REVOKE_REASON = defineEnum(
  "user_session_revoke_reason",
  ["user_session.revoke_reason"],
  [
    "logout",
    "identity_rebound",
    "identity_removed",
    "phone_change",
    "admin",
    "evicted",
    "account_deleted",
  ],
);

export const PORTAL_SESSION_GRANT_SCOPE = defineEnum(
  "portal_session_grant_scope",
  ["portal_session.grant_scope"],
  ["store"],
);

export const PORTAL_SESSION_REVOKE_REASON = defineEnum(
  "portal_session_revoke_reason",
  ["portal_session.revoke_reason"],
  ["owner_revoked", "membership_changed", "account_action", "portal_logout", "expired"],
);

export const MERCHANT_USER_NOTICE_KIND = defineEnum(
  "merchant_user_notice_kind",
  ["merchant_user_notice.kind"],
  ["new_wechat_bound"],
);

export const SMS_VERIFICATION_PURPOSE = defineEnum(
  "sms_verification_purpose",
  ["sms_verification.purpose"],
  ["phone_change", "contact_phone", "login"],
);

export const ACCOUNT_CHANGE_REQUEST_KIND = defineEnum(
  "account_change_request_kind",
  ["account_change_request.kind"],
  ["phone_rebind", "owner_transfer", "owner_reverify"],
);
