// 右上角通知的口径（规范 第 5.3 节“轻提示”、第 8 节）：失败的不自动消失、图标是感叹号；成功的 4 秒后消失、图标是对勾。
// 不渲染：给一个假的通知实例，断言交给它的参数。
import type { NotificationInstance } from "antd/es/notification/interface";
import { isValidElement, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { setNotifier, showApiNotice, showSuccessNotice, SUCCESS_NOTICE_SECONDS } from "./feedback";

function fakeNotifier() {
  const error = vi.fn();
  const success = vi.fn();
  setNotifier({ error, success } as unknown as NotificationInstance);
  return { error, success };
}

const iconOf = (args: { icon?: unknown }): ReactElement<{ name: string; size: number }> => {
  expect(isValidElement(args.icon)).toBe(true);
  return args.icon as ReactElement<{ name: string; size: number }>;
};

afterEach(() => {
  setNotifier(null);
  vi.restoreAllMocks();
});

describe("失败的通知", () => {
  it("不自动消失；图标是 16px 的感叹号；带请求编号时写在说明里", () => {
    const { error } = fakeNotifier();
    showApiNotice({
      symbol: "INTERNAL",
      message: "服务异常，请稍后重试",
      requestIdTail: "1a2b3c4d",
    });
    expect(error).toHaveBeenCalledTimes(1);
    const args = error.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(args.duration).toBe(false);
    expect(args.placement).toBe("topRight");
    expect(args.title).toBe("服务异常，请稍后重试");
    expect(args.description).toBe("请求编号 1a2b3c4d");
    expect(iconOf(args).props).toMatchObject({ name: "alert-circle", size: 16 });
  });

  it("同一句话用同一个键：连着失败几次只留一条；不同的话各留各的", () => {
    const { error } = fakeNotifier();
    const notice = {
      symbol: "RATE_LIMITED",
      message: "操作太频繁，请稍后再试",
      requestIdTail: null,
    };
    showApiNotice(notice);
    showApiNotice(notice);
    showApiNotice({ ...notice, message: "该事项已被林晓处理" });
    const keys = error.mock.calls.map((call) => (call[0] as { key: string }).key);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[0]);
    expect((error.mock.calls[0]?.[0] as { description?: string }).description).toBeUndefined();
  });

  it("外壳还没挂上通知实例时打到控制台，不抛错", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    showApiNotice({ symbol: "INTERNAL", message: "服务异常", requestIdTail: null });
    expect(log).toHaveBeenCalledWith("服务异常", "");
  });
});

describe("成功的通知", () => {
  it("4 秒后消失；图标是 16px 的对勾", () => {
    const { success } = fakeNotifier();
    showSuccessNotice("晴天洗衣：账号已禁用");
    const args = success.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(SUCCESS_NOTICE_SECONDS).toBe(4);
    expect(args.duration).toBe(4);
    expect(args.title).toBe("晴天洗衣：账号已禁用");
    expect(iconOf(args).props).toMatchObject({ name: "check", size: 16 });
  });

  it("操作结果用状态播报：成功的通知 role 是 status；失败的不给 role，沿用 antd 缺省的 alert", () => {
    const { success, error } = fakeNotifier();
    showSuccessNotice("晴天洗衣：账号已禁用");
    showApiNotice({ symbol: "INTERNAL", message: "服务异常，请稍后重试", requestIdTail: null });
    expect((success.mock.calls[0]?.[0] as Record<string, unknown>).role).toBe("status");
    expect(error.mock.calls[0]?.[0] as Record<string, unknown>).not.toHaveProperty("role");
  });
});
