import { describe, expect, it } from "vitest";

import { badgeText } from "./text";

describe("数字角标的文字", () => {
  it("正整数原样；超过上限写成“上限+”", () => {
    expect(badgeText(1)).toBe("1");
    expect(badgeText(99)).toBe("99");
    expect(badgeText(100)).toBe("99+");
    expect(badgeText(12, 9)).toBe("9+");
    expect(badgeText(3.9)).toBe("3");
  });

  it("0、负数、不是数、没给：不显示", () => {
    for (const count of [0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, undefined]) {
      expect(badgeText(count)).toBeNull();
    }
  });
});
