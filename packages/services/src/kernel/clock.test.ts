import { describe, expect, it } from "vitest";

import { createClock } from "../testing/index.js";
import { systemClock } from "./clock.js";
import type { Clock } from "./clock.js";

// 验收第 7 条：拨动后 clock.now() 改变；W0-05b 的可拨时钟满足 kernel 的 Clock 接口。

/** 一个取业务时间的服务函数：只认 Clock */
const stamp = (clock: Clock): string => clock.now().toISOString();

describe("Clock", () => {
  it("可拨时钟满足 Clock 接口；不拨不走，拨动后 now() 改变", () => {
    const adjustable = createClock(new Date("2026-03-01T00:00:00.000Z"));
    // 这一行编译得过，就是“满足接口”：可拨时钟直接当 Clock 传
    const clock: Clock = adjustable;
    expect(stamp(clock)).toBe("2026-03-01T00:00:00.000Z");
    expect(stamp(clock)).toBe("2026-03-01T00:00:00.000Z");
    adjustable.advance(90_000);
    expect(stamp(clock)).toBe("2026-03-01T00:01:30.000Z");
    adjustable.set(new Date("2025-12-31T16:00:00.000Z"));
    expect(stamp(clock)).toBe("2025-12-31T16:00:00.000Z");
  });

  it("now() 每次给一个新的 Date：改它不影响时钟", () => {
    const clock: Clock = createClock(new Date("2026-03-01T00:00:00.000Z"));
    clock.now().setFullYear(1999);
    expect(stamp(clock)).toBe("2026-03-01T00:00:00.000Z");
    expect(systemClock.now()).not.toBe(systemClock.now());
  });

  it("系统时钟跟着系统时间走", () => {
    const before = Date.now();
    const at = systemClock.now().getTime();
    expect(at).toBeGreaterThanOrEqual(before);
    expect(at).toBeLessThanOrEqual(Date.now());
  });
});
