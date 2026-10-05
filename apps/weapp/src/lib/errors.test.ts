import { describe, expect, it, vi } from "vitest";

import { createErrorReporter, ERROR_REPORTS_PER_MINUTE, scrub } from "./errors";

// 自研错误上报器的用例（任务书 W0-27a 第 7 节第 7 条）。

const DSN = "https://public@errors.example.test/1";

function setup(options: { dsn?: string; wired?: boolean; userId?: string | null } = {}) {
  const state = { now: Date.parse("2026-10-05T12:00:00.000Z"), wired: options.wired ?? true };
  const send = vi.fn(async (_envelope: string) => undefined);
  let counter = 0;
  const reporter = createErrorReporter({
    clock: { now: () => state.now, sleep: async () => undefined },
    uuid: () => {
      counter += 1;
      return `66666666-6666-4666-8666-${String(counter).padStart(12, "0")}`;
    },
    dsn: options.dsn ?? DSN,
    sender: () => (state.wired ? send : undefined),
    client: () => ({ version: "1.2.3", platform: "ios", envVersion: "release" }),
    getUserId: () => options.userId ?? null,
  });
  return { reporter, send, state };
}

describe("发不发", () => {
  it("上报函数没接上、或没配 DSN：不发请求", () => {
    const unwired = setup({ wired: false });
    unwired.reporter.capture("error", new Error("boom"));
    expect(unwired.send).not.toHaveBeenCalled();

    const noDsn = setup({ dsn: "" });
    noDsn.reporter.capture("error", new Error("boom"));
    expect(noDsn.send).not.toHaveBeenCalled();
  });

  it("同一条错误一次会话只报一次；每分钟至多 10 条，过了这一分钟再放行", () => {
    const env = setup();
    env.reporter.capture("error", new Error("same"));
    env.reporter.capture("error", new Error("same"));
    expect(env.send).toHaveBeenCalledTimes(1);
    for (let index = 0; index < 30; index += 1) {
      env.reporter.capture("api", new Error(`e${index}`));
    }
    expect(env.send).toHaveBeenCalledTimes(ERROR_REPORTS_PER_MINUTE);
    env.state.now += 60_000;
    env.reporter.capture("api", new Error("later"));
    expect(env.send).toHaveBeenCalledTimes(ERROR_REPORTS_PER_MINUTE + 1);
  });

  it("上报函数抛错或拒绝：capture 不抛，也没有未处理的拒绝", async () => {
    const env = setup();
    env.send.mockRejectedValueOnce(new Error("offline"));
    expect(() => env.reporter.capture("error", new Error("a"))).not.toThrow();
    env.send.mockImplementationOnce(() => {
      throw new Error("sync");
    });
    expect(() => env.reporter.capture("error", new Error("b"))).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});

describe("信封与清洗", () => {
  it("信封三行：信封头带 DSN 与事件编号，条目头，事件带版本、环境、来路与用户 id", () => {
    const env = setup({ userId: "user-1" });
    env.reporter.capture("api", new TypeError("请求失败（502）"), { requestId: "rid-1" });
    const lines = (env.send.mock.calls[0]?.[0] ?? "").split("\n");
    expect(lines).toHaveLength(3);
    const [header, item, event] = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(header).toEqual({
      event_id: "66666666666646668666000000000001",
      sent_at: "2026-10-05T12:00:00.000Z",
      dsn: DSN,
    });
    expect(item).toEqual({ type: "event" });
    expect(event).toMatchObject({
      event_id: header?.event_id,
      level: "error",
      release: "1.2.3",
      environment: "release",
      tags: { kind: "api", clientPlatform: "ios", requestId: "rid-1" },
      user: { id: "user-1" },
      exception: { values: [{ type: "TypeError", value: "请求失败（502）" }] },
    });
  });

  it("手机号、统一社会信用代码、令牌打码；没登录时不带用户", () => {
    expect(
      scrub(
        "手机 13812345678 代码 91430100MA4L1ABC2X 令牌 lyxm_abc.DEF-123 头 Bearer eyJhbGciOi.x",
      ),
    ).toBe("手机 [phone] 代码 [uscc] 令牌 [token] 头 Bearer [token]");
    // 位数不对的数字串不动：20 位的单号、9 位的数字不是手机号也不是信用代码
    expect(scrub("单号 20261005123456789012 数 138123456")).toBe(
      "单号 20261005123456789012 数 138123456",
    );
    // 18 位纯数字与信用代码同形（身份证号也是这个样子）：宁可多打码
    expect(scrub("证件 110101199003074518")).toBe("证件 [uscc]");
    // 左边界：串首、紧挨着的分隔符都认，前面那个字符原样留下；前面多一位数字或大写字母就不认
    expect(scrub("13812345678,13912345678\n13712345678")).toBe("[phone],[phone]\n[phone]");
    expect(scrub("91430100MA4L1ABC2X/91430100MA4L1ABC2X")).toBe("[uscc]/[uscc]");
    expect(scrub("tel:13812345678 id=91430100MA4L1ABC2X")).toBe("tel:[phone] id=[uscc]");
    expect(scrub("A91430100MA4L1ABC2X")).toBe("A91430100MA4L1ABC2X");

    const env = setup();
    env.reporter.capture("handler", new Error("联系 13912345678"), { page: "lyxm_secret.x" });
    const event = JSON.parse((env.send.mock.calls[0]?.[0] ?? "").split("\n")[2] ?? "{}") as {
      user?: unknown;
      tags: Record<string, string>;
      exception: { values: { value: string }[] };
    };
    expect(event.user).toBeUndefined();
    expect(event.tags.page).toBe("[token]");
    expect(event.exception.values[0]?.value).toBe("联系 [phone]");
  });

  it("不是 Error 的东西也能报：字符串、对象", () => {
    const env = setup();
    env.reporter.capture("unhandledrejection", "纯字符串");
    env.reporter.capture("unhandledrejection", { errMsg: "request:fail" });
    const values = env.send.mock.calls.map(
      (call) =>
        (
          JSON.parse(call[0].split("\n")[2] ?? "{}") as {
            exception: { values: { value: string }[] };
          }
        ).exception.values[0]?.value,
    );
    expect(values).toEqual(["纯字符串", '{"errMsg":"request:fail"}']);
  });
});
