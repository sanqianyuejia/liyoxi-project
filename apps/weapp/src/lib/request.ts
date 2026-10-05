// 请求层（D7 第 4.4 节；约定 C3、C17、C19、C20、C22、C23、C48）。借自参考工程的 request.ts，补了：
// 门店头、幂等键、超时与受控重试、并发闸、按符号名的统一处置、交互式恢复的单飞。没有刷新令牌：401 走静默登录。
// 本文件不碰小程序接口：发请求、读令牌与门店、各种恢复动作都从外面注入（runtime.ts 装配），用例里换替身。
import type { ErrorSymbol } from "@liyoxi/contract/errors";
import type { components } from "@liyoxi/contract/types/merchant";

import type { ClientInfo, Clock, HttpMethod, SendFn, WireRequest, WireResponse } from "./platform";

type ErrorBody = components["schemas"]["ErrorBody"];

export const API_PREFIX = "/api/v1";
/** 同时在途的业务请求上限：小程序一共 10 个并发额度，留 4 个给上传下载 */
export const MAX_CONCURRENT = 6;
const TIMEOUT_MS = 15_000;
const TIMEOUT_IDEMPOTENT_MS = 30_000;
/** 网络失败后的重试间隔：GET 一次；带幂等键的写两次；不带键的写不重试 */
const RETRY_GET_MS = [800];
const RETRY_IDEMPOTENT_MS = [1000, 3000];
const IN_PROGRESS_RETRY_MS = 1000;
const IN_PROGRESS_MAX_RETRIES = 5;
const BUSY_RETRY_MS = 600;
/** 用户拒绝协议后，这段时间内不再弹 */
const CONSENT_QUIET_MS = 30_000;

/**
 * 端上自己的错误符号：不是服务端给的。
 * NETWORK_ERROR 发不出去或没等到回包；NOT_CONFIGURED 没配接口基址；HTTP_<状态> 回包没有错误体，只有状态可看。
 */
export type ClientErrorSymbol = "NETWORK_ERROR" | "NOT_CONFIGURED" | `HTTP_${number}`;

/** 端上只按 error（符号名）判断；code 只用于日志与排障（约定 C22） */
export class ApiError extends Error {
  readonly error: ErrorSymbol | ClientErrorSymbol;
  readonly code: number;
  /** HTTP 状态；没发出去的为 0 */
  readonly status: number;
  readonly retryable: boolean;
  readonly requestId: string;
  readonly details: unknown;
  readonly fieldErrors: ErrorBody["fieldErrors"];

  constructor(init: {
    error: ErrorSymbol | ClientErrorSymbol;
    message: string;
    status: number;
    requestId: string;
    code?: number;
    retryable?: boolean;
    details?: unknown;
    fieldErrors?: ErrorBody["fieldErrors"];
  }) {
    super(init.message);
    this.name = "ApiError";
    this.error = init.error;
    this.code = init.code ?? 0;
    this.status = init.status;
    this.retryable = init.retryable ?? false;
    this.requestId = init.requestId;
    this.details = init.details;
    this.fieldErrors = init.fieldErrors;
  }
}

export interface RequestOptions {
  method?: HttpMethod;
  data?: unknown;
  /** 缺省 true：本地有令牌就带上。公开接口写 false */
  auth?: boolean;
  /** 幂等键 `<动作名>:<uuid>`：属于用户的一次意图，由页面生成并在重试时复用（约定 C48） */
  idempotencyKey?: string;
  /** 毫秒；缺省 15 秒，带幂等键的写 30 秒 */
  timeout?: number;
}

/**
 * 会弹框或会改全局状态的恢复动作。都是可选的：没接上的按“做不了”处理，请求照常以原来的错误结束。
 * 同一类恢复在途时，后来的请求共用同一次（约定 C20）。
 */
export interface Recoveries {
  /** wx.login 加 m.session.create（约定 C3）。ok 已拿到新令牌；needPhone 要走手机号登录；failed 没成 */
  silentLogin(): Promise<"ok" | "needPhone" | "failed">;
  /** 清本地会话。只在“本次确实带了令牌仍被拒”时调 */
  clearSession(): void;
  /** 回登录页 */
  gotoLogin(): void;
  /** 重拉 /m/me；当前门店失效时回到门店选择并提示 */
  reloadMe(): Promise<void>;
  /** 弹协议确认并提交同意。返回用户是否同意 */
  askConsent(details: unknown): Promise<boolean>;
  /** 提示更新 */
  showUpdatePrompt(): Promise<void>;
  /** 重拉引导数据（入口随之隐藏） */
  reloadBootstrap(): Promise<void>;
}

export interface RequestDeps {
  /** 接口基址，不含 /api/v1；空串表示没配，请求一律以 NOT_CONFIGURED 结束、不发出去 */
  baseUrl: string;
  send: SendFn;
  clock: Clock;
  uuid: () => string;
  client: () => ClientInfo;
  getToken: () => string | null;
  getStoreId: () => string | null;
  recover?: Partial<Recoveries>;
}

type RecoveryKind = "login" | "me" | "consent" | "outdated" | "bootstrap";

export interface RequestLayer {
  request<T>(path: string, options?: RequestOptions): Promise<T>;
  /** 接口基址配了没有。四个端上封装据此决定发不发 */
  isConfigured(): boolean;
  /** 此刻在途的业务请求数（用例与排障用） */
  inFlight(): number;
}

export function createRequestLayer(deps: RequestDeps): RequestLayer {
  const { clock } = deps;
  const base = deps.baseUrl.replace(/\/+$/, "");
  const recover = deps.recover ?? {};

  // ---- 并发闸：每一次真正发出去的请求占一个额度，等恢复、等重试的时候不占 ----
  let active = 0;
  const waiting: (() => void)[] = [];
  async function gated<R>(task: () => Promise<R>): Promise<R> {
    if (active >= MAX_CONCURRENT) await new Promise<void>((resolve) => waiting.push(resolve));
    else active += 1;
    try {
      return await task();
    } finally {
      const next = waiting.shift();
      // 额度直接交给下一个等着的，不先还回去，免得被后来者插队
      if (next) next();
      else active -= 1;
    }
  }

  // ---- 单飞恢复：同一类恢复在途时，后来者共用同一个 Promise ----
  const pending = new Map<RecoveryKind, Promise<unknown>>();
  function recoverOnce<R>(kind: RecoveryKind, run: () => Promise<R>): Promise<R> {
    const running = pending.get(kind) as Promise<R> | undefined;
    if (running) return running;
    const started = run().finally(() => pending.delete(kind));
    pending.set(kind, started);
    return started;
  }
  /** 恢复动作自己出错不盖住原来的错误 */
  async function quietly(
    kind: RecoveryKind,
    run: (() => Promise<void>) | undefined,
  ): Promise<void> {
    if (!run) return;
    try {
      await recoverOnce(kind, run);
    } catch {
      // 原来的错误照常抛给调用方
    }
  }
  let consentRefusedAt: number | null = null;

  function buildUrl(path: string): string {
    const normalized = path.startsWith("/") ? path : `/${path}`;
    return normalized.startsWith(`${API_PREFIX}/`)
      ? `${base}${normalized}`
      : `${base}${API_PREFIX}${normalized}`;
  }

  /** 组头（约定 C17）。请求编号与幂等键在重放时沿用，令牌每次重新读 */
  function buildHeader(
    requestId: string,
    token: string | null,
    options: RequestOptions,
  ): Record<string, string> {
    const client = deps.client();
    const header: Record<string, string> = {
      "content-type": "application/json",
      "X-Client-Platform": client.platform,
      "X-Client-Version": client.version,
      "X-Env-Version": client.envVersion,
      "X-Request-Id": requestId,
    };
    const storeId = deps.getStoreId();
    if (storeId) header["X-Store-Id"] = storeId;
    if (token) header.Authorization = `Bearer ${token}`;
    if (options.idempotencyKey) header["Idempotency-Key"] = options.idempotencyKey;
    return header;
  }

  /** 发一次；网络失败按规则重试。重试用同一个请求（同一组头） */
  async function sendWithRetry(wire: WireRequest, retryDelays: number[]): Promise<WireResponse> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await gated(() => deps.send(wire));
      } catch {
        const delay = retryDelays[attempt];
        if (delay === undefined) {
          throw new ApiError({
            error: "NETWORK_ERROR",
            message: "网络异常，请检查网络后重试",
            status: 0,
            requestId: wire.header["X-Request-Id"] ?? "",
          });
        }
        await clock.sleep(delay);
      }
    }
  }

  /** 读回包：先看响应体的 error，没有响应体再看 HTTP 状态（约定 C23） */
  function toError(response: WireResponse, requestId: string): ApiError {
    const { statusCode: status, data } = response;
    if (
      typeof data === "object" &&
      data !== null &&
      typeof (data as ErrorBody).error === "string"
    ) {
      const body = data as ErrorBody;
      return new ApiError({
        error: body.error as ErrorSymbol,
        message: body.message || `请求失败（${status}）`,
        status,
        requestId: body.requestId || requestId,
        code: body.code,
        retryable: body.retryable,
        details: body.details,
        fieldErrors: body.fieldErrors,
      });
    }
    const byStatus: Record<number, ErrorSymbol> = {
      401: "AUTH_REQUIRED",
      426: "CLIENT_OUTDATED",
      428: "CONSENT_REQUIRED",
      429: "RATE_LIMITED",
    };
    return new ApiError({
      error: byStatus[status] ?? `HTTP_${status}`,
      message: `请求失败（${status}）`,
      status,
      requestId,
    });
  }

  async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const method = options.method ?? "GET";
    const auth = options.auth ?? true;
    const requestId = deps.uuid();
    if (base === "") {
      throw new ApiError({
        error: "NOT_CONFIGURED",
        message: "还没有配置接口地址",
        status: 0,
        requestId,
      });
    }
    const retryDelays =
      method === "GET" ? RETRY_GET_MS : options.idempotencyKey ? RETRY_IDEMPOTENT_MS : [];
    const timeout =
      options.timeout ?? (options.idempotencyKey ? TIMEOUT_IDEMPOTENT_MS : TIMEOUT_MS);
    let loginReplayed = false;
    let consentReplayed = false;
    let busyRetried = false;
    let inProgressRetries = 0;

    for (;;) {
      const token = auth ? deps.getToken() : null;
      const response = await sendWithRetry(
        {
          url: buildUrl(path),
          method,
          header: buildHeader(requestId, token, options),
          data: options.data,
          timeout,
        },
        retryDelays,
      );
      const body = response.data as { code?: unknown; data?: unknown } | null;
      const ok = response.statusCode >= 200 && response.statusCode < 300;
      if (ok && typeof body === "object" && body !== null && body.code === 0) return body.data as T;

      const error = toError(response, requestId);
      switch (error.error) {
        case "AUTH_REQUIRED":
        case "SESSION_INVALID": {
          if (!auth) throw error;
          if (!loginReplayed) {
            // 等回包的这段时间里别的请求已经登好了：直接拿新令牌重放，不再登一次
            const current = deps.getToken();
            const outcome =
              current !== null && current !== token
                ? "ok"
                : await recoverOnce(
                    "login",
                    recover.silentLogin ?? (async () => "failed" as const),
                  ).catch(() => "failed" as const);
            if (outcome === "ok") {
              loginReplayed = true;
              continue;
            }
            // 只有“带着令牌发出去仍被拒”才说明本地登录态失效；没带令牌的 401 说明不了什么，不清会话
            if (token !== null) recover.clearSession?.();
            if (token !== null || outcome === "needPhone") recover.gotoLogin?.();
            throw error;
          }
          if (token !== null) {
            recover.clearSession?.();
            recover.gotoLogin?.();
          }
          throw error;
        }
        case "NOT_A_MEMBER":
          await quietly("me", recover.reloadMe);
          throw error;
        case "CONSENT_REQUIRED": {
          const quiet =
            consentRefusedAt !== null && clock.now() - consentRefusedAt < CONSENT_QUIET_MS;
          if (consentReplayed || quiet || !recover.askConsent) throw error;
          const ask = recover.askConsent;
          const agreed = await recoverOnce("consent", () => ask(error.details)).catch(() => false);
          if (!agreed) {
            consentRefusedAt = clock.now();
            throw error;
          }
          consentReplayed = true;
          continue;
        }
        case "CLIENT_OUTDATED":
          await quietly("outdated", recover.showUpdatePrompt);
          throw error;
        case "FEATURE_DISABLED":
          await quietly("bootstrap", recover.reloadBootstrap);
          throw error;
        case "IDEMPOTENCY_IN_PROGRESS":
          if (inProgressRetries >= IN_PROGRESS_MAX_RETRIES) throw error;
          inProgressRetries += 1;
          await clock.sleep(IN_PROGRESS_RETRY_MS);
          continue;
        case "BUSY":
          if (busyRetried) throw error;
          busyRetried = true;
          await clock.sleep(BUSY_RETRY_MS);
          continue;
        default:
          throw error;
      }
    }
  }

  return { request, isConfigured: () => base !== "", inFlight: () => active };
}

/** 生成幂等键：进入确认页或打开确认弹层时调一次，存在页面状态里，该意图下的重试都用它（约定 C48） */
export function newIdempotencyKey(action: string, uuid: () => string): string {
  return `${action}:${uuid()}`;
}
