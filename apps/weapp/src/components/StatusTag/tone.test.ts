import { STATUS_TONE_GROUPS } from "@liyoxi/shared/design/status-tone";
import { describe, expect, it } from "vitest";

import { merchantStatusByEnum, merchantStatusByState } from "./tone";

describe("业务状态 → 商家端的色调", () => {
  it("按“表.列”与取值找：取商家端那一侧的色调与叫法", () => {
    expect(merchantStatusByEnum("drama_order.status", "producing")).toEqual({
      tone: "info",
      label: "制作中",
    });
    // 同一个状态两端颜色可以不同：待开工，商家端蓝、后台橙
    expect(merchantStatusByEnum("drama_order.status", "pending_start")?.tone).toBe("info");
    expect(merchantStatusByState("drama-order", "上线中")).toEqual({
      tone: "success",
      label: "上线中",
    });
  });

  it("字典里没有的、商家端不出现的：null", () => {
    expect(merchantStatusByEnum("drama_order.status", "no_such_value")).toBeNull();
    expect(merchantStatusByEnum("no_such.column", "x")).toBeNull();
    expect(merchantStatusByState("no-such-group", "x")).toBeNull();
    const adminOnly = STATUS_TONE_GROUPS.flatMap((group) =>
      group.entries.filter((entry) => entry.merchant === null).map((entry) => ({ group, entry })),
    )[0];
    expect(adminOnly).toBeDefined();
    if (adminOnly) {
      expect(merchantStatusByState(adminOnly.group.key, adminOnly.entry.state)).toBeNull();
    }
  });

  it("字典里商家端的每一条都落在五种色调里（没有紫色）", () => {
    const tones = new Set(["success", "info", "warning", "danger", "neutral"]);
    for (const group of STATUS_TONE_GROUPS) {
      for (const entry of group.entries) {
        const status = merchantStatusByState(group.key, entry.state);
        if (status) expect(tones.has(status.tone), `${group.key} ${entry.state}`).toBe(true);
      }
    }
  });
});
