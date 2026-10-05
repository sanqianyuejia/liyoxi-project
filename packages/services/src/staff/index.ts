// W0-21 种子：8 个角色；staff.I8 的 SQL 断言
export { seed } from "./seed.js";
export { staffSeedAssertions } from "./invariants.js";
// W1-01a 凭据与会话：进程启动时调一次 createStaffAuth，拿到九个接口对应的用例与引导用例。用法见本目录的 README.md
export { createStaffAuth } from "./service.js";
export type { StaffAuth } from "./service.js";
export type {
  AuthNext,
  RequestMeta,
  SecondFactorMethod,
  SignedIn,
  StaffAuthDeps,
  StaffDb,
  StaffPrincipal,
  StaffSessionView,
} from "./types.js";
export type { LoginInput, StepUpInput, VerifyMfaInput } from "./login.js";
export type { BootstrapResult } from "./bootstrap.js";
export type { RoleCache, RoleRow } from "./roles.js";
// W1-01a 给后面的包用的函数：都收事务句柄，与调用方的业务写同事务（禁用、重置密码、重置第二因子、新增与启用）
export { ACTIVATION_TTL_MS, issueActivationCode } from "./activation.js";
export type { IssuedActivation, TotpEnrollment } from "./activation.js";
export {
  newSessionToken,
  revokeSession,
  revokeStaffSessions,
  SESSION_ABSOLUTE_MS,
  SESSION_IDLE_MS,
  sessionTokenHash,
  staffCookieNames,
  STEP_UP_TTL_MS,
} from "./session.js";
export type { SessionAuthMethod, SessionRevokeReason } from "./session.js";
export { DEVICE_COOKIE_DAYS, TICKET_TTL_MS } from "./ticket.js";
export { base32Decode, hotp, totpStep } from "./totp.js";
export { PASSWORD_RULES, passwordViolations } from "./password.js";
export type { PasswordRule } from "./password.js";
export { lockStaff } from "./repo.js";
// 本模块的登记：staff.I8 进不变量框架（W0-24）；staff.status 的守卫与随迁列，三条清理项（W1-01a）
export { registration } from "./register.js";
