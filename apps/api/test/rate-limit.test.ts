// 限流的接口层用例（任务书 W0-22b 第 7 节第 1、2 条；约定 C68）。连真的 Redis（本 worker 的测试前缀）；
// “停掉 Redis”用故障注入的转发口造，不动共享的那份。各用例用各自的来源 IP 与用户，计数互不相干。
import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

import { serve } from "@hono/node-server";
import { uuidv7 } from "@liyoxi/services";
import { createRedisOutage } from "@liyoxi/services/testing";
import { afterAll, describe, expect, it } from "vitest";

import { fakeAuth, stubMiddleware, useTestApi } from "../src/testing/index.js";
import type { TestApi } from "../src/testing/index.js";

import {
  adminListHandler,
  executions,
  hookReceiveHandler,
  signedTierHandler,
  thingGetHandler,
  thingUpdateHandler,
} from "./fixtures.js";

const testApi = useTestApi();
const TIMEOUT = { timeout: 60_000 };

const cleanups: (() => Promise<void>)[] = [];
afterAll(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const merchant = (id: string = uuidv7()) =>
  fakeAuth({ actor: { type: "merchant", id, client: "weapp", role: "owner" } });
const thing = () => `/api/v1/m/lyxtest-things/${uuidv7()}`;

/** 连发几次，返回各次的状态码 */
async function statuses(
  api: TestApi,
  times: number,
  path: () => string = thing,
  init: Parameters<TestApi["request"]>[1] = {},
): Promise<number[]> {
  const seen: number[] = [];
  for (let i = 0; i < times; i += 1) seen.push((await api.request(path(), init)).status);
  return seen;
}

describe("超限返回 429", () => {
  it(
    "额度内 200；超出即 429 RATE_LIMITED，带 Retry-After 与请求编号，并记一条日志",
    TIMEOUT,
    async () => {
      const api = await testApi.start({
        handlers: [thingGetHandler],
        rateLimitQuotas: { "m.global": [{ by: "ip", limit: 3, windowSec: 60 }] },
      });
      expect(await statuses(api, 3)).toEqual([200, 200, 200]);

      const blocked = await api.request(thing());
      expect(blocked.status).toBe(429);
      const body = (await blocked.json()) as Record<string, unknown>;
      expect(body).toMatchObject({ code: 42901, error: "RATE_LIMITED", retryable: true });
      expect(body.requestId).toBe(blocked.headers.get("X-Request-Id"));
      const retryAfter = blocked.headers.get("Retry-After");
      expect(retryAfter).toMatch(/^[1-9]\d*$/);
      expect(Number(retryAfter)).toBeLessThanOrEqual(60);
      expect(api.logs.find((entry) => entry.evt === "ratelimit.hit")).toMatchObject({
        level: "warn",
        operationId: "m.lyxtestThing.get",
        tiers: ["m.global"],
        degraded: false,
      });
    },
  );

  it(
    "不同来源 IP 各算各的；经可信代理来的按转发头右数第一个，伪造在左侧的不起作用",
    TIMEOUT,
    async () => {
      const api = await testApi.start({
        handlers: [thingGetHandler],
        rateLimitQuotas: { "m.global": [{ by: "ip", limit: 2, windowSec: 60 }] },
      });
      expect(await statuses(api, 3)).toEqual([200, 200, 429]);
      expect(await statuses(api, 1, thing, { peer: "198.19.7.7" })).toEqual([200]);

      const client = `198.19.${Math.floor(Math.random() * 200) + 8}.9`;
      const viaProxy = (spoofed: string) => ({
        peer: "10.0.0.5",
        headers: { "X-Forwarded-For": `${spoofed}, ${client}` },
      });
      expect(await statuses(api, 1, thing, viaProxy("6.6.6.6"))).toEqual([200]);
      expect(await statuses(api, 1, thing, viaProxy("7.7.7.7"))).toEqual([200]);
      expect(await statuses(api, 1, thing, viaProxy("8.8.8.8"))).toEqual([429]);
      // 直接连上来、自己带转发头的：按对端算，与上面那个客户端不是一个计数
      expect(
        await statuses(api, 1, thing, {
          peer: "198.19.3.3",
          headers: { "X-Forwarded-For": client },
        }),
      ).toEqual([200]);
    },
  );

  it("登录的按用户、匿名的按 IP：同一个来源上各有各的额度", TIMEOUT, async () => {
    const quotas = {
      "m.global": [
        { by: "ip", anonymousOnly: true, limit: 2, windowSec: 60 },
        { by: "user", limit: 3, windowSec: 60 },
      ],
    } as const;
    const peer = "198.19.4.4";
    const options = { handlers: [thingGetHandler], rateLimitQuotas: quotas };
    const alice = await testApi.start({ ...options, middlewares: [merchant()] });
    const bob = await testApi.start({ ...options, middlewares: [merchant()] });
    const anonymous = await testApi.start(options);

    expect(await statuses(alice, 4, thing, { peer })).toEqual([200, 200, 200, 429]);
    expect(await statuses(bob, 1, thing, { peer })).toEqual([200]);
    expect(await statuses(anonymous, 3, thing, { peer })).toEqual([200, 200, 429]);
  });

  it("专用档位与所在组的缺省档位同时生效", TIMEOUT, async () => {
    // 固定路径的那条先登记：免得被带参数的路径先接走
    const signed = () => "/api/v1/m/lyxtest-things/signed";
    const tight = await testApi.start({
      handlers: [signedTierHandler, thingGetHandler],
      middlewares: [merchant()],
      rateLimitQuotas: {
        "m.sign": [{ by: "user", limit: 2, windowSec: 3600 }],
        "m.global": [{ by: "user", limit: 100, windowSec: 60 }],
      },
    });
    expect(await statuses(tight, 3, signed)).toEqual([200, 200, 429]);
    expect(tight.logs.find((entry) => entry.evt === "ratelimit.hit")).toMatchObject({
      tiers: ["m.sign"],
    });
    // 专用档位满了，不挂它的路由不受影响
    expect(await statuses(tight, 1)).toEqual([200]);

    const loose = await testApi.start({
      handlers: [signedTierHandler, thingGetHandler],
      middlewares: [merchant()],
      rateLimitQuotas: {
        "m.sign": [{ by: "user", limit: 100, windowSec: 3600 }],
        "m.global": [{ by: "user", limit: 3, windowSec: 60 }],
      },
    });
    // 挂了专用档位的路由同样计入所在组的缺省档位
    expect(await statuses(loose, 2, signed)).toEqual([200, 200]);
    expect(await statuses(loose, 2)).toEqual([200, 429]);
    expect(await statuses(loose, 1, signed)).toEqual([429]);
  });

  it("回调按来源 IP；按会话的档位遇到没登录的请求退到按 IP，不放开", TIMEOUT, async () => {
    const api = await testApi.start({
      handlers: [hookReceiveHandler, adminListHandler],
      middlewares: [stubMiddleware("signature")],
      rateLimitQuotas: {
        "hooks.ip": [{ by: "ip", limit: 2, windowSec: 60 }],
        "admin.global": [{ by: "session", limit: 2, windowSec: 60 }],
      },
    });
    const hook = () => "/api/v1/hooks/lyxtest/events";
    expect(await statuses(api, 3, hook, { method: "POST" })).toEqual([200, 200, 429]);
    expect(await statuses(api, 1, hook, { method: "POST", peer: "198.19.5.5" })).toEqual([200]);

    const admin = () => "/api/v1/admin/lyxtest-things";
    expect(await statuses(api, 3, admin)).toEqual([200, 200, 429]);
    // 拿不到对端地址的请求全算在一起，同样有上限
    expect(await statuses(api, 3, admin, { peer: null })).toEqual([200, 200, 429]);
  });

  it(
    "按会话：同一名员工的两个会话各算各的；按路径参数：同一个对象才算在一起",
    TIMEOUT,
    async () => {
      const staffId = uuidv7();
      const session = (sessionId: string) =>
        testApi.start({
          handlers: [adminListHandler],
          middlewares: [
            fakeAuth({ actor: { type: "staff", id: staffId, client: "admin" } }, { sessionId }),
          ],
          rateLimitQuotas: { "admin.global": [{ by: "session", limit: 2, windowSec: 60 }] },
        });
      const admin = () => "/api/v1/admin/lyxtest-things";
      expect(await statuses(await session(uuidv7()), 3, admin)).toEqual([200, 200, 429]);
      expect(await statuses(await session(uuidv7()), 1, admin)).toEqual([200]);

      const perThing = await testApi.start({
        handlers: [thingGetHandler],
        rateLimitQuotas: {
          "m.global": [{ by: "param", param: "thingId", limit: 1, windowSec: 3 }],
        },
      });
      const same = thing();
      expect(await statuses(perThing, 2, () => same)).toEqual([200, 429]);
      expect(await statuses(perThing, 1)).toEqual([200]);
    },
  );

  it(
    "限流排在幂等上下文之前：超限的写请求得到 429，不去读幂等键，处理器没有执行",
    TIMEOUT,
    async () => {
      const api = await testApi.start({
        handlers: [thingUpdateHandler],
        middlewares: [merchant()],
        rateLimitQuotas: { "m.global": [{ by: "user", limit: 1, windowSec: 60 }] },
      });
      const put = (key?: string) =>
        api.request(thing(), {
          method: "PUT",
          json: { name: "样例", count: 1 },
          headers: key === undefined ? {} : { "Idempotency-Key": key },
        });
      const before = executions.update;
      expect((await put(`update:${uuidv7()}`)).status).toBe(200);
      // 没带幂等键：不超限时是 400，超限时先被限流拦下
      expect((await put()).status).toBe(429);
      expect(executions.update).toBe(before + 1);
    },
  );
});

describe("真的监听端口", () => {
  it("取得到套接字的对端地址：本机回环算自家代理，按转发头右数第一个计数", TIMEOUT, async () => {
    const api = await testApi.start({
      handlers: [thingGetHandler],
      rateLimitQuotas: { "m.global": [{ by: "ip", limit: 1, windowSec: 60 }] },
    });
    const server = serve({ fetch: api.api.app.fetch, port: 0, hostname: "127.0.0.1" }) as Server;
    cleanups.push(async () => {
      server.closeAllConnections();
      server.close();
      await once(server, "close");
    });
    if (!server.listening) await once(server, "listening");
    const { port } = server.address() as AddressInfo;
    const get = (forwardedFor: string) =>
      fetch(`http://127.0.0.1:${port}${thing()}`, {
        headers: { "X-Forwarded-For": forwardedFor },
      }).then((response) => response.status);

    const octet = Math.floor(Math.random() * 200) + 20;
    expect(await get(`198.19.${octet}.1`)).toBe(200);
    expect(await get(`6.6.6.6, 198.19.${octet}.1`)).toBe(429);
    expect(await get(`198.19.${octet}.2`)).toBe(200);
  });
});

describe("停掉 Redis 后限流仍生效", () => {
  it(
    "转发口断开：请求照常应答，限额减半后照样 429；恢复并过了熔断时长后回到 Redis 上计数",
    TIMEOUT,
    async () => {
      const outage = await createRedisOutage();
      cleanups.push(() => outage.close());
      const api = await testApi.start({
        handlers: [thingGetHandler],
        redisUrl: outage.url,
        rateLimitQuotas: { "m.global": [{ by: "ip", limit: 4, windowSec: 60 }] },
      });
      expect(await statuses(api, 1)).toEqual([200]);

      await outage.down();
      // 进程内从头数，额度减半成 2：没有放开，也没有整体拒绝
      expect(await statuses(api, 2)).toEqual([200, 200]);
      const blocked = await api.request(thing());
      expect(blocked.status).toBe(429);
      expect(await blocked.json()).toMatchObject({ error: "RATE_LIMITED" });
      // 进程内的窗口按注入的时钟走，用例里时钟不动：正好剩一整个窗口
      expect(blocked.headers.get("Retry-After")).toBe("60");
      expect(api.logs.some((entry) => entry.evt === "ratelimit.degraded")).toBe(true);
      expect(api.logs.find((entry) => entry.evt === "ratelimit.hit")).toMatchObject({
        degraded: true,
      });

      await outage.up();
      // 熔断的 5 秒内不试 Redis，仍按进程内的计数拒
      expect(await statuses(api, 1)).toEqual([429]);
      api.clock.advance(5_000);
      // 回到 Redis：接着断开前的那一次往下数（额度 4，已用 1）
      expect(await statuses(api, 4)).toEqual([200, 200, 200, 429]);
      expect(api.logs.some((entry) => entry.evt === "ratelimit.restored")).toBe(true);
    },
  );
});
