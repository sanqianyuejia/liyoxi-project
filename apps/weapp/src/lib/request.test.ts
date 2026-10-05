import { describe, expect, it, vi } from "vitest";

import type { WireRequest, WireResponse } from "./platform";
import {
  ApiError,
  createRequestLayer,
  MAX_CONCURRENT,
  newIdempotencyKey,
  type Recoveries,
} from "./request";

// 请求层的用例（任务书 W0-27a 第 7 节第 3 条）。发请求、时钟、恢复动作都是替身：sleep 立即返回并记下时长。

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ok = (data: unknown): WireResponse => ({
  statusCode: 200,
  data: { code: 0, message: "ok", data },
  header: {},
});
const fail = (status: number, error: string, extra: object = {}): WireResponse => ({
  statusCode: status,
  data: {
    code: status * 100 + 1,
    error,
    message: error,
    retryable: false,
    requestId: "",
    ...extra,
  },
  header: {},
});

function setup(
  respond: (request: WireRequest, index: number) => WireResponse | Promise<WireResponse>,
  overrides: { token?: string | null; storeId?: string | null; recover?: Partial<Recoveries> } = {},
) {
  const sent: WireRequest[] = [];
  const sleeps: number[] = [];
  const state = { token: overrides.token ?? null, now: 1_000_000 };
  let counter = 0;
  const layer = createRequestLayer({
    baseUrl: "https://api.example.test/",
    send: async (request) => {
      sent.push(request);
      return respond(request, sent.length - 1);
    },
    clock: {
      now: () => state.now,
      sleep: async (ms) => {
        sleeps.push(ms);
        state.now += ms;
      },
    },
    uuid: () => {
      counter += 1;
      return `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`;
    },
    client: () => ({ platform: "ios", version: "1.2.3", envVersion: "trial" }),
    getToken: () => state.token,
    getStoreId: () => overrides.storeId ?? null,
    recover: overrides.recover,
  });
  return { layer, sent, sleeps, state };
}

const caught = async (promise: Promise<unknown>): Promise<ApiError> => {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(ApiError);
  return error as ApiError;
};

describe("组头与地址", () => {
  it("请求头齐全：平台、版本、环境、请求编号、门店、令牌、幂等键；地址补上 /api/v1", async () => {
    const { layer, sent } = setup(() => ok({ id: 1 }), { token: "lyxm_t", storeId: "store-1" });
    const key = newIdempotencyKey("orderSubmit", () => "11111111-1111-4111-8111-111111111111");
    await expect(
      layer.request("/m/orders", { method: "POST", data: { a: 1 }, idempotencyKey: key }),
    ).resolves.toEqual({ id: 1 });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe("https://api.example.test/api/v1/m/orders");
    expect(sent[0]?.header).toEqual({
      "content-type": "application/json",
      "X-Client-Platform": "ios",
      "X-Client-Version": "1.2.3",
      "X-Env-Version": "trial",
      "X-Request-Id": expect.stringMatching(UUID),
      "X-Store-Id": "store-1",
      Authorization: "Bearer lyxm_t",
      "Idempotency-Key": "orderSubmit:11111111-1111-4111-8111-111111111111",
    });
    expect(sent[0]?.timeout).toBe(30_000);
  });

  it("没有令牌、没有门店、不带幂等键时不出对应的头；普通请求超时 15 秒；auth 为 false 时有令牌也不带", async () => {
    const { layer, sent, state } = setup(() => ok(null));
    await layer.request("m/bootstrap");
    expect(Object.keys(sent[0]?.header ?? {})).toEqual([
      "content-type",
      "X-Client-Platform",
      "X-Client-Version",
      "X-Env-Version",
      "X-Request-Id",
    ]);
    expect(sent[0]?.timeout).toBe(15_000);
    state.token = "lyxm_t";
    await layer.request("/m/sessions", { method: "POST", auth: false });
    expect(sent[1]?.header.Authorization).toBeUndefined();
  });

  it("没配接口基址：不发请求，以 NOT_CONFIGURED 结束", async () => {
    const send = vi.fn();
    const layer = createRequestLayer({
      baseUrl: "",
      send,
      clock: { now: () => 0, sleep: async () => undefined },
      uuid: () => "00000000-0000-4000-8000-000000000001",
      client: () => ({ platform: "devtools", version: "0.1.0", envVersion: "develop" }),
      getToken: () => null,
      getStoreId: () => null,
    });
    expect(layer.isConfigured()).toBe(false);
    expect((await caught(layer.request("/m/me"))).error).toBe("NOT_CONFIGURED");
    expect(send).not.toHaveBeenCalled();
  });
});

describe("401：单飞静默登录后重放一次", () => {
  it("5 个并发请求同时得 AUTH_REQUIRED：只登一次，各重放一次，沿用原请求编号与幂等键，带上新令牌", async () => {
    const silentLogin = vi.fn(async () => {
      await Promise.resolve();
      env.state.token = "new";
      return "ok" as const;
    });
    const env = setup(
      (request) =>
        request.header.Authorization === "Bearer new"
          ? ok(request.url)
          : fail(401, "AUTH_REQUIRED"),
      { token: "old", recover: { silentLogin } },
    );
    const results = await Promise.all(
      [1, 2, 3, 4, 5].map((n) =>
        env.layer.request(`/m/things/${n}`, { method: "POST", idempotencyKey: `act:${n}` }),
      ),
    );
    expect(silentLogin).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(5);
    expect(env.sent).toHaveLength(10);
    for (const n of [1, 2, 3, 4, 5]) {
      const pair = env.sent.filter((request) => request.url.endsWith(`/m/things/${n}`));
      expect(pair.map((request) => request.header.Authorization)).toEqual([
        "Bearer old",
        "Bearer new",
      ]);
      expect(pair[1]?.header["X-Request-Id"]).toBe(pair[0]?.header["X-Request-Id"]);
      expect(pair.map((request) => request.header["Idempotency-Key"])).toEqual([
        `act:${n}`,
        `act:${n}`,
      ]);
    }
  });

  it("回包来得晚、别的请求已经登好了：直接用新令牌重放，不再登一次", async () => {
    const silentLogin = vi.fn(async () => "ok" as const);
    const env = setup(
      (request) =>
        request.header.Authorization === "Bearer new" ? ok(1) : fail(401, "SESSION_INVALID"),
      { token: "old", recover: { silentLogin } },
    );
    const slow = env.layer.request("/m/slow");
    env.state.token = "new";
    await expect(slow).resolves.toBe(1);
    expect(silentLogin).not.toHaveBeenCalled();
  });

  it("重放后仍是 401：不再循环；带着令牌被拒，清会话并回登录页", async () => {
    const recover = {
      silentLogin: vi.fn(async () => "ok" as const),
      clearSession: vi.fn(),
      gotoLogin: vi.fn(),
    };
    const env = setup(() => fail(401, "AUTH_REQUIRED"), { token: "old", recover });
    expect((await caught(env.layer.request("/m/me"))).error).toBe("AUTH_REQUIRED");
    expect(env.sent).toHaveLength(2);
    expect(recover.silentLogin).toHaveBeenCalledTimes(1);
    expect(recover.clearSession).toHaveBeenCalledTimes(1);
    expect(recover.gotoLogin).toHaveBeenCalledTimes(1);
  });

  it("没带令牌的 401 不清会话：登录没成时只把错误抛出去；要手机号登录时回登录页", async () => {
    const recover = {
      silentLogin: vi.fn(async (): Promise<"ok" | "needPhone" | "failed"> => "failed"),
      clearSession: vi.fn(),
      gotoLogin: vi.fn(),
    };
    const env = setup(() => ({ statusCode: 401, data: "", header: {} }), { recover });
    expect((await caught(env.layer.request("/m/me"))).error).toBe("AUTH_REQUIRED");
    expect(recover.clearSession).not.toHaveBeenCalled();
    expect(recover.gotoLogin).not.toHaveBeenCalled();

    recover.silentLogin.mockResolvedValue("needPhone");
    await caught(env.layer.request("/m/me"));
    expect(recover.clearSession).not.toHaveBeenCalled();
    expect(recover.gotoLogin).toHaveBeenCalledTimes(1);
  });

  it("带着令牌被拒而登录没成：清会话并回登录页；公开请求（auth 为 false）的 401 什么都不做", async () => {
    const recover = {
      silentLogin: vi.fn(async () => "failed" as const),
      clearSession: vi.fn(),
      gotoLogin: vi.fn(),
    };
    const env = setup(() => fail(401, "AUTH_REQUIRED"), { token: "old", recover });
    await caught(env.layer.request("/m/me"));
    expect(recover.clearSession).toHaveBeenCalledTimes(1);
    expect(recover.gotoLogin).toHaveBeenCalledTimes(1);

    await caught(env.layer.request("/m/public", { auth: false }));
    expect(recover.silentLogin).toHaveBeenCalledTimes(1);
    expect(recover.clearSession).toHaveBeenCalledTimes(1);
  });

  it("恢复动作没接上：按登录没成处理，不报别的错", async () => {
    const env = setup(() => fail(401, "AUTH_REQUIRED"), { token: "old" });
    expect((await caught(env.layer.request("/m/me"))).error).toBe("AUTH_REQUIRED");
    expect(env.sent).toHaveLength(1);
  });
});

describe("网络失败的重试", () => {
  const broken = () => {
    throw new Error("request:fail timeout");
  };

  it("带幂等键的写：至多重试 2 次（间隔 1 秒、3 秒），用同一个请求编号与幂等键", async () => {
    const env = setup(broken);
    const error = await caught(
      env.layer.request("/m/orders", { method: "POST", idempotencyKey: "orderSubmit:k" }),
    );
    expect(error.error).toBe("NETWORK_ERROR");
    expect(error.status).toBe(0);
    expect(env.sent).toHaveLength(3);
    expect(env.sleeps).toEqual([1000, 3000]);
    expect(new Set(env.sent.map((request) => request.header["X-Request-Id"])).size).toBe(1);
    expect(new Set(env.sent.map((request) => request.header["Idempotency-Key"]))).toEqual(
      new Set(["orderSubmit:k"]),
    );
  });

  it("不带幂等键的写不重试；GET 重试 1 次（间隔 800 毫秒）", async () => {
    const write = setup(broken);
    await caught(write.layer.request("/m/things", { method: "POST" }));
    expect(write.sent).toHaveLength(1);
    expect(write.sleeps).toEqual([]);

    const read = setup(broken);
    await caught(read.layer.request("/m/things"));
    expect(read.sent).toHaveLength(2);
    expect(read.sleeps).toEqual([800]);
  });

  it("重试中途通了就返回", async () => {
    const env = setup((_request, index) => (index === 0 ? broken() : ok("fine")));
    await expect(env.layer.request("/m/things")).resolves.toBe("fine");
  });
});

describe("按符号名处置", () => {
  it("BUSY：600 毫秒后重试 1 次，再忙就抛出", async () => {
    const env = setup((_request, index) => (index === 0 ? fail(503, "BUSY") : ok(1)));
    await expect(env.layer.request("/m/things")).resolves.toBe(1);
    expect(env.sleeps).toEqual([600]);

    const always = setup(() => fail(503, "BUSY"));
    expect((await caught(always.layer.request("/m/things"))).error).toBe("BUSY");
    expect(always.sent).toHaveLength(2);
  });

  it("IDEMPOTENCY_IN_PROGRESS：每秒重试，至多 5 次", async () => {
    const env = setup(() => fail(409, "IDEMPOTENCY_IN_PROGRESS"));
    const error = await caught(
      env.layer.request("/m/payments", { method: "POST", idempotencyKey: "pay:k" }),
    );
    expect(error.error).toBe("IDEMPOTENCY_IN_PROGRESS");
    expect(env.sent).toHaveLength(6);
    expect(env.sleeps).toEqual([1000, 1000, 1000, 1000, 1000]);
  });

  it("CONSENT_REQUIRED：并发的请求只弹一次，同意后各重放一次；拒绝后 30 秒内不再弹", async () => {
    let agreed = false;
    const askConsent = vi.fn(async (_details: unknown) => {
      await Promise.resolve();
      agreed = true;
      return true;
    });
    const env = setup(
      () => (agreed ? ok(1) : fail(428, "CONSENT_REQUIRED", { details: { pendingConsents: [1] } })),
      { recover: { askConsent } },
    );
    await Promise.all([1, 2, 3].map(() => env.layer.request("/m/home")));
    expect(askConsent).toHaveBeenCalledTimes(1);
    expect(askConsent).toHaveBeenCalledWith({ pendingConsents: [1] });
    expect(env.sent).toHaveLength(6);

    const refuse = vi.fn(async () => false);
    const refused = setup(() => fail(428, "CONSENT_REQUIRED"), { recover: { askConsent: refuse } });
    expect((await caught(refused.layer.request("/m/home"))).error).toBe("CONSENT_REQUIRED");
    await caught(refused.layer.request("/m/home"));
    expect(refuse).toHaveBeenCalledTimes(1);
    refused.state.now += 30_000;
    await caught(refused.layer.request("/m/home"));
    expect(refuse).toHaveBeenCalledTimes(2);
  });

  it("NOT_A_MEMBER、FEATURE_DISABLED、CLIENT_OUTDATED：各做一次恢复，不重放；恢复出错不盖住原错误", async () => {
    const recover = {
      reloadMe: vi.fn(async () => undefined),
      reloadBootstrap: vi.fn(async () => {
        throw new Error("boom");
      }),
      showUpdatePrompt: vi.fn(async () => undefined),
    };
    for (const [symbol, hook] of [
      ["NOT_A_MEMBER", recover.reloadMe],
      ["FEATURE_DISABLED", recover.reloadBootstrap],
      ["CLIENT_OUTDATED", recover.showUpdatePrompt],
    ] as const) {
      const env = setup(() => fail(403, symbol), { recover });
      expect((await caught(env.layer.request("/m/things"))).error).toBe(symbol);
      expect(env.sent).toHaveLength(1);
      expect(hook).toHaveBeenCalledTimes(1);
    }
  });

  it("双通道：有错误体按 error；没有错误体按 HTTP 状态", async () => {
    const withBody = setup(() =>
      fail(409, "QUOTE_CHANGED", {
        code: 43010,
        message: "报价已变",
        retryable: false,
        requestId: "rid-from-body",
        details: { total: 5 },
        fieldErrors: [{ path: "a", message: "b" }],
      }),
    );
    const error = await caught(withBody.layer.request("/m/quote"));
    expect(error).toMatchObject({
      error: "QUOTE_CHANGED",
      code: 43010,
      status: 409,
      message: "报价已变",
      requestId: "rid-from-body",
      details: { total: 5 },
      fieldErrors: [{ path: "a", message: "b" }],
    });

    const gateway = setup(() => ({ statusCode: 502, data: "<html>", header: {} }));
    const bare = await caught(gateway.layer.request("/m/quote", { method: "POST" }));
    expect(bare.error).toBe("HTTP_502");
    expect(bare.requestId).toMatch(UUID);
  });
});

describe("并发闸", () => {
  it(`同时在途的业务请求不超过 ${MAX_CONCURRENT} 个，排队的按先后放行，全部完成`, async () => {
    let running = 0;
    let peak = 0;
    const releases: (() => void)[] = [];
    const env = setup(async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise<void>((resolve) => releases.push(resolve));
      running -= 1;
      return ok(1);
    });
    const all = Array.from({ length: 20 }, (_, n) => env.layer.request(`/m/things/${n}`));
    await vi.waitFor(() => expect(releases).toHaveLength(MAX_CONCURRENT));
    expect(env.layer.inFlight()).toBe(MAX_CONCURRENT);
    while (releases.length > 0) {
      releases.shift()?.();
      await Promise.resolve();
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    await Promise.all(all);
    expect(peak).toBe(MAX_CONCURRENT);
    expect(env.sent.map((request) => request.url.split("/").pop())).toEqual(
      Array.from({ length: 20 }, (_, n) => String(n)),
    );
    expect(env.layer.inFlight()).toBe(0);
  });
});
