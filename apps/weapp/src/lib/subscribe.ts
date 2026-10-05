// 订阅消息授权封装（D7 第 4.8 节；m08 第 2.2 节 subscribePlan、第 3.20 节）。借参考工程 subscribe.ts 的写法。
// 端上只做一件事：在用户本来就要点的按钮上顺带请求授权，并如实上报结果。五条规则：
//   1. 点位此刻没有可请求的模板（清单为空、都在冷却里），或 notify.wx.enabled 关着：直接执行处理函数，不调订阅接口。
//   2. 点击处理函数的第一句同步发起授权，之前不能隔 await，否则弹不出来。所以模板 id 只取已在内存里的引导数据。
//   3. 用户接受、拒绝，接口成功、失败，都接着执行处理函数。
//   4. 逐模板的结果连同端上生成的 reportId 上报；上报成功后刷新点位清单。上报函数没接上时不报。
//   5. 页面只引契约里的点位常量（@liyoxi/contract/notify）。
// 用户拒绝过的槽位在本地记冷却，冷却期内同一槽位不再请求（m08：subscribeCooldownDays，冷却在端上）。
import type { SubscribePoint } from "@liyoxi/contract/notify";

import type { Clock, KeyValueStorage, SubscribeAnswer } from "./platform";
import { StorageKey } from "./storage";
import type { SubscribePlanItem } from "../stores/bootstrap";

const DAY_MS = 24 * 60 * 60 * 1000;
/** 微信一次最多请求的模板数 */
const PLATFORM_MAX_PER_ASK = 5;
const ANSWERS: readonly string[] = ["accept", "reject", "ban", "filter"];

/** m.subscribeResult.create 的请求体 */
export interface SubscribeResultBody {
  reportId: string;
  point: SubscribePoint;
  results: { tmplId: string; result: SubscribeAnswer }[];
}

export interface SubscribeDeps {
  /** 同步发起 wx.requestSubscribeMessage：调用的那一刻就要调出去，不能先 await 别的 */
  requestSubscribe(tmplIds: string[]): Promise<Record<string, unknown>>;
  /** 读内存里的引导数据。enabled 是开关 notify.wx.enabled */
  getPlan(): {
    enabled: boolean;
    plan: SubscribePlanItem[] | null;
    maxPerAsk: number;
    cooldownDays: number;
  };
  storage: KeyValueStorage;
  clock: Clock;
  uuid: () => string;
  /** 上报结果（幂等键 subscribeReport:<reportId>）；没接上时返回 undefined，不报 */
  report?: () =>
    ((body: SubscribeResultBody, idempotencyKey: string) => Promise<unknown>) | undefined;
  /** 上报成功后调：刷新引导数据里的点位清单 */
  afterReport?: () => void;
  /** 处理函数抛的错交给它（接到错误上报）；没给时不吞，照常成为未处理的拒绝 */
  onHandlerError?: (error: unknown) => void;
}

export function createSubscribe(deps: SubscribeDeps) {
  // 冷却表在内存里留一份：点击的那一下只读内存，不读存储
  let cooldown: Record<string, number> =
    deps.storage.get<Record<string, number>>(StorageKey.subscribeCooldown) ?? {};

  /** 这个点位此刻要请求的槽位：滤掉冷却中的，再取前几个 */
  function slotsToAsk(point: SubscribePoint): { slotKey: string; tmplId: string }[] {
    const { enabled, plan, maxPerAsk, cooldownDays } = deps.getPlan();
    if (!enabled || !plan) return [];
    const now = deps.clock.now();
    const fresh = (plan.find((item) => item.point === point)?.slots ?? []).filter((slot) => {
      const refusedAt = cooldown[slot.slotKey];
      return refusedAt === undefined || now - refusedAt >= cooldownDays * DAY_MS;
    });
    return fresh.slice(0, Math.max(0, Math.min(maxPerAsk, PLATFORM_MAX_PER_ASK)));
  }

  function run(handler: () => Promise<void> | void): void {
    const done = Promise.resolve().then(handler);
    if (deps.onHandlerError) done.catch(deps.onHandlerError);
  }

  function settle(
    point: SubscribePoint,
    slots: { slotKey: string; tmplId: string }[],
    answer: Record<string, unknown>,
  ): void {
    const results = slots.flatMap((slot) => {
      const result = answer[slot.tmplId];
      return typeof result === "string" && ANSWERS.includes(result)
        ? [{ slotKey: slot.slotKey, tmplId: slot.tmplId, result: result as SubscribeAnswer }]
        : [];
    });
    const refused = results.filter((item) => item.result === "reject");
    if (refused.length > 0) {
      const now = deps.clock.now();
      cooldown = { ...cooldown, ...Object.fromEntries(refused.map((item) => [item.slotKey, now])) };
      deps.storage.set(StorageKey.subscribeCooldown, cooldown);
    }
    const report = deps.report?.();
    if (!report || results.length === 0) return;
    const reportId = deps.uuid();
    report(
      { reportId, point, results: results.map(({ tmplId, result }) => ({ tmplId, result })) },
      `subscribeReport:${reportId}`,
    ).then(
      () => deps.afterReport?.(),
      () => undefined, // 上报失败不影响这次操作，也不重试：下一次授权时再报
    );
  }

  /**
   * 包一层点击处理函数：返回值直接挂到按钮的点击事件上。
   * 支付成功这个点位在 wx.requestPayment 的成功回调里调返回的函数（平台允许支付回调触发）。
   */
  function withSubscribe(point: SubscribePoint, handler: () => Promise<void> | void): () => void {
    return () => {
      const slots = slotsToAsk(point);
      if (slots.length === 0) {
        run(handler);
        return;
      }
      let asking: Promise<Record<string, unknown>>;
      try {
        // 这一句必须留在点击的同步调用链里：上面只读了内存，没有 await
        asking = deps.requestSubscribe(slots.map((slot) => slot.tmplId));
      } catch {
        run(handler);
        return;
      }
      asking.then(
        (answer) => {
          settle(point, slots, answer ?? {});
          run(handler);
        },
        () => run(handler),
      );
    };
  }

  return { withSubscribe };
}
