// 后台请求客户端（D7 第 5.5 节；约定 C4、C22、C23、C45、C48）。
//   - 类型取自 @liyoxi/contract/types/admin（契约生成物）；与接口同源，带会话 cookie，不开 CORS。
//   - 一个中间件统一加请求头：X-Client-Version（构建号）、X-Request-Id（UUID）；
//     非 GET 另加 X-LYX-Admin: 1 与幂等键（调用方带了就用调用方的，一次意图一个键，见 idempotency.ts）。
//   - 响应按错误符号名统一处置（api-errors.ts）。会弹框或跳转的恢复动作单飞：并发的多个请求只跳一次登录、
//     共用一个再验证框；再验证通过后自动重放原请求（同一个幂等键）。
//   - 处置完仍把响应原样交还调用方：表单要用 fieldErrors，确认构件要处理 CONFIRM_MISMATCH。
// 页面包不直接调本文件里的工厂：取 app 里建好的那一个（src/app/services.ts）。
import type { paths as AdminPaths } from "@liyoxi/contract/types/admin";
import createClient, { type Client, type Middleware } from "openapi-fetch";

import { readFailure, requestIdTail, RETRY_RULES, type ApiFailure } from "./api-errors";
import { isValidIdempotencyKey, newIdempotencyKey } from "./idempotency";

export const API_BASE_URL = "/api/v1";

export interface ApiNotice {
  symbol: string;
  message: string;
  /** 请求编号后 8 位；只有 5xx 与编程错误带 */
  requestIdTail: string | null;
}

/** 处置动作由外壳注入：请求层不认识路由、弹框与查询缓存 */
export interface ApiHandlers {
  /** 记住当前地址后去登录页 */
  redirectToLogin(): void;
  /** 弹再验证框；通过返回 true。M0 没有登录，缺省实现返回 false（W1-02 接上） */
  stepUp(): Promise<boolean>;
  /** 重拉当前员工的权限与开关并刷新菜单 */
  refreshAccess(): void;
  /** 使相关查询失效 */
  invalidateQueries(): void;
  /** 全局提示 */
  notify(notice: ApiNotice): void;
  /** 整页说明：来源 IP 不允许、停机维护 */
  showBlocked(failure: ApiFailure): void;
  /** 回包头 X-Admin-Build 与页面的构建号不一致：提示“后台已更新，请刷新” */
  buildMismatch(serverBuild: string): void;
}

export interface AdminApiOptions {
  /** 构建号，随 X-Client-Version 带出 */
  build: string;
  handlers: ApiHandlers;
  baseUrl?: string;
  /** 缺省用全局 fetch；用例里换成假的 */
  fetch?: (request: Request) => Promise<Response>;
  /** 自动重试的等待；用例里换成不等的 */
  sleep?: (ms: number) => Promise<void>;
  newRequestId?: () => string;
}

export interface AdminApi<Paths extends object> {
  client: Client<Paths>;
  /** 登录成功后调：放开“只跳一次登录”的闩 */
  resetLoginLatch(): void;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** 统一加请求头的中间件。单独导出是为了用例与样例里能看到它加了什么 */
export function headerMiddleware(build: string, newRequestId: () => string): Middleware {
  return {
    onRequest({ request }) {
      request.headers.set("X-Client-Version", build);
      request.headers.set("X-Request-Id", newRequestId());
      if (!SAFE_METHODS.has(request.method.toUpperCase())) {
        request.headers.set("X-LYX-Admin", "1");
        const given = request.headers.get("Idempotency-Key");
        if (given === null) request.headers.set("Idempotency-Key", newIdempotencyKey("req"));
        else if (!isValidIdempotencyKey(given)) {
          throw new Error("幂等键不合格式：长度不超过 128，字符集 [A-Za-z0-9:_-]");
        }
      }
      return request;
    },
  };
}

export function createAdminApi<Paths extends object = AdminPaths>(
  options: AdminApiOptions,
): AdminApi<Paths> {
  const { build, handlers } = options;
  const baseFetch = options.fetch ?? ((request: Request) => globalThis.fetch(request));
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const newRequestId = options.newRequestId ?? (() => crypto.randomUUID());

  let loginRequested = false;
  let stepUpInFlight: Promise<boolean> | null = null;
  let buildMismatchReported = false;

  const loginOnce = (): void => {
    if (loginRequested) return;
    loginRequested = true;
    handlers.redirectToLogin();
  };

  const stepUpOnce = (): Promise<boolean> => {
    stepUpInFlight ??= handlers
      .stepUp()
      .catch(() => false)
      .finally(() => {
        stepUpInFlight = null;
      });
    return stepUpInFlight;
  };

  const notify = (failure: ApiFailure, withRequestId: boolean): void => {
    handlers.notify({
      symbol: failure.symbol,
      message: failure.message,
      requestIdTail: withRequestId ? requestIdTail(failure.requestId) : null,
    });
  };

  const checkBuild = (response: Response): void => {
    const serverBuild = response.headers.get("X-Admin-Build");
    if (!serverBuild || serverBuild === build || buildMismatchReported) return;
    buildMismatchReported = true;
    handlers.buildMismatch(serverBuild);
  };

  /** 重放用的副本：换一个请求编号，幂等键不变 */
  const replayCopy = (original: Request): Request => {
    const copy = original.clone();
    copy.headers.set("X-Request-Id", newRequestId());
    return copy;
  };

  const send = async (original: Request): Promise<Response> => {
    let retried = 0;
    let steppedUp = false;
    let request = original.clone();
    for (;;) {
      const response = await baseFetch(request);
      checkBuild(response);
      if (response.ok) return response;
      const failure = await readFailure(response);
      switch (failure.disposition) {
        case "retry": {
          const rule = RETRY_RULES[failure.symbol];
          if (rule && retried < rule.times) {
            retried += 1;
            await sleep(rule.delayMs);
            request = replayCopy(original);
            continue;
          }
          notify(failure, false);
          return response;
        }
        case "step-up": {
          if (!steppedUp && (await stepUpOnce())) {
            steppedUp = true;
            request = replayCopy(original);
            continue;
          }
          return response;
        }
        case "login":
          loginOnce();
          return response;
        case "refresh-access":
          notify(failure, false);
          handlers.refreshAccess();
          return response;
        case "invalidate":
          notify(failure, false);
          handlers.invalidateQueries();
          return response;
        case "blocked":
          handlers.showBlocked(failure);
          return response;
        case "toast":
          notify(failure, failure.status >= 500);
          return response;
        case "fatal":
          if (failure.status < 500) console.error("请求被拒：属编程错误", failure.symbol, failure);
          notify(failure, true);
          return response;
        case "field-errors":
        case "reconfirm":
        case "silent":
          return response;
      }
    }
  };

  const client = createClient<Paths>({
    baseUrl: options.baseUrl ?? API_BASE_URL,
    credentials: "same-origin",
    // 多值筛选用逗号分隔：status=pending,approved（约定 C45）
    querySerializer: { array: { style: "form", explode: false } },
    fetch: send,
  });
  client.use(headerMiddleware(build, newRequestId));

  return {
    client,
    resetLoginLatch() {
      loginRequested = false;
    },
  };
}
