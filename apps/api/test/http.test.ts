// 接口层用例：请求编号、访问日志、Host 判断、入参校验、错误映射、四组挂载（任务书 W0-22 第 7 节第 1 条）。
// 走接口测试支架：整个应用建起来，连本文件的测试库；样例路由见 fixtures.ts。
import { COMMON_ERRORS } from "@liyoxi/contract";
import { uuidv7 } from "@liyoxi/services";
import { describe, expect, it } from "vitest";

import { fakeAuth, stubMiddleware, useTestApi } from "../src/testing/index.js";

import { SAMPLE_HANDLERS } from "./fixtures.js";

const testApi = useTestApi();
const TIMEOUT = { timeout: 60_000 };

const userId = uuidv7();
const thingId = uuidv7();
const start = () =>
  testApi.start({
    handlers: SAMPLE_HANDLERS,
    middlewares: [
      fakeAuth({ actor: { type: "merchant", id: userId, client: "weapp", role: "owner" } }),
      stubMiddleware("signature"),
    ],
  });

describe("请求编号", () => {
  it("合法的 UUID 沿用并原样返回；不合法的丢弃重发；错误响应也带", TIMEOUT, async () => {
    const { request } = await start();
    const given = "0192A3B4-c5d6-7e8f-9a0b-1c2d3e4f5a6b";
    const kept = await request(`/api/v1/m/lyxtest-things/${thingId}`, {
      headers: { "X-Request-Id": given },
    });
    expect(kept.status).toBe(200);
    expect(kept.headers.get("X-Request-Id")).toBe(given);

    const replaced = await request(`/api/v1/m/lyxtest-things/${thingId}`, {
      headers: { "X-Request-Id": "'; DROP TABLE x; --" },
    });
    expect(replaced.headers.get("X-Request-Id")).toMatch(/^[0-9a-f-]{36}$/);

    const missing = await request("/api/v1/m/no-such-route");
    expect(missing.status).toBe(404);
    const body = (await missing.json()) as { requestId: string };
    expect(body.requestId).toBe(missing.headers.get("X-Request-Id"));
    expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("访问日志", () => {
  it(
    "一次请求一条：方法、命中的路由、状态、耗时、请求编号、操作人；查询参数里的凭证被遮住",
    TIMEOUT,
    async () => {
      const { request, logs } = await start();
      const response = await request(
        `/api/v1/m/lyxtest-things/${thingId}?token=tok-123&code=wx-code`,
      );
      expect(response.status).toBe(200);
      const line = logs.find((entry) => entry.evt === "http");
      expect(line).toMatchObject({
        level: "info",
        method: "GET",
        route: "/api/v1/m/lyxtest-things/:thingId",
        status: 200,
        reqId: response.headers.get("X-Request-Id"),
      });
      expect(String(line?.url)).toBe(`/api/v1/m/lyxtest-things/${thingId}?token=***&code=***`);
      expect(JSON.stringify(logs)).not.toContain("tok-123");
      expect(JSON.stringify(logs)).not.toContain("wx-code");
      expect(typeof line?.ms).toBe("number");
    },
  );

  it("带身份的请求记下操作人；4xx 记 warn", TIMEOUT, async () => {
    const { request, logs } = await start();
    const response = await request(`/api/v1/m/lyxtest-things/${thingId}`, {
      method: "PUT",
      json: { name: "样例", count: 1 },
      headers: { "Idempotency-Key": `update:${uuidv7()}` },
    });
    expect(response.status).toBe(200);
    expect(logs.find((entry) => entry.evt === "http")).toMatchObject({
      level: "info",
      status: 200,
      actor: { type: "merchant", id: userId },
    });
    await request("/api/v1/m/lyxtest-things/not-a-uuid");
    expect(logs.filter((entry) => entry.evt === "http").at(-1)).toMatchObject({
      level: "warn",
      status: 400,
    });
  });
});

describe("Host 判断", () => {
  it("域名与分组不配即 404；配得上的照常", TIMEOUT, async () => {
    const { request } = await start();
    const admin = { host: "admin.liyoxi.timavia.com" };
    const api = { host: "api.liyoxi.timavia.com" };
    const portal = { host: "portal.stg.liyoxi.timavia.com" };

    expect((await request("/api/v1/admin/lyxtest-things", { headers: admin })).status).toBe(200);
    expect((await request("/api/v1/admin/lyxtest-things", { headers: api })).status).toBe(404);
    expect((await request(`/api/v1/m/lyxtest-things/${thingId}`, { headers: api })).status).toBe(
      200,
    );
    expect((await request(`/api/v1/m/lyxtest-things/${thingId}`, { headers: admin })).status).toBe(
      404,
    );
    expect(
      (await request("/api/v1/portal/lyxtest-things/current", { headers: portal })).status,
    ).toBe(200);
    expect((await request("/api/v1/portal/lyxtest-things/current", { headers: api })).status).toBe(
      404,
    );
    expect((await request("/healthz", { headers: admin })).status).toBe(404);
    expect((await request("/internal/health/flow", { headers: api })).status).toBe(404);

    const denied = await request("/api/v1/admin/lyxtest-things", { headers: api });
    expect(await denied.json()).toMatchObject({ error: "NOT_FOUND", code: 40401 });
  });
});

describe("入参校验", () => {
  it("请求体不合结构：400 VALIDATION_FAILED，fieldErrors 指到字段", TIMEOUT, async () => {
    const { request } = await start();
    const response = await request(`/api/v1/m/lyxtest-things/${thingId}`, {
      method: "PUT",
      json: { name: "", count: -1 },
      headers: { "Idempotency-Key": `update:${uuidv7()}` },
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { fieldErrors: { path: string }[] };
    expect(body).toMatchObject({ code: 40001, error: "VALIDATION_FAILED", retryable: false });
    expect(body.fieldErrors.map((item) => item.path).sort()).toEqual(["count", "name"]);
  });

  it("路径参数不是 UUID、请求体不是合法 JSON、查询参数取值不对：同样 400", TIMEOUT, async () => {
    const { request } = await start();
    const badParam = await request("/api/v1/m/lyxtest-things/not-a-uuid");
    expect(badParam.status).toBe(400);
    expect(await badParam.json()).toMatchObject({
      error: "VALIDATION_FAILED",
      fieldErrors: [{ path: "thingId" }],
    });

    const badJson = await request(`/api/v1/m/lyxtest-things/${thingId}`, {
      method: "PUT",
      body: "{not json",
      headers: { "content-type": "application/json", "Idempotency-Key": `update:${uuidv7()}` },
    });
    expect(badJson.status).toBe(400);
    expect(await badJson.json()).toMatchObject({ error: "VALIDATION_FAILED" });

    const badQuery = await request(`/api/v1/m/lyxtest-things/${thingId}?fail=nope`);
    expect(badQuery.status).toBe(400);
    expect(await badQuery.json()).toMatchObject({ fieldErrors: [{ path: "fail" }] });
  });
});

describe("错误映射", () => {
  it("业务错误按契约的表出状态码与错误体；文案与 details 取错误自己带的", TIMEOUT, async () => {
    const { request } = await start();
    const conflict = await request(`/api/v1/m/lyxtest-things/${thingId}?fail=app`);
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({
      code: COMMON_ERRORS.STATE_NOT_ALLOWED.code,
      error: "STATE_NOT_ALLOWED",
      message: "这件东西已经处理过了",
      retryable: false,
      requestId: conflict.headers.get("X-Request-Id"),
    });

    const reminded = await request(`/api/v1/m/lyxtest-things/${thingId}?fail=details`);
    expect(reminded.status).toBe(409);
    expect(await reminded.json()).toMatchObject({
      error: "REMINDED_TODAY",
      message: COMMON_ERRORS.REMINDED_TODAY.message,
      details: { scene: "lyxtest", nextAvailableDate: "2026-01-06" },
    });
  });

  it("503 带 Retry-After，retryable 为真", TIMEOUT, async () => {
    const { request } = await start();
    const busy = await request(`/api/v1/m/lyxtest-things/${thingId}?fail=busy`);
    expect(busy.status).toBe(503);
    expect(busy.headers.get("Retry-After")).toBe("1");
    expect(await busy.json()).toMatchObject({ error: "BUSY", code: 50003, retryable: true });
  });

  it("未预期的错误：500 INTERNAL，响应里没有内部信息，原始错误进日志", TIMEOUT, async () => {
    const { request, logs } = await start();
    const crashed = await request(`/api/v1/m/lyxtest-things/${thingId}?fail=crash`);
    expect(crashed.status).toBe(500);
    const text = await crashed.text();
    expect(JSON.parse(text)).toEqual({
      code: 50000,
      error: "INTERNAL",
      message: COMMON_ERRORS.INTERNAL.message,
      retryable: false,
      requestId: crashed.headers.get("X-Request-Id"),
    });
    expect(text).not.toContain("hunter2");
    expect(logs.find((entry) => entry.evt === "http.error")).toMatchObject({
      level: "error",
      error: "INTERNAL",
      err: { message: expect.stringContaining("内部细节") as unknown },
    });
    expect(logs.find((entry) => entry.evt === "http")).toMatchObject({
      level: "error",
      status: 500,
    });
  });

  it("没有这条路由：404 NOT_FOUND，同样是错误体", TIMEOUT, async () => {
    const { request } = await start();
    const response = await request("/nowhere");
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: 40401, error: "NOT_FOUND" });
  });
});

describe("四组挂载", () => {
  it("商家端、后台、下载页、回调各挂得上一条；成功体套信封，回调不套", TIMEOUT, async () => {
    const { request, api } = await start();
    expect(
      api.mounted.map((route) => `${route.group} ${route.method} ${route.path}`).sort(),
    ).toEqual([
      "admin GET /api/v1/admin/lyxtest-things",
      "hooks POST /api/v1/hooks/lyxtest/events",
      "m GET /api/v1/m/lyxtest-things/{thingId}",
      "m POST /api/v1/m/lyxtest-things/forgetful",
      "m PUT /api/v1/m/lyxtest-things/{thingId}",
      "portal GET /api/v1/portal/lyxtest-things/current",
    ]);

    const merchant = await request(`/api/v1/m/lyxtest-things/${thingId}`);
    expect(await merchant.json()).toEqual({
      code: 0,
      message: "ok",
      data: { id: thingId, name: "样例", count: 1, serial: 0 },
    });
    const admin = await request("/api/v1/admin/lyxtest-things");
    expect(await admin.json()).toEqual({ code: 0, message: "ok", data: { items: [] } });
    const portal = await request("/api/v1/portal/lyxtest-things/current");
    expect(await portal.json()).toMatchObject({ data: { surface: "portal" } });
    const hook = await request("/api/v1/hooks/lyxtest/events", { method: "POST" });
    expect(hook.status).toBe(200);
    expect(await hook.text()).toBe("success");
  });
});
