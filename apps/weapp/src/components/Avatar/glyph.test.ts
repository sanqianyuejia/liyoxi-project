import { describe, expect, it } from "vitest";

import { firstGlyph } from "./glyph";

describe("字形头像取字", () => {
  it("取第一个字，不管后面多长；首尾空白不算", () => {
    expect(firstGlyph("云间火锅")).toBe("云");
    expect(firstGlyph("  王** ")).toBe("王");
    expect(firstGlyph("Liyoxi")).toBe("L");
  });

  it("按码点取：代理对不劈开", () => {
    expect(firstGlyph("𠮷野家")).toBe("𠮷");
  });

  it("空串、全是空白、没给：空串", () => {
    expect(firstGlyph("")).toBe("");
    expect(firstGlyph("   ")).toBe("");
    expect(firstGlyph(undefined)).toBe("");
  });
});
