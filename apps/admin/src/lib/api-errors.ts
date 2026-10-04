// 统一错误处置：按错误符号名分派（约定 C22、C23、C27；D7 第 5.5 节）。端上只看 error，不看数值码。
// D7 写的 SESSION_REVOKED 已按约定 C27 作废，这里用 SESSION_INVALID。
import {
  COMMON_ERRORS,
  isCommonErrorSymbol,
  type CommonErrorSymbol,
  type ErrorBody,
} from "@liyoxi/contract/errors";

/**
 * 处置方式：
 *   login          记住当前地址后去登录页；并发多个只跳一次
 *   step-up        弹再验证框，通过后自动重放原请求；并发多个共用一个框
 *   refresh-access 提示，并重拉当前员工的权限与开关、刷新菜单
 *   field-errors   不弹全局提示：由表单按 fieldErrors 就地标红
 *   reconfirm      不弹全局提示：由确认构件刷新详情后让操作人重新确认
 *   invalidate     提示，并使相关查询失效
 *   retry          用同一个幂等键自动重试，次数用完仍失败则提示
 *   blocked        整页说明（来源 IP 不允许、停机维护）
 *   toast          直接提示服务端给的文案
 *   fatal          提示并带请求编号后 8 位；编程错误另打到控制台
 *   silent         什么都不做：调用方自己处理（登录页的统一文案）
 */
export type ErrorDisposition =
  | "login"
  | "step-up"
  | "refresh-access"
  | "field-errors"
  | "reconfirm"
  | "invalidate"
  | "retry"
  | "blocked"
  | "toast"
  | "fatal"
  | "silent";

/** 28 个通用码逐个定处置；漏一个编译不过 */
export const COMMON_ERROR_DISPOSITIONS: Readonly<Record<CommonErrorSymbol, ErrorDisposition>> = {
  VALIDATION_FAILED: "field-errors",
  IDEMPOTENCY_KEY_REQUIRED: "fatal",
  AUTH_REQUIRED: "login",
  SESSION_INVALID: "login",
  AUTH_FAILED: "silent",
  PERMISSION_DENIED: "refresh-access",
  NOT_A_MEMBER: "toast",
  ROLE_FORBIDDEN: "toast",
  STEP_UP_REQUIRED: "step-up",
  ORIGIN_REJECTED: "fatal",
  FEATURE_DISABLED: "refresh-access",
  IP_NOT_ALLOWED: "blocked",
  NOT_FOUND: "toast",
  VERSION_CONFLICT: "invalidate",
  STATE_NOT_ALLOWED: "invalidate",
  IDEMPOTENCY_KEY_REUSED: "fatal",
  IDEMPOTENCY_IN_PROGRESS: "retry",
  CONFIRM_MISMATCH: "reconfirm",
  PRECONDITION_CHANGED: "invalidate",
  REMINDED_TODAY: "toast",
  CLIENT_OUTDATED: "toast",
  CONSENT_REQUIRED: "toast",
  RATE_LIMITED: "toast",
  INTERNAL: "fatal",
  PROVIDER_UNAVAILABLE: "toast",
  UPSTREAM_TIMEOUT: "toast",
  BUSY: "retry",
  MAINTENANCE: "blocked",
};

/** 自动重试的间隔与次数（约定 C27）：处理中 1 秒后重试、至多 5 次；系统繁忙 600 毫秒后重试 1 次 */
export const RETRY_RULES: Readonly<Record<string, { delayMs: number; times: number }>> = {
  IDEMPOTENCY_IN_PROGRESS: { delayMs: 1000, times: 5 },
  BUSY: { delayMs: 600, times: 1 },
};

/** 没有响应体时按 HTTP 状态推一个符号名（约定 C23 的第二通道：网关直接返回的 413、502 等） */
const STATUS_FALLBACK: Readonly<Record<number, CommonErrorSymbol>> = {
  401: "AUTH_REQUIRED",
  403: "PERMISSION_DENIED",
  404: "NOT_FOUND",
  426: "CLIENT_OUTDATED",
  429: "RATE_LIMITED",
  500: "INTERNAL",
  502: "PROVIDER_UNAVAILABLE",
  503: "PROVIDER_UNAVAILABLE",
  504: "UPSTREAM_TIMEOUT",
};

export interface ApiFailure {
  /** 错误符号名；没有响应体又对不上已知状态时是 HTTP_<状态> */
  symbol: string;
  status: number;
  message: string;
  /** 回包头 X-Request-Id，没有时取响应体里的 */
  requestId: string | null;
  /** 响应体；网关直接返回、解析不出来时为 null */
  body: ErrorBody | null;
  disposition: ErrorDisposition;
}

export function dispositionOf(symbol: string): ErrorDisposition {
  // 领域错误码没有特殊处置的，直接提示服务端的文案（约定 C22）
  return isCommonErrorSymbol(symbol) ? COMMON_ERROR_DISPOSITIONS[symbol] : "toast";
}

function isErrorBody(value: unknown): value is ErrorBody {
  if (typeof value !== "object" || value === null) return false;
  const body = value as Record<string, unknown>;
  return typeof body.error === "string" && typeof body.message === "string";
}

/** 读出一次失败的响应：先看响应体的 error，没有响应体再看 HTTP 状态（约定 C23） */
export async function readFailure(response: Response): Promise<ApiFailure> {
  let body: ErrorBody | null = null;
  try {
    const parsed: unknown = await response.clone().json();
    if (isErrorBody(parsed)) body = parsed;
  } catch {
    body = null;
  }
  const fallback = STATUS_FALLBACK[response.status];
  const symbol = body?.error ?? fallback ?? `HTTP_${response.status}`;
  const message =
    body?.message ??
    (fallback
      ? COMMON_ERRORS[fallback].message
      : `请求没有成功（HTTP ${response.status}），请稍后重试`);
  return {
    symbol,
    status: response.status,
    message,
    requestId: response.headers.get("X-Request-Id") ?? body?.requestId ?? null,
    body,
    disposition: dispositionOf(symbol),
  };
}

/** 报错提示里带的请求编号：后 8 位（约定 C22） */
export function requestIdTail(requestId: string | null): string | null {
  return requestId ? requestId.slice(-8) : null;
}

/** VALIDATION_FAILED 的 fieldErrors → antd Form 的 setFields 入参：点分路径拆成数组，数字段转成下标 */
export function fieldErrorsToFormFields(
  body: ErrorBody | null,
): { name: (string | number)[]; errors: string[] }[] {
  const merged = new Map<string, { name: (string | number)[]; errors: string[] }>();
  for (const item of body?.fieldErrors ?? []) {
    const name = item.path.split(".").map((part) => (/^\d+$/.test(part) ? Number(part) : part));
    const entry = merged.get(item.path) ?? { name, errors: [] };
    entry.errors.push(item.message);
    merged.set(item.path, entry);
  }
  return [...merged.values()];
}
