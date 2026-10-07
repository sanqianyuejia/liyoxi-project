import { afterAll, beforeAll, expect, it } from "vitest";
import { Queue } from "bullmq";
import { createClock, useTestRedis } from "../testing/index.js";
import { ACTIVE_PROBE_QUEUES, createQueueProbes } from "./queue-probes.js";
const redis = useTestRedis();
const clock = createClock(new Date());
let probes: ReturnType<typeof createQueueProbes>, queue: Queue;
beforeAll(async () => {
  const client = await redis.raw();
  const prefix = `${redis.prefix}ops`;
  queue = new Queue("promote", { connection: client, prefix });
  probes = createQueueProbes({ redisUrl: process.env.REDIS_URL!, prefix, clock });
});
afterAll(async () => {
  await probes.close();
  await queue.close();
});
it("仅三个真实在运队列；暂停队列也量待执行量/最旧时间，恢复后暂停时长归零", async () => {
  expect(Object.keys(ACTIVE_PROBE_QUEUES)).toEqual(["outbox_delivery", "timer_run", "promote"]);
  const rule = probes.rules.find((r) => r.key === "queue.promote")!;
  await queue.pause();
  await queue.addBulk(
    Array.from({ length: 101 }, (_, n) => ({
      name: "read-only-test",
      data: { n },
      opts: { timestamp: clock.now().getTime() - (n === 0 ? 60_000 : 0) },
    })),
  );
  clock.set(new Date());
  const initial = await rule.sample();
  expect(initial).toMatchObject({
    waiting: 101,
    active: 0,
    failed: 0,
    pausedForSec: expect.any(Number),
  });
  clock.advance(601_000);
  const value = await rule.sample();
  expect(Number(value["pausedForSec"]) - Number(initial["pausedForSec"])).toBeCloseTo(601, 6);
  expect(value["pausedSinceSource"]).toBe("queue_event");
  expect(value["failedRecent"]).toBe(0);
  expect(value["failedRecentTruncated"]).toBe(false);
  expect(Number(value["ageSec"])).toBeGreaterThanOrEqual(661);
  expect(rule.evaluate(value)).toMatchObject([
    { rule: "queue.backlog", dimension: "promote", severity: "P2" },
  ]);
  await queue.resume();
  expect((await rule.sample())["pausedForSec"]).toBe(0);
  expect((await probes.rules.find((r) => r.key === "redis")!.sample())["available"]).toBe(true);
  expect(await queue.getWaitingCount()).toBe(101);
});
it("显式配置的待执行量 P1 升级真实生效；仅年龄/暂停超时仍是 P2", async () => {
  const tuned = createQueueProbes({
    redisUrl: process.env.REDIS_URL!,
    prefix: `${redis.prefix}tuned`,
    clock,
    thresholds: { "queue.promote": { p2: 2, p1: 4 } },
  });
  try {
    const rule = tuned.rules.find((r) => r.key === "queue.promote")!;
    expect(rule.evaluate({ waiting: 2, ageSec: 0, pausedForSec: 0 })).toEqual([]);
    expect(rule.evaluate({ waiting: 4, ageSec: 0, pausedForSec: 0 })[0]?.severity).toBe("P2");
    expect(rule.evaluate({ waiting: 5, ageSec: 0, pausedForSec: 0 })[0]?.severity).toBe("P1");
    expect(rule.evaluate({ waiting: 0, ageSec: 301, pausedForSec: 0 })[0]?.severity).toBe("P2");
  } finally {
    await tuned.close();
  }
});
