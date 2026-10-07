import type { PrismaClient } from "@liyoxi/db";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { assembleServices } from "../assembly.js";
import { createEvents } from "../events/index.js";
import {
  createIdentityContext,
  createTxRunner,
  detach,
  isInTransaction,
  uuidv7,
} from "../kernel/index.js";
import type { AlertInput, Alerts, TxRunner } from "../kernel/index.js";
import {
  createClock,
  createFactories,
  createFakeProviders,
  sampleStaffContext,
  useSeededDatabase,
} from "../testing/index.js";
import { armRecurringSlot, claimTimers, createTimers, runTimer } from "../timers/index.js";
import type { TimerRef, TimerRunDeps } from "../timers/index.js";
import { bindCalendarCoverage, createCalendarAdmin } from "./index.js";
import type { CalendarImportActor } from "./index.js";

const db = useSeededDatabase("services");
const clock = createClock(new Date("2035-01-01T02:00:00Z"));
const assembly = assembleServices({ entry: "worker", appEnv: "test" });
const registry = createTimers({ assembly }).registry;
const kind = "calendar.coverage_check";
const noop: Alerts = { raise: async () => {} };
let prisma: PrismaClient;
let tx: TxRunner;
let actor: CalendarImportActor;

beforeAll(async () => {
  prisma = await db.prisma();
  tx = createTxRunner({ prisma, appEnv: "test" });
  const staff = await createFactories({ db: prisma, clock }).staff({ staffRoleKey: "super_admin" });
  actor = {
    staff: await sampleStaffContext(prisma, staff.id),
    identity: createIdentityContext({ actor: { type: "staff", id: staff.id, client: "admin" } }),
  };
}, 120_000);
beforeEach(async () => {
  // 只清本测试支架拥有的隔离库；每个测试都走真实 arm/claim/run，不直接改运输状态。
  await prisma.timer.deleteMany();
});

function runner(runnerTx = tx): TimerRunDeps {
  return { tx: runnerTx, assembly, registry, clock, alerts: noop };
}
async function claim(): Promise<TimerRef> {
  // 实际已过的月度栅格；claim 的租约仍使用 DB 时间，覆盖事实仅使用注入业务 clock。
  const slot = new Date("2026-01-01T02:00:00Z");
  expect(await tx.run((one) => armRecurringSlot(one, kind, slot))).toBe(true);
  const result = await tx.run((one) => claimTimers(one, registry, clock.now(), 1));
  expect(result.claimed).toHaveLength(1);
  expect(result.failed).toEqual([]);
  expect(result.claimed[0]?.kind).toBe(kind);
  return result.claimed[0]!;
}

describe("W2-05 coverage：真实周期入口与独立告警边界", () => {
  it("独立告警提交后周期事务回滚，存活祖先仍拒绝 Provider 外呼", async () => {
    const providers = createFakeProviders({ clock });
    const alertId = uuidv7();
    const boom = new Error("测试：告警提交之后周期处理器失败");
    let raised = 0;
    const unbind = bindCalendarCoverage({
      clock,
      detach,
      alerts: {
        async raise(input) {
          raised++;
          expect(isInTransaction()).toBe(false);
          await expect(
            providers.wechat.checkText({ openid: "fake", scene: "profile", content: "边界" }),
          ).rejects.toMatchObject({ kind: "external_call_in_transaction" });
          expect(providers.wechat.calls).toEqual([]);
          await tx.run(async (independent) => {
            expect(isInTransaction()).toBe(true);
            await independent.alertEvent.create({
              data: {
                id: alertId,
                fingerprint: `${input.rule}:${input.dimension}`,
                rule: input.rule,
                severity: input.severity,
                kind: "event",
                status: "open",
                firstSeenAt: clock.now(),
                lastSeenAt: clock.now(),
                lastValue: { from: String(input.detail.from) },
              },
            });
          });
          expect((await prisma.alertEvent.findUnique({ where: { id: alertId } }))?.rule).toBe(
            "calendar.coverage_gap",
          );
          throw boom;
        },
      },
    });
    let first = true;
    const faultTx: TxRunner = {
      run: (fn, options) =>
        tx.run(async (outer) => {
          if (first) {
            first = false;
            await outer.bizSequence.create({
              data: { prefix: "CV", bizDate: new Date("2035-01-01"), nextVal: 1 },
            });
          }
          return fn(outer);
        }, options),
    };
    try {
      const ref = await claim();
      expect(await runTimer(runner(faultTx), ref)).toBe("retry");
      expect(raised).toBe(1);
      expect(await prisma.bizSequence.count({ where: { prefix: "CV" } })).toBe(0);
      expect(await prisma.alertEvent.findUnique({ where: { id: alertId } })).toMatchObject({
        rule: "calendar.coverage_gap",
        severity: "P3",
        occurrences: 1,
        lastValue: { from: "2035-01-01" },
      });
      expect(await prisma.timer.findUnique({ where: { id: ref.timerId } })).toMatchObject({
        status: "scheduled",
        firedAt: null,
        attempts: 1,
        lastError: expect.stringContaining(boom.message),
      });
      // 祖先已结束，正常事务外 Provider 才能进入同一替身。
      await expect(
        providers.wechat.checkText({ openid: "fake", scene: "profile", content: "事务外" }),
      ).resolves.toMatchObject({ ok: true });
      expect(providers.wechat.calls).toHaveLength(1);
    } finally {
      unbind();
    }
  });

  it("真实导入持排他锁时周期共享读等待提交，随后只读取完整安排", async () => {
    const inputs: AlertInput[] = [];
    const unbind = bindCalendarCoverage({
      clock,
      detach,
      alerts: { raise: async (input) => void inputs.push(input) },
    });
    let held!: () => void;
    let release!: () => void;
    let holderPid = 0;
    const acquired = new Promise<void>((resolve) => {
      held = resolve;
    });
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const importTx: TxRunner = {
      run: (fn, options) =>
        tx.run(async (one) => {
          const result = await fn(one);
          const [row] = await one.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
          holderPid = row!.pid;
          held();
          await released;
          return result;
        }, options),
    };
    const calendar = createCalendarAdmin({
      tx: importTx,
      clock,
      events: createEvents({ assembly, clock, tx }),
    });
    const ref = await claim();
    const importing = calendar.import(actor, {
      year: 2035,
      days: [],
      source: "测试：真实自定义安排",
    });
    await acquired;
    const checking = runTimer(runner(), ref);
    try {
      await vi.waitFor(
        async () => {
          const [row] = await prisma.$queryRaw<Array<{ n: number }>>`
          SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE datname=current_database() AND ${holderPid}::int=ANY(pg_blocking_pids(pid))`;
          expect(row?.n).toBe(1);
        },
        { timeout: 3000, interval: 10 },
      );
      expect(inputs).toEqual([]);
      expect(
        await prisma.workCalendarDay.count({
          where: { day: { gte: new Date("2035-01-01"), lt: new Date("2036-01-01") } },
        }),
      ).toBe(0);
    } finally {
      release();
      try {
        await importing;
        expect(await checking).toBe("fired");
      } finally {
        unbind();
      }
    }
    expect(inputs).toEqual([]);
    expect(
      await prisma.workCalendarDay.count({
        where: { day: { gte: new Date("2035-01-01"), lt: new Date("2036-01-01") } },
      }),
    ).toBe(365);
    expect(await prisma.timer.findUnique({ where: { id: ref.timerId } })).toMatchObject({
      status: "fired",
      result: { alerts: 0 },
    });
  });

  it("解绑后真实周期入口明确失败，不把缺少告警装配当作成功", async () => {
    const ref = await claim();
    expect(await runTimer(runner(), ref)).toBe("retry");
    expect(await prisma.timer.findUnique({ where: { id: ref.timerId } })).toMatchObject({
      status: "scheduled",
      lastError: expect.stringContaining("尚未装配独立告警边界"),
    });
  });
});
