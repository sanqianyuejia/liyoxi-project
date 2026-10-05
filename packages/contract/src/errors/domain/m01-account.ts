// m01-account 定义的领域错误码（docs/api/m01-account.md 的错误码表；登记文档 docs/api/registry-errors.md 第 2 节）。
// 符号、数值、HTTP、可重试、是否带 details 与文档对账（pnpm api-registries:check）；默认文案是本仓库写的，可以改。
// 新码在本文档的取号区间内取号（裁决 A70）；别的文档要用这里的码，只引符号名，不重新定义（约定 C28）。
import { def, defineDomainErrors } from "../define.js";

export const errors = defineDomainErrors(
  "m01-account",
  [
    [41000, 41099],
    [47400, 47499],
  ],
  {
    WECHAT_UNAVAILABLE: def(41001, 503, true, "手机号验证服务暂不可用，请稍后重试"),
    WECHAT_CODE_INVALID: def(41002, 400, false, "登录凭证已失效，请重新点击登录"),
    PHONE_REGION_UNSUPPORTED: def(41003, 400, false, "暂只支持中国大陆手机号"),
    ACCOUNT_DISABLED: def(41004, 403, false, "账号已被停用，请联系客服"),
    REVERIFY_REQUIRED: def(
      41005,
      403,
      false,
      "该账号长期未登录，为保护账号安全需人工核实，请联系客服",
    ),
    CONTENT_REJECTED: def(41006, 400, false, "提交的文字包含不适宜的内容，请修改", "details"),
    SMS_UNAVAILABLE: def(41007, 503, false, "短信验证暂不可用，请稍后再试或联系客服"),
    SMS_CODE_INVALID: def(41008, 400, false, "验证码错误或已过期，请重新输入或重新获取", "details"),
    PHONE_UNCHANGED: def(41009, 400, false, "新手机号与当前手机号相同"),
    PHONE_TAKEN: def(41010, 409, false, "该手机号已被其他账号使用，请联系客服"),
    IDENTITY_TOO_NEW: def(41011, 403, false, "新绑定的微信 7 天内不能移除其他微信", "details"),
    ACCOUNT_DELETION_BLOCKED: def(
      41012,
      409,
      false,
      "主体还有未办结的事项，暂不能注销，请联系客服",
      "details",
    ),
    AGREEMENT_VERSION_STALE: def(
      47401,
      409,
      false,
      "协议已更新，请阅读新版本后重新同意",
      "details",
    ),
  },
);
