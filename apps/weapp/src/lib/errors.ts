// 错误上报：自研上报器（D7 第 4.13 节；任务书 W0-27a 第 11 节第 3 项）。
// 没有用 sentry-miniapp：它在 Taro 的 Vite 构建下能过，但主包多出 157KB，超过 80KB 的预算
//（结论与数字见 docs/plan/external-verification/d7-09-error-reporting-taro-vite.md）。
// 这里用同样的钩子收集错误，拼成 Sentry 信封，发给自有域名的转发接口 m.clientError.create
//（POST /m/client-errors，立即 202，不等上游）。上报函数没接上、或没配 DSN：不发请求。
// 清洗：不带请求体与令牌；形如手机号、统一社会信用代码、会话令牌的字符串打码；用户只带 id。
// 上报自己出错不再上报、不抛出；同一条错误一次会话只报一次，每分钟至多 10 条。
import type { ClientPlatform, Clock, EnvVersion } from "./platform";

/** 错误的来路，写进信封的 tags.kind */
export type ErrorKind =
  | "error" // onError
  | "unhandledrejection" // onUnhandledRejection
  | "page_not_found"
  | "api" // 接口 5xx 与网络错误，带请求编号
  | "payment" // requestPayment 非取消类失败
  | "upload"
  | "download"
  | "handler"; // 页面处理函数里接住的

export const ERROR_REPORTS_PER_MINUTE = 10;
const MINUTE_MS = 60_000;
const MAX_TEXT = 2000;

// 左边界不用后行断言：iOS 上小程序的逻辑层跑在系统的 JavaScriptCore 里，16.4 之前不认 (?<!…)，
// 正则在模块顶层，一加载就抛 SyntaxError，app.js 起不来。改用前缀捕获组，替换时用 $1 放回。
const PHONE = /(^|\D)1[3-9]\d{9}(?!\d)/g;
/** 统一社会信用代码：18 位，字母不含 I、O、S、V、Z */
const USCC = /(^|[^0-9A-Z])[0-9A-HJ-NPQRTUWXY]{2}\d{6}[0-9A-HJ-NPQRTUWXY]{10}(?![0-9A-Z])/g;
const SESSION_TOKEN = /lyxm_[A-Za-z0-9._-]+/g;
const BEARER = /Bearer\s+[A-Za-z0-9._~+/=-]+/gi;

/** 文本清洗：令牌、手机号、统一社会信用代码打码，并截断 */
export function scrub(text: string): string {
  return text
    .replace(SESSION_TOKEN, "[token]")
    .replace(BEARER, "Bearer [token]")
    .replace(USCC, "$1[uscc]")
    .replace(PHONE, "$1[phone]")
    .slice(0, MAX_TEXT);
}

export interface ErrorReporterDeps {
  clock: Clock;
  uuid: () => string;
  /** Sentry 的 DSN（公开部分）；空串表示没配。转发接口按它核对项目白名单 */
  dsn: string;
  /** 把信封原文发给 m.clientError.create；没接上时返回 undefined */
  sender(): ((envelope: string) => Promise<unknown>) | undefined;
  client(): { version: string; platform: ClientPlatform; envVersion: EnvVersion };
  /** 当前用户的 id；没登录为 null */
  getUserId(): string | null;
}

export function createErrorReporter(deps: ErrorReporterDeps) {
  const seen = new Set<string>();
  let windowStart = 0;
  let sentInWindow = 0;

  function describe(error: unknown): { type: string; value: string; stack?: string } {
    if (error instanceof Error) {
      return { type: error.name || "Error", value: error.message, stack: error.stack };
    }
    if (typeof error === "string") return { type: "Error", value: error };
    try {
      return { type: "Error", value: JSON.stringify(error) ?? String(error) };
    } catch {
      return { type: "Error", value: String(error) };
    }
  }

  /** 拼信封：信封头、条目头、事件，三行 */
  function envelope(kind: ErrorKind, error: unknown, extra: Record<string, string>): string {
    const client = deps.client();
    const now = deps.clock.now();
    const eventId = deps.uuid().replaceAll("-", "");
    const { type, value, stack } = describe(error);
    const userId = deps.getUserId();
    const event = {
      event_id: eventId,
      timestamp: now / 1000,
      platform: "javascript",
      level: "error",
      release: client.version,
      environment: client.envVersion,
      tags: {
        kind,
        clientPlatform: client.platform,
        ...Object.fromEntries(Object.entries(extra).map(([key, text]) => [key, scrub(text)])),
      },
      ...(userId ? { user: { id: userId } } : {}),
      exception: {
        values: [
          { type: scrub(type), value: scrub(value), ...(stack ? { stack: scrub(stack) } : {}) },
        ],
      },
    };
    return [
      JSON.stringify({ event_id: eventId, sent_at: new Date(now).toISOString(), dsn: deps.dsn }),
      JSON.stringify({ type: "event" }),
      JSON.stringify(event),
    ].join("\n");
  }

  /**
   * 报一条错误。extra 只放短标识（请求编号、页面路径、错误符号名），不放请求体。
   * 永不抛错：上报是旁路，不能影响业务流程。
   */
  function capture(kind: ErrorKind, error: unknown, extra: Record<string, string> = {}): void {
    try {
      const send = deps.sender();
      if (!send || deps.dsn === "") return;
      const { type, value } = describe(error);
      const fingerprint = `${kind}|${type}|${value}`;
      if (seen.has(fingerprint)) return;
      const now = deps.clock.now();
      if (now - windowStart >= MINUTE_MS) {
        windowStart = now;
        sentInWindow = 0;
      }
      if (sentInWindow >= ERROR_REPORTS_PER_MINUTE) return;
      sentInWindow += 1;
      seen.add(fingerprint);
      void send(envelope(kind, error, extra)).catch(() => undefined);
    } catch {
      // 上报自己出错：不再上报，不抛出
    }
  }

  return { capture };
}
