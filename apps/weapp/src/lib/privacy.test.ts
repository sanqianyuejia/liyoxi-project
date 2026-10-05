import { describe, expect, it, vi } from "vitest";

import { createPrivacy } from "./privacy";

// 隐私封装的用例（任务书 W0-27a 第 7 节第 5 条）。

describe("ensurePrivacyAuthorized 与 withPrivacy", () => {
  it("未授权时先走授权，再调隐私接口：三步的先后固定", async () => {
    const order: string[] = [];
    const { withPrivacy } = createPrivacy({
      getPrivacySetting: async () => {
        order.push("getPrivacySetting");
        return { needAuthorization: true };
      },
      requirePrivacyAuthorize: async () => void order.push("requirePrivacyAuthorize"),
    });
    const result = await withPrivacy(async () => {
      order.push("chooseMedia");
      return "file";
    });
    expect(order).toEqual(["getPrivacySetting", "requirePrivacyAuthorize", "chooseMedia"]);
    expect(result).toEqual({ ok: true, value: "file" });
  });

  it("已经授权过：不再弹，直接调隐私接口", async () => {
    const requirePrivacyAuthorize = vi.fn(async () => undefined);
    const { ensurePrivacyAuthorized } = createPrivacy({
      getPrivacySetting: async () => ({ needAuthorization: false }),
      requirePrivacyAuthorize,
    });
    await expect(ensurePrivacyAuthorized()).resolves.toBe(true);
    expect(requirePrivacyAuthorize).not.toHaveBeenCalled();
  });

  it("用户拒绝：返回可识别的结果，不调隐私接口，没有未捕获的异常", async () => {
    const call = vi.fn();
    const { ensurePrivacyAuthorized, withPrivacy } = createPrivacy({
      getPrivacySetting: async () => ({ needAuthorization: true }),
      requirePrivacyAuthorize: async () => {
        throw Object.assign(
          new Error("requirePrivacyAuthorize:fail privacy permission is not authorized"),
          {
            errno: 104,
          },
        );
      },
    });
    await expect(ensurePrivacyAuthorized()).resolves.toBe(false);
    await expect(withPrivacy(call)).resolves.toEqual({ ok: false, reason: "declined" });
    expect(call).not.toHaveBeenCalled();
  });

  it("老基础库没有这两个接口、或查设置失败：放行", async () => {
    await expect(createPrivacy({}).ensurePrivacyAuthorized()).resolves.toBe(true);
    const failing = createPrivacy({
      getPrivacySetting: async () => {
        throw new Error("getPrivacySetting:fail");
      },
      requirePrivacyAuthorize: async () => undefined,
    });
    await expect(failing.ensurePrivacyAuthorized()).resolves.toBe(true);
  });
});
