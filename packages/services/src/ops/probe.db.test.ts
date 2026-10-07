import type { PrismaClient } from "@liyoxi/db";
import { beforeEach, describe, expect, it } from "vitest";
import { createTxRunner } from "../kernel/index.js";
import {
  createClock,
  createFakeProviders,
  useSeededDatabase,
  assembleForTest,
} from "../testing/index.js";
import { createAlerts } from "./alerts.js";
import { createProbe } from "./probe.js";
import { sqlProbeRules } from "./probe-rules.js";
import type { ProbeRule } from "./probe-rules.js";
const db = useSeededDatabase("services"),
  clock = createClock();
let prisma: PrismaClient;
const logger = { info() {}, warn() {}, error() {} };
beforeEach(async () => {
  await db.reset();
  prisma = await db.prisma();
  await prisma.$executeRawUnsafe(
    `INSERT INTO worker_lease(name,holder,holder_version,acquired_at,heartbeat_at) VALUES('primary','fixture:primary','test',clock_timestamp(),clock_timestamp())`,
  );
}, 60_000);
function build(rules: readonly ProbeRule[], budgetMs = 20_000, queryMs = 2_000) {
  const tx = createTxRunner({ prisma, appEnv: "test" });
  return createProbe({
    db: prisma,
    tx,
    clock,
    logger,
    holder: () => "fixture:primary",
    rules,
    budgetMs,
    queryMs,
    alerts: createAlerts({ tx, clock, logger, providers: createFakeProviders({ clock }) }),
    ensureRecurring: async () => {},
  });
}
const rule = (sample: ProbeRule["sample"], key = "fixture"): ProbeRule => ({
  key,
  sample,
  evaluate: () => [],
  fingerprints: [],
});
describe("真实租约/探针完成事实", () => {
  it("actual所有SQL查询在已接管结构上执行，缺备份真越限而非假green，完成写probe_at", async () => {
    const rules = sqlProbeRules(prisma, clock, assembleForTest({ entry: "worker" }));
    const result = await build(rules)();
    expect(result.completed).toBe(true);
    expect(result.failed).toBe(0);
    expect(result.samples).toBe(rules.length);
    expect(
      (await prisma.workerLease.findUniqueOrThrow({ where: { name: "primary" } })).probeAt,
    ).toEqual(clock.now());
    expect(await prisma.alertEvent.findFirst({ where: { rule: "backup.stale" } })).toMatchObject({
      severity: "P1",
      kind: "probe",
    });
  });
  it("并发采样上限3；运行中再调同轮复用，无重入", async () => {
    let active = 0,
      max = 0;
    const rules = Array.from({ length: 10 }, (_, n) =>
      rule(async () => {
        active++;
        max = Math.max(active, max);
        try {
          await prisma.$queryRawUnsafe("SELECT 1 AS n FROM pg_sleep(0.01)");
        } finally {
          active--;
        }
        return {};
      }, `fixture${n}`),
    );
    const probe = build(rules),
      first = probe(),
      second = probe();
    expect(first).toBe(second);
    expect((await first).samples).toBe(10);
    expect(max).toBe(3);
  });
  it("查询失败不能清旧领域告警，连续3失败才探针P2", async () => {
    const tx = createTxRunner({ prisma, appEnv: "test" }),
      alerts = createAlerts({ tx, clock, logger, providers: createFakeProviders({ clock }) });
    await alerts.breach({ rule: "timer.lag", severity: "P2", detail: {} });
    const failing: ProbeRule = {
      ...rule(async () => {
        await prisma.$queryRawUnsafe("SELECT fixture_missing_column FROM timer");
        return {};
      }),
      fingerprints: [{ rule: "timer.lag" }],
    };
    const probe = build([failing]);
    await probe();
    await probe();
    expect(await prisma.alertEvent.count({ where: { rule: "probe.failed" } })).toBe(0);
    const third = await probe();
    expect(third.failed).toBe(1);
    expect(await prisma.alertEvent.findFirst({ where: { rule: "probe.failed" } })).toMatchObject({
      severity: "P2",
    });
    expect(
      (await prisma.alertEvent.findFirstOrThrow({ where: { rule: "timer.lag" } })).okStreak,
    ).toBe(0);
  });
  it("整体超时不更新probe_at，未完成样本不会当0健康", async () => {
    const probe = build(
      [
        rule(async () => {
          await new Promise((resolve) => setTimeout(resolve, 80));
          return {};
        }),
      ],
      20,
      100,
    );
    const result = await probe();
    expect(result.completed).toBe(false);
    expect(result.samples).toBe(0);
    expect(result.elapsedMs).toBeLessThan(100);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(
      (await prisma.workerLease.findUniqueOrThrow({ where: { name: "primary" } })).probeAt,
    ).toBeNull();
  });
  it("采样期间接任后停止所有告警/完成写；share守卫拒绝旧holder", async () => {
    let release!: () => void, entered!: () => void;
    const arrived = new Promise<void>((resolve) => {
        entered = resolve;
      }),
      wait = new Promise<void>((resolve) => {
        release = resolve;
      });
    const sample: ProbeRule = {
      ...rule(async () => {
        entered();
        await wait;
        return { value: 1 };
      }),
      evaluate: () => [{ rule: "timer.lag", severity: "P1", detail: {} }],
      fingerprints: [{ rule: "timer.lag" }],
    };
    const running = build([sample])();
    await arrived;
    await prisma.workerLease.update({
      where: { name: "primary" },
      data: { holder: "fixture:new" },
    });
    release();
    expect(await running).toMatchObject({ completed: false, leaseLost: true });
    expect(await prisma.alertEvent.count()).toBe(0);
    expect(
      (await prisma.workerLease.findUniqueOrThrow({ where: { name: "primary" } })).probeAt,
    ).toBeNull();
    const tx = createTxRunner({ prisma, appEnv: "test" }),
      alerts = createAlerts({ tx, clock, logger, providers: createFakeProviders({ clock }) });
    await alerts.breach({ rule: "timer.lag", severity: "P1", detail: {} }, "fixture:primary");
    expect(await prisma.alertEvent.count()).toBe(0);
  });
});
