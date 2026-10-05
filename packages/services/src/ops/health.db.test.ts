// 健康检查取数的连库用例（任务书 W0-22 第 7 节第 4、7 条；h01 第 2.5、3.13–3.15 节）。
// 走测试支架：自己的库与 Redis 前缀，缺省是应用角色 lyx_app。worker_lease 删不了，用例按先后改同一行。
import { describe, expect, it } from "vitest";

import { uuidv7 } from "../kernel/index.js";
import { createClock, useTestDatabase, useTestRedis } from "../testing/index.js";

import { createHealth, HEALTH_PROBE_TIMEOUT_MS } from "./index.js";
import type { HealthOptions } from "./index.js";

const db = useTestDatabase("services");
const redis = useTestRedis();
const TIMEOUT = { timeout: 60_000 };
const MINUTE = 60_000;

async function setup(overrides: Partial<HealthOptions> = {}) {
  const prisma = await db.prisma();
  const clock = createClock();
  const health = createHealth({
    db: prisma,
    redis: await redis.client(),
    clock,
    version: "sha-test",
    cacheMs: 0,
    ...overrides,
  });
  return { prisma, clock, health };
}

describe("/health 的聚合", () => {
  it("租约：没有行、新鲜、心跳过期、探针过旧、探针从未跑过", TIMEOUT, async () => {
    const { prisma, health } = await setup();

    expect(await health.summary()).toMatchObject({
      status: "degraded",
      version: "sha-test",
      db: "ok",
      redis: "ok",
      worker: "down",
      probeAgeSec: null,
      flow: "ok",
    });

    await prisma.$executeRaw`
      INSERT INTO worker_lease (name, holder, holder_version, acquired_at, heartbeat_at, probe_at)
      VALUES ('primary', 'node-a:test', 'sha-test', clock_timestamp(), clock_timestamp(), clock_timestamp())`;
    const fresh = await health.summary();
    expect(fresh).toMatchObject({ status: "ok", worker: "ok", flow: "ok" });
    expect(fresh.probeAgeSec).toBeGreaterThanOrEqual(0);
    expect(fresh.probeAgeSec).toBeLessThan(60);
    expect(Number.isNaN(Date.parse(fresh.time))).toBe(false);

    await prisma.$executeRaw`
      UPDATE worker_lease SET heartbeat_at = clock_timestamp() - interval '2 minutes'`;
    expect(await health.summary()).toMatchObject({ status: "degraded", worker: "down" });

    await prisma.$executeRaw`
      UPDATE worker_lease SET heartbeat_at = clock_timestamp(),
                              probe_at = clock_timestamp() - interval '4 minutes'`;
    const stale = await health.summary();
    expect(stale).toMatchObject({ status: "degraded", worker: "ok" });
    expect(stale.probeAgeSec).toBeGreaterThanOrEqual(240);

    await prisma.$executeRaw`UPDATE worker_lease SET probe_at = NULL`;
    expect(await health.summary()).toMatchObject({
      status: "degraded",
      worker: "ok",
      probeAgeSec: null,
    });

    // 留给后面的用例：租约与探针都新鲜
    await prisma.$executeRaw`
      UPDATE worker_lease SET heartbeat_at = clock_timestamp(), probe_at = clock_timestamp()`;
  });

  it(
    "flow：事件久未展开、定时器滞后、关键类定时器连续失败，任一成立即 degraded",
    TIMEOUT,
    async () => {
      const { prisma, clock, health } = await setup();
      expect(await health.summary()).toMatchObject({ status: "ok", flow: "ok" });

      // 一条刚发生、还没展开的事件：5 分钟之内不算
      const eventId = uuidv7();
      await prisma.outboxEvent.create({
        data: {
          id: eventId,
          eventType: "lyxtest.health_probe",
          payload: { v: 1 },
          actorType: "system",
          occurredAt: clock.now(),
        },
      });
      clock.advance(4 * MINUTE);
      expect((await health.summary()).flow).toBe("ok");
      clock.advance(2 * MINUTE);
      expect(await health.summary()).toMatchObject({ status: "degraded", flow: "degraded" });
      await prisma.outboxEvent.update({
        where: { id: eventId },
        data: { publishedAt: clock.now() },
      });
      expect((await health.summary()).flow).toBe("ok");

      // 到点没人认领的定时器：超过 10 分钟
      const lateId = uuidv7();
      await prisma.timer.create({
        data: {
          id: lateId,
          kind: "lyxtest.health_late",
          fireAt: new Date(clock.now().getTime() - 11 * MINUTE),
          dedupeKey: `lyxtest:${lateId}`,
        },
      });
      expect((await health.summary()).flow).toBe("degraded");
      await prisma.timer.update({ where: { id: lateId }, data: { status: "cancelled" } });
      expect((await health.summary()).flow).toBe("ok");

      // 关键类定时器（契约登记的 po.expire）连续失败 6 次：还没到点也算
      const failingId = uuidv7();
      await prisma.timer.create({
        data: {
          id: failingId,
          kind: "po.expire",
          fireAt: new Date(clock.now().getTime() + 60 * MINUTE),
          dedupeKey: `lyxtest:${failingId}`,
          attempts: 6,
        },
      });
      expect((await health.summary()).flow).toBe("degraded");
      await prisma.timer.update({ where: { id: failingId }, data: { status: "cancelled" } });
      expect((await health.summary()).flow).toBe("ok");
    },
  );

  it("Redis 探不通或到点不回：redis 为 down，整体 degraded", TIMEOUT, async () => {
    const refused = await setup({ redis: { ping: () => Promise.reject(new Error("连接被拒")) } });
    expect(await refused.health.summary()).toMatchObject({ status: "degraded", redis: "down" });

    const hanging = await setup({ redis: { ping: () => new Promise(() => {}) } });
    const startedAt = performance.now();
    expect(await hanging.health.summary()).toMatchObject({ redis: "down", db: "ok" });
    expect(performance.now() - startedAt).toBeGreaterThanOrEqual(HEALTH_PROBE_TIMEOUT_MS - 100);
  });

  it("库探不通：db、worker 为 down，flow 为 degraded，不抛错", TIMEOUT, async () => {
    const broken = { $queryRaw: () => Promise.reject(new Error("库连不上")) };
    const { health } = await setup({ db: broken as unknown as HealthOptions["db"] });
    expect(await health.summary()).toMatchObject({
      status: "degraded",
      db: "down",
      redis: "ok",
      worker: "down",
      probeAgeSec: null,
      flow: "degraded",
    });
  });

  it("结果在进程内缓存：缓存期内不再取数", TIMEOUT, async () => {
    const prisma = await db.prisma();
    let pings = 0;
    const health = createHealth({
      db: prisma,
      redis: { ping: async () => void (pings += 1) },
      clock: createClock(),
      version: "sha-test",
    });
    const first = await health.summary();
    expect(await health.summary()).toBe(first);
    expect(pings).toBe(1);
  });
});

describe("两条内网探活的框架", () => {
  it("各指标一律 null，全部计入 breaches，status 为 degraded", async () => {
    const health = createHealth({
      db: {
        $queryRaw: () => Promise.reject(new Error("用不到")),
      } as unknown as HealthOptions["db"],
      redis: { ping: () => Promise.resolve("PONG") },
      clock: createClock(),
      version: "sha-test",
    });

    const finance = health.finance();
    expect(finance.status).toBe("degraded");
    expect(finance.breaches).toEqual([
      "unappliedReceipt",
      "workerHeartbeatAgeSec",
      "timerLagSec",
      "webhookBacklog",
      "certificates",
      "billing.sweepLagSec",
      "billing.invariantRunAgeSec",
      "billing.openViolationCount",
      "billing.valuationAgeSec",
      "billing.oldestBlockedFulfillmentSec",
    ]);
    expect(finance.unappliedReceipt).toBeNull();
    expect(Object.values(finance.billing).every((value) => value === null)).toBe(true);

    const flow = health.flow();
    expect(flow.status).toBe("degraded");
    expect(flow.warnings).toEqual([]);
    expect(flow.breaches).toEqual([
      "oldestUnpublishedEventAgeSec",
      "oldestDueDeliveryAgeSec",
      "deadDeliveryCount",
      "timerLagSec",
      "failedTimerCount",
      "criticalTimerFailingCount",
      "stuckTicketCount",
    ]);
    expect(flow.stuckTicketCount).toBeNull();
  });
});
