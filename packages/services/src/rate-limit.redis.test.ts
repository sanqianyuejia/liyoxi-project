// 限流器连真 Redis 的用例（W0-22b；任务书 第 7 节第 7 条）：脚本在真的 Redis 上计数并设过期；
// “停掉 Redis”用故障注入的转发口造（createRedisOutage），不动共享的那份。
import { Redis } from "ioredis";
import { afterAll, describe, expect, it } from "vitest";

import { createRateLimiter } from "./rate-limit.js";
import {
  createClock,
  createRedisOutage,
  disconnectTestRedis,
  useTestRedis,
} from "./testing/index.js";
import type { RedisOutage } from "./testing/index.js";

const redis = useTestRedis();
const TIMEOUT = { timeout: 60_000 };
/** 机器忙的时候一条命令也可能慢：用例里把时限放宽，免得把慢当成断 */
const PATIENT = 10_000;

const cleanups: (() => Promise<void>)[] = [];
afterAll(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

describe("Redis 上的固定窗口", () => {
  it(
    "第一次计数时设上过期时间；额度内放行、超出即拒，Retry-After 不超过窗口",
    TIMEOUT,
    async () => {
      const client = await redis.client();
      const limiter = createRateLimiter({
        store: client,
        clock: createClock(),
        commandTimeoutMs: PATIENT,
      });
      const check = { key: "rl:test:window", limit: 2, windowMs: 30_000 };

      expect(await limiter.hit([check])).toMatchObject({ allowed: true, degraded: false });
      const ttl = await client.pttl(check.key);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(30_000);

      expect((await limiter.hit([check])).allowed).toBe(true);
      const blocked = await limiter.hit([check]);
      expect(blocked).toMatchObject({ allowed: false, exceeded: [0], degraded: false });
      expect(blocked.retryAfterSec).toBeGreaterThanOrEqual(1);
      expect(blocked.retryAfterSec).toBeLessThanOrEqual(30);
      expect(await client.get(check.key)).toBe("3");
    },
  );

  it("没有过期时间的旧键补上过期时间；几条规则各记各的", TIMEOUT, async () => {
    const client = await redis.client();
    const limiter = createRateLimiter({
      store: client,
      clock: createClock(),
      commandTimeoutMs: PATIENT,
    });
    await client.set("rl:test:stale", "7");
    const decision = await limiter.hit([
      { key: "rl:test:stale", limit: 100, windowMs: 20_000 },
      { key: "rl:test:other", limit: 1, windowMs: 20_000 },
    ]);
    expect(decision.allowed).toBe(true);
    expect(await client.get("rl:test:stale")).toBe("8");
    expect(await client.pttl("rl:test:stale")).toBeGreaterThan(0);
    expect(await client.get("rl:test:other")).toBe("1");
    // 键都落在本 worker 的测试前缀之下
    const raw = await redis.raw();
    expect(await raw.exists(`${redis.prefix}rl:test:other`)).toBe(1);
  });
});

describe("停掉 Redis", () => {
  it("转发口断开后改用进程内计数、限额减半；恢复并过了熔断时长后回到 Redis", TIMEOUT, async () => {
    // 先让测试支架记下并清过本前缀：收尾时由它清掉这里写的键
    await redis.flush();
    const outage: RedisOutage = await createRedisOutage();
    cleanups.push(() => outage.close());
    // 与进程运行时同样的连接参数：一条命令只等一次重连
    const client = new Redis(outage.url, { keyPrefix: redis.prefix, maxRetriesPerRequest: 1 });
    client.on("error", () => undefined);
    cleanups.push(() => disconnectTestRedis(client));

    const clock = createClock();
    const limiter = createRateLimiter({ store: client, clock, commandTimeoutMs: PATIENT });
    const check = { key: "rl:test:outage", limit: 4, windowMs: 60_000 };

    expect(await limiter.hit([check])).toMatchObject({ allowed: true, degraded: false });

    await outage.down();
    const during = [];
    for (let i = 0; i < 3; i += 1) during.push(await limiter.hit([check]));
    // 减半后是 2：进程内从头数，第三次被拒。没有放开
    expect(during.map((decision) => decision.allowed)).toEqual([true, true, false]);
    expect(during.every((decision) => decision.degraded)).toBe(true);
    expect(during[2]?.retryAfterSec).toBe(60);

    await outage.up();
    // 熔断期内不试 Redis
    expect((await limiter.hit([check])).degraded).toBe(true);
    clock.advance(5_000);
    const after = await limiter.hit([check]);
    // 回到 Redis：接着断开前的那一次往下数（第 2 次），在额度内
    expect(after).toMatchObject({ allowed: true, degraded: false });
    const raw = await redis.raw();
    expect(await raw.get(`${redis.prefix}${check.key}`)).toBe("2");
  });
});
