// 请求客户端的用例（任务书 第 7 节第 6 条）：请求头、幂等键、按符号名分派、恢复动作单飞。
// 契约里现在一条后台路由都没有（W0-10 接管后才有），用例自带一份最小的 paths 类型。
import { COMMON_ERROR_SYMBOLS, COMMON_ERRORS, type ErrorBody } from "@liyoxi/contract/errors";
import { describe, expect, it, vi } from "vitest";

import { createAdminApi, type ApiHandlers } from "./api";
import {
  COMMON_ERROR_DISPOSITIONS,
  dispositionOf,
  fieldErrorsToFormFields,
  readFailure,
} from "./api-errors";
import { isValidIdempotencyKey, newIdempotencyKey } from "./idempotency";

type NoParams = { query?: never; header?: never; path?: never; cookie?: never };
type Json<T> = { headers: Record<string, unknown>; content: { "application/json": T } };

interface TestPaths {
  "/admin/things": {
    parameters: NoParams;
    get: {
      parameters: { query?: { page?: number; status?: string[] } } & Omit<NoParams, "query">;
      requestBody?: never;
      responses: { 200: Json<{ items: string[] }> };
    };
    post: {
      parameters: { header?: { "Idempotency-Key"?: string } } & Omit<NoParams, "header">;
      requestBody: { content: { "application/json": { name: string } } };
      responses: { 200: Json<{ id: string }> };
    };
    put?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const BUILD = "build-test-1";

const ok = (data: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json", ...headers },
  });

function failure(
  symbol: keyof typeof COMMON_ERRORS,
  extra: Record<string, unknown> = {},
): Response {
  const def = COMMON_ERRORS[symbol];
  const requestId = "0192f0c1-aaaa-7bbb-8ccc-1234567890ab";
  return new Response(
    JSON.stringify({
      code: def.code,
      error: symbol,
      message: def.message,
      retryable: def.retryable,
      requestId,
      ...extra,
    }),
    {
      status: def.http,
      headers: { "Content-Type": "application/json", "X-Request-Id": requestId },
    },
  );
}

function setup(respond: (request: Request, index: number) => Response | Promise<Response>) {
  const requests: Request[] = [];
  const handlers = {
    redirectToLogin: vi.fn(),
    stepUp: vi.fn(() => Promise.resolve(true)),
    refreshAccess: vi.fn(),
    invalidateQueries: vi.fn(),
    notify: vi.fn(),
    showBlocked: vi.fn(),
    buildMismatch: vi.fn(),
  } satisfies ApiHandlers;
  const sleep = vi.fn(() => Promise.resolve());
  const api = createAdminApi<TestPaths>({
    build: BUILD,
    handlers,
    baseUrl: "https://admin.example.test/api/v1",
    sleep,
    fetch: async (request) => {
      requests.push(request.clone());
      return respond(request, requests.length - 1);
    },
  });
  return { ...api, requests, handlers, sleep };
}

describe("请求头", () => {
  it("GET 自动带 X-Client-Version 与 X-Request-Id，不带防跨站头与幂等键", async () => {
    const { client, requests } = setup(() => ok({ items: [] }));
    const { data } = await client.GET("/admin/things", { params: { query: { page: 2 } } });
    expect(data).toEqual({ items: [] });
    const headers = requests[0]?.headers;
    expect(headers?.get("X-Client-Version")).toBe(BUILD);
    expect(headers?.get("X-Request-Id")).toMatch(UUID);
    expect(headers?.get("X-LYX-Admin")).toBeNull();
    expect(headers?.get("Idempotency-Key")).toBeNull();
    expect(requests[0]?.credentials).toBe("same-origin");
  });

  it("每次请求换一个 X-Request-Id", async () => {
    const { client, requests } = setup(() => ok({ items: [] }));
    await client.GET("/admin/things");
    await client.GET("/admin/things");
    expect(requests[0]?.headers.get("X-Request-Id")).not.toBe(
      requests[1]?.headers.get("X-Request-Id"),
    );
  });

  it("非 GET 带 X-LYX-Admin: 1 与幂等键；调用方没带时自动生成", async () => {
    const { client, requests } = setup(() => ok({ id: "t1" }));
    await client.POST("/admin/things", { body: { name: "甲" } });
    const headers = requests[0]?.headers;
    expect(headers?.get("X-LYX-Admin")).toBe("1");
    expect(headers?.get("X-Client-Version")).toBe(BUILD);
    expect(headers?.get("X-Request-Id")).toMatch(UUID);
    const key = headers?.get("Idempotency-Key") ?? "";
    expect(key).toMatch(/^req:[0-9a-f-]{36}$/);
    expect(isValidIdempotencyKey(key)).toBe(true);
  });

  it("调用方带了幂等键就用调用方的（一次意图一个键）；不合格式的直接拒发", async () => {
    const { client, requests } = setup(() => ok({ id: "t1" }));
    const key = newIdempotencyKey("thing-create");
    await client.POST("/admin/things", {
      body: { name: "甲" },
      params: { header: { "Idempotency-Key": key } },
    });
    expect(requests[0]?.headers.get("Idempotency-Key")).toBe(key);
    await expect(
      client.POST("/admin/things", {
        body: { name: "甲" },
        params: { header: { "Idempotency-Key": "bad key/with space" } },
      }),
    ).rejects.toThrow(/幂等键不合格式/);
    expect(requests).toHaveLength(1);
  });

  it("多值筛选用逗号分隔（约定 C45）", async () => {
    const { client, requests } = setup(() => ok({ items: [] }));
    await client.GET("/admin/things", {
      params: { query: { status: ["pending", "approved"] } },
    });
    expect(new URL(requests[0]?.url ?? "").search).toBe("?status=pending,approved");
  });

  it("幂等键：<动作名>:<uuid>，动作名不合规即抛错", () => {
    expect(newIdempotencyKey("refund-execute")).toMatch(/^refund-execute:[0-9a-f-]{36}$/);
    expect(() => newIdempotencyKey("退款")).toThrow();
    expect(isValidIdempotencyKey("a".repeat(129))).toBe(false);
  });
});

describe("按 error 符号名分派处置", () => {
  it("28 个通用码都有处置；领域码直接提示服务端文案", () => {
    expect(Object.keys(COMMON_ERROR_DISPOSITIONS).sort()).toEqual([...COMMON_ERROR_SYMBOLS].sort());
    expect(dispositionOf("POINTS_INSUFFICIENT")).toBe("toast");
    expect(dispositionOf("SESSION_INVALID")).toBe("login");
  });

  it("并发多个 AUTH_REQUIRED 只跳一次登录；登录后放开闩才会再跳", async () => {
    const { client, handlers, resetLoginLatch } = setup(() => failure("AUTH_REQUIRED"));
    const results = await Promise.all([
      client.GET("/admin/things"),
      client.GET("/admin/things"),
      client.POST("/admin/things", { body: { name: "甲" } }),
    ]);
    expect(results.map((result) => result.response.status)).toEqual([401, 401, 401]);
    expect(handlers.redirectToLogin).toHaveBeenCalledTimes(1);
    await client.GET("/admin/things");
    expect(handlers.redirectToLogin).toHaveBeenCalledTimes(1);
    resetLoginLatch();
    await client.GET("/admin/things");
    expect(handlers.redirectToLogin).toHaveBeenCalledTimes(2);
    expect(handlers.notify).not.toHaveBeenCalled();
  });

  it("SESSION_INVALID 同样去登录页", async () => {
    const { client, handlers } = setup(() => failure("SESSION_INVALID"));
    await client.GET("/admin/things");
    expect(handlers.redirectToLogin).toHaveBeenCalledTimes(1);
  });

  it("STEP_UP_REQUIRED：并发的请求共用一个再验证框，通过后各自重放，幂等键不变、请求编号换新", async () => {
    let release: (passed: boolean) => void = () => {};
    const { client, handlers, requests } = setup((_request, index) =>
      index < 2 ? failure("STEP_UP_REQUIRED") : ok({ id: `t${index}` }),
    );
    handlers.stepUp.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          release = resolve;
        }),
    );
    const first = client.POST("/admin/things", { body: { name: "甲" } });
    const second = client.POST("/admin/things", { body: { name: "乙" } });
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    release(true);
    const results = await Promise.all([first, second]);
    expect(handlers.stepUp).toHaveBeenCalledTimes(1);
    expect(results.map((result) => result.response.status)).toEqual([200, 200]);
    expect(requests).toHaveLength(4);
    const keyOf = (index: number) => requests[index]?.headers.get("Idempotency-Key");
    const idOf = (index: number) => requests[index]?.headers.get("X-Request-Id");
    const replays = [requests[2], requests[3]].map((request) =>
      request?.headers.get("Idempotency-Key"),
    );
    expect(replays.sort()).toEqual([keyOf(0), keyOf(1)].sort());
    expect(new Set([idOf(0), idOf(1), idOf(2), idOf(3)]).size).toBe(4);
    const bodies = await Promise.all([requests[2], requests[3]].map((request) => request?.json()));
    expect(bodies.map((body) => (body as { name: string }).name).sort()).toEqual(["乙", "甲"]);
  });

  it("再验证没通过：不重放，把 403 交还调用方", async () => {
    const { client, handlers, requests } = setup(() => failure("STEP_UP_REQUIRED"));
    handlers.stepUp.mockResolvedValue(false);
    const { response } = await client.POST("/admin/things", { body: { name: "甲" } });
    expect(response.status).toBe(403);
    expect(requests).toHaveLength(1);
  });

  it("PERMISSION_DENIED：提示并重拉权限", async () => {
    const { client, handlers } = setup(() => failure("PERMISSION_DENIED"));
    await client.GET("/admin/things");
    expect(handlers.refreshAccess).toHaveBeenCalledTimes(1);
    expect(handlers.notify).toHaveBeenCalledWith({
      symbol: "PERMISSION_DENIED",
      message: COMMON_ERRORS.PERMISSION_DENIED.message,
      requestIdTail: null,
    });
  });

  it("VERSION_CONFLICT、STATE_NOT_ALLOWED：提示并使查询失效", async () => {
    for (const symbol of ["VERSION_CONFLICT", "STATE_NOT_ALLOWED"] as const) {
      const { client, handlers } = setup(() => failure(symbol));
      await client.POST("/admin/things", { body: { name: "甲" } });
      expect(handlers.invalidateQueries, symbol).toHaveBeenCalledTimes(1);
      expect(handlers.notify, symbol).toHaveBeenCalledTimes(1);
    }
  });

  it("VALIDATION_FAILED、CONFIRM_MISMATCH：不弹全局提示，响应体原样交还调用方", async () => {
    const fieldErrors = [
      { path: "items.0.dramaId", message: "请选择短剧" },
      { path: "name", message: "名称不能为空" },
    ];
    const { client, handlers } = setup(() => failure("VALIDATION_FAILED", { fieldErrors }));
    const { error, response } = await client.POST("/admin/things", { body: { name: "" } });
    expect(handlers.notify).not.toHaveBeenCalled();
    expect(response.status).toBe(400);
    // openapi-fetch 已把响应体解析出来放在 error 里（这份最小的 paths 没声明错误响应，类型上是 undefined）
    const body = error as unknown as ErrorBody;
    expect(dispositionOf(body.error)).toBe("field-errors");
    expect(fieldErrorsToFormFields(body)).toEqual([
      { name: ["items", 0, "dramaId"], errors: ["请选择短剧"] },
      { name: ["name"], errors: ["名称不能为空"] },
    ]);
    const mismatch = setup(() => failure("CONFIRM_MISMATCH"));
    await mismatch.client.POST("/admin/things", { body: { name: "甲" } });
    expect(mismatch.handlers.notify).not.toHaveBeenCalled();
  });

  it("5xx：全局提示并带请求编号后 8 位", async () => {
    const { client, handlers } = setup(() => failure("INTERNAL"));
    await client.GET("/admin/things");
    expect(handlers.notify).toHaveBeenCalledWith({
      symbol: "INTERNAL",
      message: COMMON_ERRORS.INTERNAL.message,
      requestIdTail: "567890ab",
    });
  });

  it("IP_NOT_ALLOWED、MAINTENANCE：整页说明", async () => {
    for (const symbol of ["IP_NOT_ALLOWED", "MAINTENANCE"] as const) {
      const { client, handlers } = setup(() => failure(symbol));
      await client.GET("/admin/things");
      expect(handlers.showBlocked, symbol).toHaveBeenCalledTimes(1);
      expect(handlers.showBlocked.mock.calls[0]?.[0].symbol).toBe(symbol);
    }
  });

  it("领域错误码：直接提示服务端给的文案", async () => {
    const { client, handlers } = setup(
      () =>
        new Response(
          JSON.stringify({
            code: 43001,
            error: "POINTS_INSUFFICIENT",
            message: "可用积分不足，还差 200 积分",
            retryable: false,
            requestId: "r-1",
          }),
          { status: 409, headers: { "Content-Type": "application/json" } },
        ),
    );
    await client.POST("/admin/things", { body: { name: "甲" } });
    expect(handlers.notify).toHaveBeenCalledWith({
      symbol: "POINTS_INSUFFICIENT",
      message: "可用积分不足，还差 200 积分",
      requestIdTail: null,
    });
  });

  it("没有响应体时看 HTTP 状态（约定 C23）：网关的 401 去登录，502 提示，413 给通用说明", async () => {
    const bare = (status: number) => () => new Response("<html>gateway</html>", { status });
    const unauthorized = setup(bare(401));
    await unauthorized.client.GET("/admin/things");
    expect(unauthorized.handlers.redirectToLogin).toHaveBeenCalledTimes(1);
    const badGateway = setup(bare(502));
    await badGateway.client.GET("/admin/things");
    expect(badGateway.handlers.notify.mock.calls[0]?.[0].symbol).toBe("PROVIDER_UNAVAILABLE");
    const tooLarge = setup(bare(413));
    await tooLarge.client.POST("/admin/things", { body: { name: "甲" } });
    expect(tooLarge.handlers.notify.mock.calls[0]?.[0]).toMatchObject({ symbol: "HTTP_413" });
  });
});

describe("读出一次失败的响应", () => {
  it("先看响应体的 error，请求编号取回包头", async () => {
    const parsed = await readFailure(failure("VERSION_CONFLICT"));
    expect(parsed).toMatchObject({
      symbol: "VERSION_CONFLICT",
      status: 409,
      disposition: "invalidate",
      requestId: "0192f0c1-aaaa-7bbb-8ccc-1234567890ab",
    });
  });

  it("响应体不是错误体时按 HTTP 状态", async () => {
    const parsed = await readFailure(new Response("{}", { status: 504 }));
    expect(parsed).toMatchObject({ symbol: "UPSTREAM_TIMEOUT", body: null, disposition: "toast" });
    expect(parsed.message).toBe(COMMON_ERRORS.UPSTREAM_TIMEOUT.message);
  });
});

describe("自动重试与构建号", () => {
  it("IDEMPOTENCY_IN_PROGRESS：1 秒后用同一个幂等键重试，至多 5 次", async () => {
    const { client, requests, sleep, handlers } = setup((_request, index) =>
      index < 2 ? failure("IDEMPOTENCY_IN_PROGRESS") : ok({ id: "t1" }),
    );
    const { data } = await client.POST("/admin/things", { body: { name: "甲" } });
    expect(data).toEqual({ id: "t1" });
    expect(sleep.mock.calls).toEqual([[1000], [1000]]);
    expect(new Set(requests.map((request) => request.headers.get("Idempotency-Key"))).size).toBe(1);
    expect(handlers.notify).not.toHaveBeenCalled();

    const stuck = setup(() => failure("IDEMPOTENCY_IN_PROGRESS"));
    const result = await stuck.client.POST("/admin/things", { body: { name: "甲" } });
    expect(result.response.status).toBe(409);
    expect(stuck.requests).toHaveLength(6);
    expect(stuck.handlers.notify).toHaveBeenCalledTimes(1);
  });

  it("BUSY：600 毫秒后重试 1 次", async () => {
    const { client, requests, sleep } = setup(() => failure("BUSY"));
    await client.GET("/admin/things");
    expect(sleep.mock.calls).toEqual([[600]]);
    expect(requests).toHaveLength(2);
  });

  it("回包头 X-Admin-Build 与页面不一致：提示刷新，只提示一次；一致时不提示", async () => {
    const stale = setup(() => ok({ items: [] }, { "X-Admin-Build": "build-newer" }));
    await stale.client.GET("/admin/things");
    await stale.client.GET("/admin/things");
    expect(stale.handlers.buildMismatch.mock.calls).toEqual([["build-newer"]]);
    const same = setup(() => ok({ items: [] }, { "X-Admin-Build": BUILD }));
    await same.client.GET("/admin/things");
    expect(same.handlers.buildMismatch).not.toHaveBeenCalled();
  });
});
