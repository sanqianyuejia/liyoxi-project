// 通用错误码 28 个（约定 C27）。符号、数值、HTTP、可重试逐行照抄；默认文案按设计规范第 7 节的文案规则写。
// 对账基准：docs/api/registry-errors.md 第 1 节，由契约自测逐行核对。
// AUTH_REQUIRED、SESSION_INVALID 的“可重试”在约定里写“—”，这里取 false（约定 C26 的“为真”清单不含它们）。
import type { ErrorCodeDef } from "./types.js";

/** 一行一个码：数值、HTTP、可重试、默认文案、是否带 details */
const def = (
  code: number,
  http: ErrorCodeDef["http"],
  retryable: boolean,
  message: string,
  hasDetails = false,
): ErrorCodeDef => ({ code, http, retryable, message, hasDetails });

export const COMMON_ERRORS = {
  VALIDATION_FAILED: def(40001, 400, false, "提交的内容有误，请检查后重试"),
  IDEMPOTENCY_KEY_REQUIRED: def(40002, 400, false, "操作未完成，请刷新页面后重试"),
  AUTH_REQUIRED: def(40101, 401, false, "请先登录"),
  SESSION_INVALID: def(40102, 401, false, "登录已失效，请重新登录"),
  AUTH_FAILED: def(40103, 401, false, "账号或验证信息不正确，请重新输入"),
  PERMISSION_DENIED: def(40301, 403, false, "没有该操作的权限，请联系管理员开通"),
  NOT_A_MEMBER: def(40302, 403, false, "您不是该门店的成员，请重新选择门店"),
  ROLE_FORBIDDEN: def(40303, 403, false, "仅老板可操作"),
  STEP_UP_REQUIRED: def(40304, 403, false, "为了账号安全，请先完成身份验证"),
  ORIGIN_REJECTED: def(40305, 403, false, "请求来源不被允许，请刷新页面后重试"),
  FEATURE_DISABLED: def(40306, 403, false, "该功能暂未开放"),
  IP_NOT_ALLOWED: def(40307, 403, false, "当前网络不在允许访问的范围内，请联系管理员"),
  NOT_FOUND: def(40401, 404, false, "内容不存在或已被移除"),
  VERSION_CONFLICT: def(40901, 409, false, "内容已被他人修改，请刷新后重试", true),
  STATE_NOT_ALLOWED: def(40902, 409, false, "该事项已被处理，请刷新后查看"),
  IDEMPOTENCY_KEY_REUSED: def(40903, 409, false, "请求重复，请刷新页面后重新操作"),
  IDEMPOTENCY_IN_PROGRESS: def(40904, 409, true, "正在处理中，请稍候"),
  CONFIRM_MISMATCH: def(40905, 409, false, "确认信息与当前内容不一致，请刷新后重新确认"),
  PRECONDITION_CHANGED: def(40906, 409, false, "相关信息已发生变化，请刷新后重试"),
  REMINDED_TODAY: def(40920, 409, false, "今天已催办过，请明天再试", true),
  CLIENT_OUTDATED: def(42601, 426, false, "当前版本过低，请更新后使用"),
  CONSENT_REQUIRED: def(42801, 428, false, "请先阅读并同意最新协议", true),
  RATE_LIMITED: def(42901, 429, true, "操作过于频繁，请稍后再试"),
  INTERNAL: def(50000, 500, false, "服务异常，请稍后重试"),
  PROVIDER_UNAVAILABLE: def(50001, 503, true, "服务暂时不可用，请稍后重试"),
  UPSTREAM_TIMEOUT: def(50002, 504, true, "服务响应超时，请稍后重试"),
  BUSY: def(50003, 503, true, "系统繁忙，请稍后重试"),
  MAINTENANCE: def(50004, 503, true, "系统维护中，请稍后再来"),
} as const satisfies Record<string, ErrorCodeDef>;

/** 通用错误码的符号名 */
export type CommonErrorSymbol = keyof typeof COMMON_ERRORS;

/** 28 个符号名，按约定 C27 的行序 */
export const COMMON_ERROR_SYMBOLS = Object.keys(COMMON_ERRORS) as CommonErrorSymbol[];

export function isCommonErrorSymbol(value: unknown): value is CommonErrorSymbol {
  return typeof value === "string" && Object.hasOwn(COMMON_ERRORS, value);
}

/**
 * 带 details 的通用码及其类型（约定 C27 的第二张表，另有 C52 的 VERSION_CONFLICT）。Zod 结构在 common/error-details.ts，
 * 契约自测保证两边的符号与类型一致。
 */
export interface CommonErrorDetails {
  /**
   * 库里的最新版本，键是请求里那个版本字段的名字（约定 C52）：通常是 { lockVersion }；
   * 列名不是 lock_version 的几处例外，键随请求字段（draftLockVersion、baseRevNo 等）
   */
  VERSION_CONFLICT: Record<string, number>;
  /** PendingConsent 归 m01（约定 C87），随 m01 的第一个后端 PR 定义；这里只留占位 */
  CONSENT_REQUIRED: { pendingConsents: PendingConsentPlaceholder[] };
  /** nextAvailableDate 是下次可催办的日期，YYYY-MM-DD（约定 C35） */
  REMINDED_TODAY: { scene: string; nextAvailableDate: string };
}

/** 占位：m01 定义 PendingConsent 之后换成它 */
export type PendingConsentPlaceholder = Record<string, unknown>;
