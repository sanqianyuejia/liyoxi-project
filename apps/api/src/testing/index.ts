// 接口测试支架（W0-22）：在用例里把整个 api 应用建起来，连本文件自己的测试库与 Redis 前缀，
// 用 app.request() 发请求（不占端口）。各域的接口包照这个写接口层测试。
//
//   const testApi = useTestApi();                      // 测试文件顶层
//   it("……", async () => {
//     const { request, runtime } = await testApi.start({ middlewares: [fakeAuth(owner)] });
//     const response = await request("/api/v1/m/orders", { method: "POST", json: {...}, headers: {...} });
//     expect(response.status).toBe(200);
//   });
//
// - 处理器清单缺省是生产的那份（routes/index.ts）；要挂样例路由就传 handlers。
// - 鉴权链、授权、验签等中间件没到之前，用 fakeAuth 与 stubMiddleware 顶上：它们各占自己的槽位，
//   先后仍由 PIPELINE_ORDER 定；与生产的登记同一个槽位的，用例给的顶掉生产的那一件。
// - 限流照常生效。每个建出来的应用缺省有一个自己的来源 IP（各算各的，互不挤占额度）；
//   要验限流就传 rateLimitQuotas 换成小额度，request 的 peer 可以换来源。
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
import { rateLimit } from "../http/rate-limit.js";
import type { RateLimitOptions } from "../http/rate-limit.js";
import { ROUTE_MIDDLEWARES } from "../routing/pipeline.js";
import type { PipelineEntry, PipelineSlot } from "../routing/pipeline.js";
import { HANDLERS } from "../routes/index.js";

export interface TestApiOptions {
  /** 处理器清单；缺省是生产的那份 */
  readonly handlers?: readonly HandlerEntry[];
  /** 补上或顶替的几件（fakeAuth、stubMiddleware）：同一个槽位的顶掉生产的那一件 */
  readonly middlewares?: readonly PipelineEntry[];
  /** 整个换掉路由级中间件的登记表（验“漏挂”时用） */
  readonly pipeline?: readonly PipelineEntry[];
  /** 换掉限流的额度表（验限流时用小额度） */
  readonly rateLimitQuotas?: RateLimitOptions["quotas"];
  /** 运行时连哪个 Redis，缺省环境变量里的那个；验“Redis 不可用”时传故障注入的转发口 */
  readonly redisUrl?: string;
}

export interface TestRequestInit extends RequestInit {
  /** 给了就按 JSON 请求体发，并带上 Content-Type */
  readonly json?: unknown;
  readonly headers?: Record<string, string>;
  /** 套接字的对端地址（取客户端 IP 用），缺省是这个应用自己的那个；null = 拿不到对端 */
  readonly peer?: string | null;
}

export interface TestApi {
  readonly api: Api;
  readonly runtime: Runtime;
  /** 可拨时钟：运行时用的就是它 */
  readonly clock: AdjustableClock;
  /** 这个应用打出的日志，一条一个对象 */
  readonly logs: Record<string, unknown>[];
  /** 这个应用缺省的来源 IP */
  readonly peer: string;
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
  let flushed: Promise<number> | undefined;
  afterAll(async () => {
    await Promise.all(runtimes.splice(0).map((runtime) => runtime.close()));
  });

  return {
    db,
    redis,
    async start(options = {}) {
      // 先清掉本 worker 的 Redis 前缀下上一轮的残留（限流的计数键活到窗口结束），收尾时测试支架再清一遍
      flushed ??= redis.flush();
      await flushed;
      const databaseUrl = await db.url();
      assertTestDatabaseUrl(databaseUrl);
      const env = {
        ...loadEnv(),
        DATABASE_URL: databaseUrl,
        ...(options.redisUrl === undefined ? {} : { REDIS_URL: options.redisUrl }),
      };
      const clock = createClock();
      const logs: Record<string, unknown>[] = [];
      const runtime = createRuntime({
        entry: "api",
        env,
        version: "test",
        clock,
        redisKeyPrefix: redis.prefix,
        healthCacheMs: 0,
        // 机器忙的时候 Redis 的一条命令也可能慢过 200 毫秒：放宽，免得用例里把慢当成断
        rateLimitCommandTimeoutMs: 5_000,
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
        pipeline: options.pipeline ?? withOverrides(options),
      });
      api.readiness.state = "ready";
      const ownPeer = randomPeer();
      return {
        api,
        runtime,
        clock,
        logs,
        peer: ownPeer,
        async request(path, init = {}) {
          const { json, headers = {}, peer = ownPeer, ...rest } = init;
          return api.app.request(
            path,
            {
              ...rest,
              headers:
                json === undefined ? headers : { "content-type": "application/json", ...headers },
              ...(json === undefined ? {} : { body: JSON.stringify(json) }),
            },
            peer === null ? {} : { incoming: { socket: { remoteAddress: peer } } },
          );
        },
      };
    },
  };
}

/** 生产的登记表，套上用例给的顶替件与额度表 */
function withOverrides(options: TestApiOptions): PipelineEntry[] {
  const given = [
    ...(options.rateLimitQuotas === undefined
      ? []
      : [{ slot: "rateLimit" as const, factory: rateLimit({ quotas: options.rateLimitQuotas }) }]),
    ...(options.middlewares ?? []),
  ];
  const replaced = new Set(given.map((entry) => entry.slot));
  return [...ROUTE_MIDDLEWARES.filter((entry) => !replaced.has(entry.slot)), ...given];
}

/** 文档用的网段 198.18.0.0/15 里随便一个地址：不在可信网段里，就是客户端 IP 本身 */
function randomPeer(): string {
  const octet = (): number => Math.floor(Math.random() * 254) + 1;
  return `198.18.${octet()}.${octet()}`;
}

/** 顶替鉴权链：把给定的身份（与会话标识）放进上下文，占 auth 槽位 */
export function fakeAuth(
  identity: IdentityContextInput,
  options: { sessionId?: string } = {},
): PipelineEntry {
  return {
    slot: "auth",
    factory: () => async (c, next) => {
      c.set(
        "identity",
        createIdentityContext({
          ...identity,
          requestId: c.get("requestId"),
          // 用例自己给了 ip 就用它的
          ip: identity.ip ?? c.get("clientIp"),
        }),
      );
      if (options.sessionId !== undefined) c.set("sessionId", options.sessionId);
      await next();
    },
  };
}

/** 顶替还没到的中间件：什么都不做，只占一个槽位（authz、signature……） */
export function stubMiddleware(slot: PipelineSlot): PipelineEntry {
  return { slot, factory: () => (_c, next) => next() };
}
