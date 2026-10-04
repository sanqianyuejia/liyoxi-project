import { describe, expect, it } from "vitest";

import {
  canAction,
  hasModuleLevel,
  isReleased,
  moduleLevelOf,
  NO_ACCESS_SOURCE,
  type AccessSnapshot,
} from "./permissions";

const access: AccessSnapshot = {
  staff: { id: "s2", name: "林晓", roleKey: "delivery_manager", roleName: "交付经理" },
  isLead: false,
  moduleLevels: { order: "v", delivery: "o", merchant: "e" },
  actions: ["merchant.manager.assign"],
  dataScope: "own",
  releases: { "release.partner": true, "release.notice_faq": false },
};

describe("模块等级", () => {
  it("n < v < o < e；没列的模块按 n", () => {
    expect(moduleLevelOf(access, "finance")).toBe("n");
    expect(hasModuleLevel(access, "finance")).toBe(false);
    expect(hasModuleLevel(access, "order", "v")).toBe(true);
    expect(hasModuleLevel(access, "order", "o")).toBe(false);
    expect(hasModuleLevel(access, "delivery", "v")).toBe(true);
    expect(hasModuleLevel(access, "delivery", "e")).toBe(false);
    expect(hasModuleLevel(access, "merchant", "e")).toBe(true);
  });

  it("没登录一律不够", () => {
    expect(hasModuleLevel(null, "workbench")).toBe(false);
    expect(canAction(null, "merchant.manager.assign")).toBe(false);
  });
});

describe("权限点与开关", () => {
  it("权限点按已开启的清单判断", () => {
    expect(canAction(access, "merchant.manager.assign")).toBe(true);
    expect(canAction(access, "refund.execute")).toBe(false);
  });

  it("开关键为 null 表示不受控；没列的与写了 false 的都按关", () => {
    expect(isReleased(access, null)).toBe(true);
    expect(isReleased(access, "release.partner")).toBe(true);
    expect(isReleased(access, "release.notice_faq")).toBe(false);
    expect(isReleased(access, "release.reports_v11")).toBe(false);
    expect(isReleased(null, "release.partner")).toBe(false);
  });

  it("缺省来源表示没有登录", async () => {
    await expect(NO_ACCESS_SOURCE.load()).resolves.toBeNull();
  });
});
