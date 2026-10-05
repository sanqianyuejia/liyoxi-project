import { describe, expect, it } from "vitest";

import { clampPercent } from "./percent";

describe("进度取整", () => {
  it("落在 0–100，四舍五入到整数", () => {
    expect(clampPercent(0)).toBe(0);
    expect(clampPercent(45.4)).toBe(45);
    expect(clampPercent(45.5)).toBe(46);
    expect(clampPercent(100)).toBe(100);
    expect(clampPercent(120)).toBe(100);
    expect(clampPercent(-3)).toBe(0);
  });

  it("不是数、没给：按 0 算", () => {
    expect(clampPercent(undefined)).toBe(0);
    expect(clampPercent(Number.NaN)).toBe(0);
    expect(clampPercent(Number.POSITIVE_INFINITY)).toBe(0);
  });
});
