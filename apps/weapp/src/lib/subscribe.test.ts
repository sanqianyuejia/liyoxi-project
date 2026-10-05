import type { SubscribePoint } from "@liyoxi/contract/notify";
import { describe, expect, it, vi } from "vitest";

import type { KeyValueStorage } from "./platform";
import { StorageKey } from "./storage";
import { createSubscribe, type SubscribeDeps } from "./subscribe";
import type { SubscribePlanItem } from "../stores/bootstrap";

// 订阅封装的用例（任务书 W0-27a 第 7 节第 4 条）。

const DAY = 24 * 60 * 60 * 1000;
const PLAN: SubscribePlanItem[] = [
  {
    point: "order_submit",
    slots: [
      { slotKey: "order_progress", tmplId: "T1" },
      { slotKey: "plan_ready", tmplId: "T2" },
      { slotKey: "sample_ready", tmplId: "T3" },
      { slotKey: "package_ready", tmplId: "T4" },
    ],
  },
  { point: "ticket_submit", slots: [] },
];

function memoryStorage(initial: Record<string, unknown> = {}): KeyValueStorage & {
  data: Record<string, unknown>;
} {
  const data = { ...initial };
  return {
    data,
    get: <T>(key: string) => (key in data ? (data[key] as T) : null),
    set: (key, value) => void (data[key] = value),
    remove: (key) => void delete data[key],
  };
}

function setup(
  overrides: Partial<SubscribeDeps> & { enabled?: boolean; plan?: SubscribePlanItem[] | null } = {},
) {
  const state = { now: 1_700_000_000_000, enabled: overrides.enabled ?? true };
  const storage = overrides.storage ?? memoryStorage();
  const requestSubscribe = vi.fn(
    overrides.requestSubscribe ??
      (async (ids: string[]) => Object.fromEntries(ids.map((id) => [id, "accept"]))),
  );
  const report = vi.fn(async (_body: unknown, _key: string) => ({
    appliedCount: 1,
    ignoredCount: 0,
  }));
  const afterReport = vi.fn();
  const { withSubscribe } = createSubscribe({
    requestSubscribe,
    getPlan: () => ({
      enabled: state.enabled,
      plan: overrides.plan === undefined ? PLAN : overrides.plan,
      maxPerAsk: 3,
      cooldownDays: 7,
    }),
    storage,
    clock: { now: () => state.now, sleep: async () => undefined },
    uuid: () => "22222222-2222-4222-8222-222222222222",
    report: overrides.report ?? (() => report),
    afterReport,
    onHandlerError: overrides.onHandlerError,
  });
  return { withSubscribe, requestSubscribe, report, afterReport, storage, state };
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("直接执行处理函数、不调订阅接口", () => {
  const cases: [
    string,
    SubscribePoint,
    { plan?: SubscribePlanItem[] | null; enabled?: boolean },
  ][] = [
    ["引导数据里没有点位清单（匿名或接口没接上）", "order_submit", { plan: null }],
    ["点位清单为空数组", "order_submit", { plan: [] }],
    ["这个点位没有槽位", "ticket_submit", {}],
    ["开关 notify.wx.enabled 关着", "order_submit", { enabled: false }],
  ];
  it.each(cases)("%s", async (_name, point, overrides) => {
    const env = setup(overrides);
    const handler = vi.fn(async () => undefined);
    env.withSubscribe(point, handler)();
    await settled();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(env.requestSubscribe).not.toHaveBeenCalled();
    expect(env.report).not.toHaveBeenCalled();
  });
});

describe("清单非空", () => {
  it("订阅调用是点击处理的第一句：点击函数返回时已经同步调出去了，处理函数还没开始；模板取前 3 个", async () => {
    const env = setup();
    const handler = vi.fn(async () => undefined);
    const onClick = env.withSubscribe("order_submit", handler);
    expect(env.requestSubscribe).not.toHaveBeenCalled();
    onClick();
    // 没有经过任何微任务：这一刻订阅接口已经被调用
    expect(env.requestSubscribe).toHaveBeenCalledTimes(1);
    expect(env.requestSubscribe).toHaveBeenCalledWith(["T1", "T2", "T3"]);
    expect(handler).not.toHaveBeenCalled();
    await settled();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("接受：继续执行处理函数；结果带 reportId 上报，幂等键是 subscribeReport:<reportId>，成功后刷新清单", async () => {
    const env = setup();
    const handler = vi.fn();
    env.withSubscribe("order_submit", handler)();
    await settled();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(env.report).toHaveBeenCalledWith(
      {
        reportId: "22222222-2222-4222-8222-222222222222",
        point: "order_submit",
        results: [
          { tmplId: "T1", result: "accept" },
          { tmplId: "T2", result: "accept" },
          { tmplId: "T3", result: "accept" },
        ],
      },
      "subscribeReport:22222222-2222-4222-8222-222222222222",
    );
    expect(env.afterReport).toHaveBeenCalledTimes(1);
  });

  it("拒绝：继续执行处理函数；如实上报；被拒的槽位进冷却，7 天内不再请求，过后恢复", async () => {
    const env = setup({
      requestSubscribe: async () => ({ errMsg: "ok", T1: "reject", T2: "accept", T3: "ban" }),
    });
    const handler = vi.fn();
    env.withSubscribe("order_submit", handler)();
    await settled();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(env.report.mock.calls[0]?.[0]).toMatchObject({
      results: [
        { tmplId: "T1", result: "reject" },
        { tmplId: "T2", result: "accept" },
        { tmplId: "T3", result: "ban" },
      ],
    });
    expect(env.storage.get(StorageKey.subscribeCooldown)).toEqual({
      order_progress: env.state.now,
    });

    env.withSubscribe("order_submit", handler)();
    expect(env.requestSubscribe).toHaveBeenLastCalledWith(["T2", "T3", "T4"]);
    env.state.now += 7 * DAY;
    env.withSubscribe("order_submit", handler)();
    expect(env.requestSubscribe).toHaveBeenLastCalledWith(["T1", "T2", "T3"]);
  });

  it("接口失败（拒绝的 Promise、同步抛错）：都继续执行处理函数，不上报", async () => {
    const rejected = setup({
      requestSubscribe: async () => {
        throw new Error("requestSubscribeMessage:fail");
      },
    });
    const thrown = setup({
      requestSubscribe: () => {
        throw new Error("not supported");
      },
    });
    for (const env of [rejected, thrown]) {
      const handler = vi.fn();
      env.withSubscribe("order_submit", handler)();
      await settled();
      expect(handler).toHaveBeenCalledTimes(1);
      expect(env.report).not.toHaveBeenCalled();
    }
  });

  it("上报函数没接上：照常授权、照常执行处理函数，不报；上报失败也不影响", async () => {
    const unwired = setup({ report: () => undefined });
    const failing = setup({
      report: () => async () => {
        throw new Error("offline");
      },
    });
    for (const env of [unwired, failing]) {
      const handler = vi.fn();
      env.withSubscribe("order_submit", handler)();
      await settled();
      expect(env.requestSubscribe).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledTimes(1);
      expect(env.afterReport).not.toHaveBeenCalled();
    }
  });

  it("冷启动后冷却还在：从本地读回；处理函数抛的错交给 onHandlerError", async () => {
    const storage = memoryStorage({
      [StorageKey.subscribeCooldown]: { order_progress: 1_700_000_000_000 - DAY },
    });
    const onHandlerError = vi.fn();
    const env = setup({ storage, onHandlerError });
    env.withSubscribe("order_submit", () => {
      throw new Error("handler boom");
    })();
    expect(env.requestSubscribe).toHaveBeenCalledWith(["T2", "T3", "T4"]);
    await settled();
    expect(onHandlerError).toHaveBeenCalledTimes(1);
  });
});
