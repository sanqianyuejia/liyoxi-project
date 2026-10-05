import { describe, expect, it, vi } from "vitest";

import type { KeyValueStorage } from "./platform";
import { StorageKey } from "./storage";
import {
  createTracker,
  TRACK_BATCH_MAX,
  TRACK_FLUSH_INTERVAL_MS,
  TRACK_QUEUE_MAX,
  type AnalyticsEventBatch,
  type SendOutcome,
} from "./track";

// 埋点封装的用例（任务书 W0-27a 第 7 节第 6 条）。

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
  options: {
    outcome?: SendOutcome | (() => SendOutcome | Promise<SendOutcome>);
    enabled?: boolean;
    wired?: boolean;
    storage?: ReturnType<typeof memoryStorage>;
  } = {},
) {
  const state = {
    now: Date.parse("2026-10-05T12:00:00.000Z"),
    enabled: options.enabled ?? true,
    wired: options.wired ?? true,
    outcome: options.outcome ?? ("ok" as SendOutcome | (() => SendOutcome | Promise<SendOutcome>)),
  };
  const storage = options.storage ?? memoryStorage();
  const batches: AnalyticsEventBatch[] = [];
  const timers: { run: () => void; delayMs: number; cancelled: boolean }[] = [];
  let counter = 0;
  const send = vi.fn(async (batch: AnalyticsEventBatch) => {
    batches.push(batch);
    return typeof state.outcome === "function" ? state.outcome() : state.outcome;
  });
  const tracker = createTracker({
    storage,
    clock: { now: () => state.now, sleep: async () => undefined },
    uuid: () => {
      counter += 1;
      return `33333333-3333-4333-8333-${String(counter).padStart(12, "0")}`;
    },
    enabled: () => state.enabled,
    sender: () => (state.wired ? send : undefined),
    client: () => ({ version: "1.2.3", platform: "android", scene: 1001 }),
    getStoreId: () => "store-9",
    schedule: (run, delayMs) => {
      const timer = { run, delayMs, cancelled: false };
      timers.push(timer);
      return () => void (timer.cancelled = true);
    },
  });
  const fire = () =>
    timers
      .filter((timer) => !timer.cancelled)
      .at(-1)
      ?.run();
  const many = (count: number) => {
    for (let index = 0; index < count; index += 1) {
      tracker.track("store_switch", { fromPage: "home" });
    }
  };
  return { tracker, send, batches, timers, storage, state, fire, many };
}

describe("什么时候上报", () => {
  it("满 10 条立即上报；批次头与事件的字段齐全", async () => {
    const env = setup();
    env.many(9);
    expect(env.send).not.toHaveBeenCalled();
    env.tracker.track("drama_detail_view", {
      dramaId: "44444444-4444-4444-8444-444444444444",
      fromPage: "mall",
    });
    await env.tracker.flush();
    expect(env.send).toHaveBeenCalledTimes(1);
    const batch = env.batches[0];
    expect(batch).toMatchObject({
      sentAt: "2026-10-05T12:00:00.000Z",
      sessionId: "33333333-3333-4333-8333-000000000001",
      clientVersion: "1.2.3",
      platform: "android",
      scene: 1001,
    });
    expect(batch?.anonymousId).toBe(env.storage.get(StorageKey.anonymousId));
    expect(batch?.events).toHaveLength(10);
    expect(batch?.events[9]).toEqual({
      eventId: expect.stringMatching(/^33333333-/),
      name: "drama_detail_view",
      occurredAt: "2026-10-05T12:00:00.000Z",
      storeId: "store-9",
      props: { dramaId: "44444444-4444-4444-8444-444444444444", fromPage: "mall" },
    });
    expect(env.tracker.pending()).toBe(0);
  });

  it("不满 10 条：第一条入队起 5 秒后上报，只挂一个定时器", async () => {
    const env = setup();
    env.many(3);
    expect(env.timers).toHaveLength(1);
    expect(env.timers[0]?.delayMs).toBe(TRACK_FLUSH_INTERVAL_MS);
    expect(env.send).not.toHaveBeenCalled();
    env.fire();
    await env.tracker.flush();
    expect(env.batches[0]?.events).toHaveLength(3);
  });

  it("每批至多 50 条：一次攒了 120 条，分 50、50、20 三批", async () => {
    const env = setup({ enabled: false });
    env.many(120);
    env.state.enabled = true;
    await env.tracker.flush();
    expect(env.batches.map((batch) => batch.events.length)).toEqual([TRACK_BATCH_MAX, 50, 20]);
  });
});

describe("失败与不发", () => {
  it("网络失败或 5xx：放回队列并落本地；下次启动先补报，顺序不变", async () => {
    const env = setup({ outcome: "retry" });
    env.many(10);
    await env.tracker.flush();
    expect(env.tracker.pending()).toBe(10);
    const saved = env.storage.get<{ eventId: string }[]>(StorageKey.trackQueue);
    expect(saved).toHaveLength(10);

    const next = setup({ storage: env.storage });
    expect(next.tracker.pending()).toBe(10);
    next.tracker.track("share_click", { page: "detail" });
    await next.tracker.flush();
    expect(next.batches[0]?.events.map((event) => event.eventId).slice(0, 10)).toEqual(
      saved?.map((event) => event.eventId),
    );
    expect(next.batches[0]?.events).toHaveLength(11);
    expect(next.storage.get(StorageKey.trackQueue)).toBeNull();
  });

  it("上报函数抛错按失败算；本地至多留 200 条，超出丢最旧的", async () => {
    const env = setup({
      storage: memoryStorage({ [StorageKey.anonymousId]: "55555555-5555-4555-8555-555555555555" }),
      outcome: () => {
        throw new Error("offline");
      },
    });
    env.many(TRACK_QUEUE_MAX + 30);
    await env.tracker.flush();
    // 没报成之后 5 秒内不再试：断网时不会每记一条就发一次
    expect(env.send).toHaveBeenCalledTimes(1);
    env.state.now += TRACK_FLUSH_INTERVAL_MS;
    await env.tracker.flush();
    expect(env.send).toHaveBeenCalledTimes(2);
    expect(env.tracker.pending()).toBe(TRACK_QUEUE_MAX);
    const saved = env.storage.get<{ eventId: string }[]>(StorageKey.trackQueue);
    expect(saved).toHaveLength(TRACK_QUEUE_MAX);
    // 编号 1 是会话号，事件从 2 起共 230 条：最旧的 30 条（2–31）已经不在，留下的从 32 起
    expect(saved?.[0]?.eventId).toBe("33333333-3333-4333-8333-000000000032");
    expect(saved?.at(-1)?.eventId).toBe("33333333-3333-4333-8333-000000000231");
  });

  it("服务端明确不要这一批（限流、开关已关、入参不合）：丢弃，不落本地", async () => {
    const env = setup({ outcome: "drop" });
    env.many(10);
    await env.tracker.flush();
    expect(env.tracker.pending()).toBe(0);
    expect(env.storage.get(StorageKey.trackQueue)).toBeNull();
  });

  it("开关 analytics.ingest.enabled 关着，或上报函数没接上：不发请求", async () => {
    const off = setup({ enabled: false });
    off.many(25);
    off.fire();
    await off.tracker.flush();
    expect(off.send).not.toHaveBeenCalled();

    const unwired = setup({ wired: false });
    unwired.many(25);
    await unwired.tracker.flush();
    expect(unwired.send).not.toHaveBeenCalled();
    expect(unwired.tracker.pending()).toBe(25);
  });
});

describe("事件名与属性取自契约登记", () => {
  it("写错事件名、冒充服务端事件、属性不合，类型检查都过不去", () => {
    const { tracker } = setup({ wired: false });
    tracker.track("app_launch", { hasInvitation: false });
    tracker.track("mall_view", { mode: "list", sort: "newest" });
    // 下面三行各有一处错：去掉 @ts-expect-error 后 pnpm typecheck 必须失败；
    // 契约的类型放松到能通过时，这里的 @ts-expect-error 会变成“没有用到”，typecheck 同样失败
    // @ts-expect-error 没登记的事件名
    tracker.track("mall_veiw", { mode: "list" });
    // @ts-expect-error plan_purchase 是服务端从出站事件派生的，端上不能报
    tracker.track("plan_purchase", {});
    // @ts-expect-error fromPage 要是字符串
    tracker.track("store_switch", { fromPage: 1 });
    expect(tracker.pending()).toBe(5);
  });
});
