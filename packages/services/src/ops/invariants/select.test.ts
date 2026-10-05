import { describe, expect, it } from "vitest";

import { defineRegistration } from "../../kernel/index.js";
import { assembleForTest } from "../../testing/index.js";
import { isFirstRoundOfDay } from "../retention.js";
import { isMonday, isTopOfHour, selectChecks } from "./select.js";

// 任务书 第 7 节验收 4：调度口径。不连库。

const run = async (): Promise<[]> => [];
const assembly = assembleForTest({
  entry: "worker",
  isolated: true,
  extra: [
    defineRegistration("lyxtest_a", {
      invariants: [
        { code: "lyxtest.full", severity: "P2", modes: ["full"], run },
        { code: "lyxtest.both", severity: "P1", modes: ["quick", "full"], run },
        { code: "lyxtest.hourly", severity: "P2", modes: ["quick", "full"], every: "hour", run },
        { code: "lyxtest.weekly", severity: "P2", modes: ["full"], every: "week", run },
        { code: "lyxtest.REPORTED", severity: "P2", modes: [], heal: "heal_only" },
      ],
    }),
    defineRegistration("lyxtest_b", {
      invariants: [{ code: "lyxtest.other", severity: "P2", modes: ["quick"], run }],
    }),
  ],
});
/** 北京时间的钟点写法 → 时刻 */
const bj = (text: string): Date => new Date(`${text}+08:00`);
const codes = (selection: Parameters<typeof selectChecks>[1]): string[] =>
  selectChecks(assembly.invariants, selection).map((check) => check.code);

describe("selectChecks：这次运行跑哪些检查项", () => {
  it("只挑登记了这种方式的；只经端口上报的（modes 为空）哪种方式都不跑", () => {
    // 2026-01-06 是周二
    expect(
      codes({ mode: "full", trigger: "schedule", scheduledFor: bj("2026-01-06T03:30") }),
    ).toEqual(["lyxtest.both", "lyxtest.full", "lyxtest.hourly"]);
    expect(
      codes({ mode: "quick", trigger: "schedule", scheduledFor: bj("2026-01-06T03:10") }),
    ).toEqual(["lyxtest.both", "lyxtest.other"]);
  });

  it("every: hour 的项在 quick 里只跑整点那一期；full 里照跑", () => {
    expect(
      codes({ mode: "quick", trigger: "schedule", scheduledFor: bj("2026-01-06T04:00") }),
    ).toEqual(["lyxtest.both", "lyxtest.hourly", "lyxtest.other"]);
    expect(
      codes({ mode: "quick", trigger: "schedule", scheduledFor: bj("2026-01-06T04:50") }),
    ).not.toContain("lyxtest.hourly");
  });

  it("every: week 的项只在周一的 full 里跑", () => {
    // 2026-01-05 是周一
    expect(
      codes({ mode: "full", trigger: "schedule", scheduledFor: bj("2026-01-05T03:30") }),
    ).toContain("lyxtest.weekly");
    expect(
      codes({ mode: "full", trigger: "schedule", scheduledFor: bj("2026-01-04T03:30") }),
    ).not.toContain("lyxtest.weekly");
  });

  it("every 只对定时触发生效：发布后、演练、手工触发跑该方式的全部检查项", () => {
    for (const trigger of ["deploy", "drill", "manual"] as const) {
      expect(codes({ mode: "full", trigger })).toEqual([
        "lyxtest.both",
        "lyxtest.full",
        "lyxtest.hourly",
        "lyxtest.weekly",
      ]);
      expect(codes({ mode: "quick", trigger })).toEqual([
        "lyxtest.both",
        "lyxtest.hourly",
        "lyxtest.other",
      ]);
    }
  });

  it("modules、codes 能限定；两个都给取交集", () => {
    expect(codes({ mode: "quick", trigger: "manual", modules: ["lyxtest_b"] })).toEqual([
      "lyxtest.other",
    ]);
    expect(
      codes({ mode: "full", trigger: "manual", codes: ["lyxtest.full", "lyxtest.other"] }),
    ).toEqual(["lyxtest.full"]);
    expect(
      codes({ mode: "full", trigger: "manual", modules: ["lyxtest_b"], codes: ["lyxtest.full"] }),
    ).toEqual([]);
  });
});

describe("按计划时刻判定（北京时间）", () => {
  it("整点、周一、当日第一轮", () => {
    expect(isTopOfHour(bj("2026-01-05T12:00"))).toBe(true);
    expect(isTopOfHour(bj("2026-01-05T12:10"))).toBe(false);
    // UTC 还是周日，北京时间已是周一
    expect(isMonday(new Date("2026-01-04T19:30:00Z"))).toBe(true);
    expect(isMonday(new Date("2026-01-05T19:30:00Z"))).toBe(false);
    expect(isFirstRoundOfDay(bj("2026-01-05T00:00"))).toBe(true);
    expect(isFirstRoundOfDay(new Date("2026-01-04T16:00:00Z"))).toBe(true);
    expect(isFirstRoundOfDay(bj("2026-01-05T01:00"))).toBe(false);
    expect(isFirstRoundOfDay(bj("2026-01-05T23:00"))).toBe(false);
  });
});
