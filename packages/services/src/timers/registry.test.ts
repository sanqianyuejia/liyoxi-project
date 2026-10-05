import { JOBS, TIMERS } from "@liyoxi/contract/registry";
import { describe, expect, it } from "vitest";

import { APP_ENVS, ASSEMBLY_ENTRIES, AssemblyError, defineRegistration } from "../kernel/index.js";
import type { ModuleRegistration } from "../kernel/index.js";
import {
  assembleForTest,
  SAMPLE_TIMER_CATALOG,
  SAMPLE_TIMER_KINDS,
  sampleTimerRegistration,
} from "../testing/index.js";
import { createTimers, TimerRegistryError } from "./index.js";

// 任务书 第 7 节验收 11：定时器处理器与周期任务的登记项，名字不在契约里、同名重复、critical 与契约不一致，
// 各在装配时报错。同名重复由 kernel 的装配报（AssemblyError）；另两样由 createTimers 对照契约时报。不连库。

const handle = async (): Promise<"fired"> => "fired";
const run = async (): Promise<void> => undefined;

/** 只装这一份样例登记（不带真实模块），对照契约的登记建 timers */
const build = (registration: ModuleRegistration): unknown =>
  createTimers({
    assembly: assembleForTest({ entry: "worker", isolated: true, extra: [registration] }),
  });

const issuesOf = (registration: ModuleRegistration): readonly string[] => {
  try {
    build(registration);
  } catch (error) {
    if (error instanceof TimerRegistryError) return error.issues;
    throw error;
  }
  return [];
};

describe("对照契约：名字", () => {
  it("定时器处理器的名字不在契约里：报错", () => {
    const issues = issuesOf(
      defineRegistration("lyxtest_bad", { timerHandlers: [{ kind: "lyxtest.nowhere", handle }] }),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatch(/lyxtest\.nowhere.*lyxtest_bad.*不在契约的定时器登记里/);
  });

  it("周期任务的名字不在契约里：报错", () => {
    const issues = issuesOf(
      defineRegistration("lyxtest_bad", {
        recurringJobs: [{ kind: "lyxtest.nowhere", schedule: { every: "hour" }, run }],
      }),
    );
    expect(issues).toEqual([expect.stringMatching(/lyxtest\.nowhere.*不在契约的周期任务登记里/)]);
  });

  it("把周期任务名登记成定时器处理器（或反过来）：按各自的登记查，都报错", () => {
    const issues = issuesOf(
      defineRegistration("lyxtest_bad", {
        timerHandlers: [{ kind: "ops.retention", handle }],
        recurringJobs: [{ kind: "order.start", schedule: { every: "hour" }, run }],
      }),
    );
    expect(issues).toEqual([
      expect.stringMatching(/定时器处理器 ops\.retention.*不在契约的定时器登记里/),
      expect.stringMatching(/周期任务 order\.start.*不在契约的周期任务登记里/),
    ]);
  });

  it("同名重复：装配时就报错（kernel 的装配查重名）", () => {
    const twice = (module: string): ModuleRegistration =>
      defineRegistration(module, { timerHandlers: [{ kind: "sla.breach", handle }] });
    expect(() =>
      assembleForTest({
        entry: "worker",
        isolated: true,
        extra: [twice("lyxtest_a"), twice("lyxtest_b")],
      }),
    ).toThrow(AssemblyError);
    const jobs = (module: string): ModuleRegistration =>
      defineRegistration(module, {
        recurringJobs: [{ kind: "ops.retention", schedule: { every: "hour" }, run }],
      });
    expect(() =>
      assembleForTest({
        entry: "api",
        isolated: true,
        extra: [jobs("lyxtest_a"), jobs("lyxtest_b")],
      }),
    ).toThrow(/ops\.retention.*重名/s);
  });
});

describe("对照契约：关键类", () => {
  it("契约登记为关键类，处理器没有写 critical：报错", () => {
    const issues = issuesOf(
      defineRegistration("lyxtest_bad", { timerHandlers: [{ kind: "order.start", handle }] }),
    );
    expect(issues).toEqual([
      expect.stringMatching(/order\.start.*critical 与契约不一致.*是关键类/),
    ]);
  });

  it("契约登记为非关键类，处理器写了 critical：报错", () => {
    const issues = issuesOf(
      defineRegistration("lyxtest_bad", {
        timerHandlers: [{ kind: "sla.breach", critical: true, handle }],
      }),
    );
    expect(issues).toEqual([expect.stringMatching(/sla\.breach.*critical 与契约不一致.*非关键类/)]);
  });

  it("与契约一致：建得起来，查得到关键类、主体与跳过后可复活", () => {
    const timers = createTimers({
      assembly: assembleForTest({
        entry: "worker",
        isolated: true,
        extra: [
          defineRegistration("lyxtest_ok", {
            timerHandlers: [
              { kind: "order.start", critical: true, rearmAfterSkip: true, handle },
              { kind: "sla.breach", handle },
            ],
            recurringJobs: [
              {
                kind: "ops.retention",
                schedule: { every: "hour" },
                mode: "tx",
                missSeverity: "P3",
                run,
              },
            ],
          }),
        ],
      }),
    });
    expect(timers.registry.timer("order.start")).toEqual({
      kind: "order.start",
      subjects: ["drama_order"],
      critical: true,
      rearmAfterSkip: true,
    });
    expect(timers.registry.timer("sla.breach")).toMatchObject({
      critical: false,
      rearmAfterSkip: false,
    });
    expect(timers.registry.timer("sla.breach")?.subjects).toContain("delivery_ticket_stage");
    // 契约里有、这个环境没有登记处理器的 kind 也查得到（登记方可以先 arm）
    expect(timers.registry.timer("usage.end")).toMatchObject({
      critical: true,
      rearmAfterSkip: false,
    });
    expect(timers.registry.timer("ops.retention")).toBeUndefined();
    expect(timers.registry.isJob("ops.retention")).toBe(true);
    expect(timers.registry.recurringJobs.map((job) => job.kind)).toEqual(["ops.retention"]);
  });
});

describe("周期任务的字段", () => {
  it("没写节奏、节奏写错、模式与级别不认识、数值不是正整数：一次列全", () => {
    const issues = issuesOf(
      defineRegistration("lyxtest_bad", {
        timerHandlers: [{ kind: "sla.breach", maxLateMinutes: 0, handle }],
        recurringJobs: [
          { kind: "ops.retention", run },
          { kind: "ops.cert_check", schedule: { every: "day", at: "25:00" }, run },
          {
            kind: "media.sweep",
            schedule: { every: "minutes", minutes: 10 },
            mode: "batch" as never,
            missSeverity: "P9" as never,
            leaseSec: 0,
            maxAttempts: 1.5,
            deadlineMin: -1,
            run,
          },
        ],
      }),
    );
    expect(issues).toEqual([
      expect.stringMatching(/sla\.breach.*maxLateMinutes/),
      expect.stringMatching(/media\.sweep.*mode/),
      expect.stringMatching(/media\.sweep.*missSeverity/),
      expect.stringMatching(/media\.sweep.*leaseSec/),
      expect.stringMatching(/media\.sweep.*maxAttempts/),
      expect.stringMatching(/media\.sweep.*deadlineMin/),
      expect.stringMatching(/ops\.cert_check.*HH:mm/),
      expect.stringMatching(/ops\.retention.*没有写节奏/),
    ]);
  });
});

describe("真实的登记与契约", () => {
  it.each(ASSEMBLY_ENTRIES)("%s 入口：四个环境下真实模块的登记都对得上契约", (entry) => {
    for (const appEnv of APP_ENVS) {
      // 不给 extra 的测试装配就是真实模块的装配
      expect(() => createTimers({ assembly: assembleForTest({ entry, appEnv }) })).not.toThrow();
    }
  });

  it("契约里同一个 kind 的各个主体关键类一致；定时器与周期任务不共名", () => {
    for (const kind of new Set(TIMERS.map((item) => item.kind))) {
      const flags = new Set(
        TIMERS.filter((item) => item.kind === kind).map((item) => item.critical),
      );
      expect([kind, flags.size]).toEqual([kind, 1]);
    }
    const jobs = new Set<string>(JOBS.map((job) => job.kind));
    expect(TIMERS.filter((item) => jobs.has(item.kind))).toEqual([]);
  });

  it("样例登记配上带样例的名字来源建得起来；不带就报样例的名字不在契约里", () => {
    const assembly = assembleForTest({ entry: "worker", extra: [sampleTimerRegistration] });
    const timers = createTimers({ assembly, catalog: SAMPLE_TIMER_CATALOG });
    expect(timers.registry.timer(SAMPLE_TIMER_KINDS.revivable)).toMatchObject({
      critical: true,
      rearmAfterSkip: true,
    });
    expect(() => createTimers({ assembly })).toThrow(TimerRegistryError);
  });
});
