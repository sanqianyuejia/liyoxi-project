// 接口测试支架（W0-22）：在用例里把整个 api 应用建起来，连本文件自己的测试库与 Redis 前缀，
// 用 app.request() 发请求（不占端口）。各域的接口包照这个写接口层测试。
//
//   const testApi = useTestApi();                      // 测试文件顶层
//   it("……", async () => {
//     const { request, runtime } = await testApi.start({ before: [fakeAuth(owner)] });
//     const response = await request("/api/v1/m/orders", { method: "POST", json: {...}, headers: {...} });
//     expect(response.status).toBe(200);
//   });
//
// - 处理器清单缺省是生产的那份（routes/index.ts）；要挂样例路由就传 handlers。
// - 鉴权链、限流等中间件没到之前，用 fakeAuth 与 stubMiddleware 顶上，排在生产的清单之前。
// - 用例里以字符串字面量写出被测接口的 operationId：“已落地”的判定按它认“有接口层测试”。
// 只给测试用，不进构建产物。
import { createLogger, createIdentityContext, createRuntime, loadEnv } from "@liyoxi/services";
import type { IdentityContextInput, Runtime } from "@liyoxi/services";
import {
  assertTestDatabaseUrl,
  createClock,
  useTestDatabase,
  useTestRedis,
} from "@liyoxi/services/testing";
import type { AdjustableClock, TestDatabase, TestRedis } from "@liyoxi/services/testing";
import { afterAll } from "vitest";

import { createApp } from "../app.js";
import type { Api } from "../app.js";
import type { HandlerEntry } from "../routing/define.js";
import { ROUTE_PIPELINE } from "../routing/pipeline.js";
import type { RouteMiddlewareFactory } from "../routing/types.js";
import { HANDLERS } from "../routes/index.js";

export interface TestApiOptions {
  /** 处理器清单；缺省是生产的那份 */
  readonly handlers?: readonly HandlerEntry[];
  /** 排在生产的路由级中间件之前的几件（fakeAuth、stubMiddleware） */
  readonly before?: readonly RouteMiddlewareFactory[];
  /** 整个换掉路由级中间件的清单（验“漏挂”时用） */
  readonly pipeline?: readonly RouteMiddlewareFactory[];
}

export interface TestRequestInit extends RequestInit {
  /** 给了就按 JSON 请求体发，并带上 Content-Type */
  readonly json?: unknown;
  readonly headers?: Record<string, string>;
}

export interface TestApi {
  readonly api: Api;
  readonly runtime: Runtime;
  /** 可拨时钟：运行时用的就是它 */
  readonly clock: AdjustableClock;
  /** 这个应用打出的日志，一条一个对象 */
  readonly logs: Record<string, unknown>[];
  request(path: string, init?: TestRequestInit): Promise<Response>;
}

export interface TestApiHandle {
  readonly db: TestDatabase;
  readonly redis: TestRedis;
  /** 建一个应用。同一个文件里可以建多个，共用一个测试库；文件跑完统一断开 */
  start(options?: TestApiOptions): Promise<TestApi>;
}

export function useTestApi(): TestApiHandle {
  const db = useTestDatabase("api");
  const redis = useTestRedis();
  const runtimes: Runtime[] = [];
  afterAll(async () => {
    await Promise.all(runtimes.splice(0).map((runtime) => runtime.close()));
  });

  return {
    db,
    redis,
    async start(options = {}) {
      const databaseUrl = await db.url();
      assertTestDatabaseUrl(databaseUrl);
      const env = { ...loadEnv(), DATABASE_URL: databaseUrl };
      const clock = createClock();
      const logs: Record<string, unknown>[] = [];
      const runtime = createRuntime({
        entry: "api",
        env,
        version: "test",
        clock,
        redisKeyPrefix: redis.prefix,
        healthCacheMs: 0,
        logger: createLogger({
          svc: "api",
          env: env.APP_ENV,
          level: "debug",
          version: "test",
          destination: { write: (line: string) => void logs.push(JSON.parse(line)) },
        }),
      });
      runtimes.push(runtime);
      const api = createApp({
        runtime,
        handlers: options.handlers ?? HANDLERS,
        pipeline: options.pipeline ?? [...(options.before ?? []), ...ROUTE_PIPELINE],
      });
      api.readiness.state = "ready";
      return {
        api,
        runtime,
        clock,
        logs,
        async request(path, init = {}) {
          const { json, headers = {}, ...rest } = init;
          return api.app.request(path, {
            ...rest,
            headers:
              json === undefined ? headers : { "content-type": "application/json", ...headers },
            ...(json === undefined ? {} : { body: JSON.stringify(json) }),
          });
        },
      };
    },
  };
}

/** 顶替鉴权链：把给定的身份放进上下文，名字是 auth */
export function fakeAuth(identity: IdentityContextInput): RouteMiddlewareFactory {
  return () => ({
    name: "auth",
    handler: async (c, next) => {
      c.set("identity", createIdentityContext({ ...identity, requestId: c.get("requestId") }));
      await next();
    },
  });
}

/** 顶替还没到的中间件：什么都不做，只占一个名字（authz、signature、rateLimit……） */
export function stubMiddleware(name: string): RouteMiddlewareFactory {
  return () => ({ name, handler: (_c, next) => next() });
}
