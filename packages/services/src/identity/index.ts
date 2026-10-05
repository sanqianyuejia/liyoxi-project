// identity：商家账号、微信身份、会话与登录（W1-04 交会话与鉴权链：令牌与会话、静默登录、手机号登录、退出、当前账号、
// 协议同意的门、版本门槛的判断）。用法见本目录的 README.md。改称呼、换绑手机号、已登录的微信、一次性提示的关闭、注销随 M2。
export { createIdentity } from "./service.js";
export type { Identity, IdentityDeps } from "./service.js";
export {
  hashSecret,
  issueToken,
  parseToken,
  secretMatches,
  SESSION_SECRET_BYTES,
  SESSION_TOKEN_PREFIX,
} from "./token.js";
export type { IssuedToken, ParsedToken } from "./token.js";
export {
  IDENTITY_ACTIVE_TOUCH_MS,
  MAX_SESSIONS_PER_IDENTITY,
  SESSION_ABSOLUTE_DAYS,
  SESSION_IDLE_DAYS,
} from "./sessions.js";
export type { SessionCheck, SessionRejection } from "./sessions.js";
export { openidHmac } from "./login.js";
export type { LoginDeps, PhoneLoginInput, PhoneLoginOptions, SilentLoginInput } from "./login.js";
export { noticeMessage } from "./me.js";
export { CONSENT_STAMP_CACHE_MS } from "./consent-gate.js";
export { deviceSummary } from "./types.js";
export type { RequestMeta, SessionPrincipal } from "./types.js";
export { IDENTITY_MACHINE_BINDINGS } from "./machines.js";
export type { RegisterArgs } from "./machines.js";
export {
  findI22Violations,
  findI23Violations,
  findI25Violations,
  findI8Violations,
  findI9Violations,
  IDENTITY_INVARIANT_LIMIT,
  OPENID_UNIQUE_INDEX,
  PHONE_UNIQUE_INDEX,
} from "./invariants.js";
export { registration } from "./register.js";
