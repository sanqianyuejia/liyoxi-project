// identity 模块的表对应的资源名（docs/api/working/resources.json；约定 C10）。一张表一个资源名，三端同名。
// 表、资源名、参数名、端、别名与 resources.json 对账（pnpm api-registries:check）。
import { defineResources, resource } from "./define.js";

export const resources = defineResources("identity", [
  resource("merchant_user", "merchant-users", "merchantUserId", ["m", "admin"], ["/m/me"]),
  resource(
    "wechat_identity",
    "wechat-identities",
    "wechatIdentityId",
    ["m"],
    ["/m/me/wechat-identities"],
  ),
  resource("user_session", "sessions", "sessionId", ["m"], ["/m/sessions/current"]),
  resource(
    "portal_session",
    "portal-sessions",
    "portalSessionId",
    ["m", "portal"],
    ["/portal/sessions/current"],
  ),
  resource("merchant_user_notice", "user-notices", "userNoticeId", ["m"], ["/m/me/user-notices"]),
  resource("sms_verification", "sms-codes", null, ["m"], ["/m/store-profile/contact/sms-codes"]),
  resource("account_change_request", "account-change-requests", "accountChangeRequestId", [
    "admin",
  ]),
]);
