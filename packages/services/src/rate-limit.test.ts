// 限流器的单测（W0-22b；任务书 第 7 节第 7 条）：不连 Redis，用假的存储验降级、减半、熔断与进程内窗口。
import { describe, expect, it } from "vitest";

import { createRateLimiter, degradedLimit, RATE_LIMIT_SCRIPT } from "./rate-limit.js";
import type { RateLimitCheck, RateLimitStore } from "./rate-limit.js";
import { createClock } from "./testing/index.js";

const check = (key: string, limit: number, windowMs = 60_000): RateLimitCheck => ({
  key,
  limit,
  windowMs,
});

/** 假的 Redis：照脚本的语义在内存里数，可以让它报错或不回 */
function fakeStore() {
  const counts = new Map<string, number>();
  const state = { mode: "ok" as "ok" | "fail" | "hang" | "garbage", calls: 0 };
  const store: RateLimitStore = {
    eval(script, numKeys, ...args) {
      state.calls += 1;
      expect(script).toBe(RATE_LIMIT_SCRIPT);
      if (state.mode === "fail") return Promise.reject(new Error("ECONNREFUSED"));
      if (state.mode === "hang") return new Promise(() => undefined);
      if (state.mode === "garbage") return Promise.resolve("OK");
      const keys = args.slice(0, numKeys).map(String);
      const windows = args.slice(numKeys).map(Number);
      return Promise.resolve(
        keys.flatMap((key, index) => {
          const count = (counts.get(key) ?? 0) + 1;
          counts.set(key, count);
          return [count, windows[index]];
        }),
      );
    },
  };
  return { store, state, counts };
}

function setup(options: { commandTimeoutMs?: number; maxMemoryEntries?: number } = {}) {
  const fake = fakeStore();
  const clock = createClock();
  const logs: { level: string; evt: unknown }[] = [];
  const logger = {
    warn: (fields: { evt?: unknown }) => void logs.push({ level: "warn", evt: fields.evt }),
    info: (fields: { evt?: unknown }) => void logs.push({ level: "info", evt: fields.evt }),
  };
  const limiter = createRateLimiter({
    store: fake.store,
    clock,
    logger: logger as never,
    commandTimeoutMs: options.commandTimeoutMs ?? 5_000,
    ...(options.maxMemoryEntries === undefined
      ? {}
      : { maxMemoryEntries: options.maxMemoryEntries }),
  });
  return { ...fake, clock, logs, limiter };
}

describe("Redis 可用", () => {
  it("额度内放行，超出即拒；Retry-After 取超限窗口的剩余秒数，向上取整", async () => {
    const { limiter } = setup();
    for (let i = 0; i < 3; i += 1) {
      expect(await limiter.hit([check("a", 3, 1_500)])).toEqual({
        allowed: true,
        retryAfterSec: 0,
        exceeded: [],
        degraded: false,
      });
    }
    expect(await limiter.hit([check("a", 3, 1_500)])).toEqual({
      allowed: false,
      retryAfterSec: 2,
      exceeded: [0],
      degraded: false,
    });
  });

  it("几条规则一次往返；有一条超限就拒，Retry-After 取其中最久的", async () => {
    const { limiter, state } = setup();
    const checks = [check("ip", 1, 3_000), check("user", 1, 90_000), check("global", 100)];
    expect((await limiter.hit(checks)).allowed).toBe(true);
    expect(await limiter.hit(checks)).toMatchObject({
      allowed: false,
      exceeded: [0, 1],
      retryAfterSec: 90,
    });
    expect(state.calls).toBe(2);
  });

  it("没有规则：放行，不碰 Redis", async () => {
    const { limiter, state } = setup();
    expect((await limiter.hit([])).allowed).toBe(true);
    expect(state.calls).toBe(0);
  });
});

describe("Redis 不可用", () => {
  it("报错：这一次就改用进程内计数，限额减半，照样会拒", async () => {
    const { limiter, state, logs } = setup();
    state.mode = "fail";
    const results = [];
    for (let i = 0; i < 4; i += 1) results.push(await limiter.hit([check("a", 6)]));
    expect(results.map((result) => result.allowed)).toEqual([true, true, true, false]);
    expect(results.every((result) => result.degraded)).toBe(true);
    expect(results[3]).toMatchObject({ exceeded: [0], retryAfterSec: 60 });
    expect(limiter.degraded).toBe(true);
    expect(logs).toEqual([{ level: "warn", evt: "ratelimit.degraded" }]);
  });

  it("减半至少留 1：限额是 1 的规则降级后仍放行一次", async () => {
    expect([1, 2, 3, 10, 600].map(degradedLimit)).toEqual([1, 1, 1, 5, 300]);
    const { limiter, state } = setup();
    state.mode = "fail";
    expect((await limiter.hit([check("a", 1)])).allowed).toBe(true);
    expect((await limiter.hit([check("a", 1)])).allowed).toBe(false);
  });

  it("到时限没回、返回的不是预期的结果：同样降级", async () => {
    for (const mode of ["hang", "garbage"] as const) {
      const { limiter, state } = setup({ commandTimeoutMs: 20 });
      state.mode = mode;
      expect(await limiter.hit([check("a", 4)])).toMatchObject({ allowed: true, degraded: true });
    }
  });

  it("熔断：失败之后的 5 秒不再碰 Redis；到点再试，通了回到 Redis 上并记一条日志", async () => {
    const { limiter, state, clock, logs } = setup();
    state.mode = "fail";
    await limiter.hit([check("a", 10)]);
    expect(state.calls).toBe(1);
    clock.advance(4_999);
    await limiter.hit([check("a", 10)]);
    expect(state.calls).toBe(1);

    clock.advance(1);
    await limiter.hit([check("a", 10)]);
    expect(state.calls).toBe(2);

    state.mode = "ok";
    clock.advance(5_000);
    expect(await limiter.hit([check("a", 10)])).toMatchObject({ allowed: true, degraded: false });
    expect(limiter.degraded).toBe(false);
    expect(logs.map((log) => log.evt)).toEqual(["ratelimit.degraded", "ratelimit.restored"]);
  });

  it("进程内的窗口到点重新计数", async () => {
    const { limiter, state, clock } = setup();
    state.mode = "fail";
    const once = () => limiter.hit([check("a", 2, 1_000)]);
    expect((await once()).allowed).toBe(true);
    expect(await once()).toMatchObject({ allowed: false, retryAfterSec: 1 });
    clock.advance(1_000);
    expect((await once()).allowed).toBe(true);
  });

  it("进程内的计数表有上限：满了先清过期的，再删最早放进来的", async () => {
    const { limiter, state } = setup({ maxMemoryEntries: 3 });
    state.mode = "fail";
    for (const key of ["a", "a", "b", "c", "d"]) await limiter.hit([check(key, 2)]);
    // a 是最早放进来的，已被挤掉：重新从 1 数起
    expect((await limiter.hit([check("a", 2)])).allowed).toBe(true);
    // d 还在：第二次到上限（减半后是 1）
    expect((await limiter.hit([check("d", 2)])).allowed).toBe(false);
  });

  it("没有配 Redis：一直用进程内计数", async () => {
    const limiter = createRateLimiter({ store: null, clock: createClock() });
    expect(await limiter.hit([check("a", 2)])).toMatchObject({ allowed: true, degraded: true });
    expect((await limiter.hit([check("a", 2)])).allowed).toBe(false);
  });
});
