// 引导数据 store（D7 第 3.2 节；m08 第 2.2 节 Bootstrap）。
// 取数的先后：接口 → 上次的缓存（lyx.bootstrap）→ 代码里的默认值。默认值每一项都取“保守”的一侧：
// 开关全按关算，订阅点位清单为空，所以接口没接上时订阅封装直接执行处理函数、埋点封装不发请求。
// 刷新时机：冷启动，以及回到前台距上次取数超过 5 分钟。
import type { ClientFlagKey } from "@liyoxi/contract/config/flags";
import type { SubscribePoint } from "@liyoxi/contract/notify";
import { create } from "zustand";

/** 引导接口的响应里本包用得到的部分。结构照 m08 第 2.2 节；契约里有了生成类型后换成它（W1-04） */
export interface BootstrapData {
  /** 服务器时刻，ISO 8601 */
  serverTime: string | null;
  minClientVersion: string;
  flags: Partial<Record<ClientFlagKey, unknown>>;
  /** 各订阅点位此刻可请求的槽位；点位名放在值里（约定 C57）。匿名为 null */
  subscribePlan: SubscribePlanItem[] | null;
  /** 用户拒绝某槽位后，多少天内不再请求（端上本地记录） */
  subscribeCooldownDays: number;
  /** 一次授权请求的模板数上限 */
  subscribeMaxPerAsk: number;
  uploadLimits: { weappVideoMaxMb: number; imageMaxMb: number };
  download: { weappSaveMode: "temp" | "user_dir" };
  /** 文案键 → 覆盖文案 */
  copy: Record<string, string>;
  /** 服务端记住的当前门店；匿名为 null */
  context: { storeId: string | null } | null;
}

export interface SubscribePlanItem {
  point: SubscribePoint;
  slots: { slotKey: string; tmplId: string }[];
}

/** 开关在代码里的保守默认：没有引导数据时按这个算，不取登记表里的默认值 */
const CONSERVATIVE_FLAGS: Partial<Record<ClientFlagKey, unknown>> = {
  "notify.wx.enabled": false,
  "analytics.ingest.enabled": false,
  "weapp.video.trailer.enabled": false,
  "weapp.video.sample.enabled": false,
  "weapp.video.ad.enabled": false,
  "weapp.trailer.autoplay": false,
  "weapp.trailer.feed": false,
  "release.partner": false,
  "release.notice_faq": false,
  "release.trial_episodes": false,
  "release.delegate_publish": false,
  "export.enabled": false,
};

export const DEFAULT_BOOTSTRAP: BootstrapData = {
  serverTime: null,
  minClientVersion: "0.0.0",
  flags: CONSERVATIVE_FLAGS,
  subscribePlan: null,
  subscribeCooldownDays: 7,
  subscribeMaxPerAsk: 3,
  uploadLimits: { weappVideoMaxMb: 100, imageMaxMb: 5 },
  download: { weappSaveMode: "temp" },
  copy: {},
  context: null,
};

/** 回到前台距上次取数超过这么久就刷新 */
export const BOOTSTRAP_MAX_AGE_MS = 5 * 60 * 1000;

export interface BootstrapState {
  data: BootstrapData;
  /** 数据从哪来：default 代码里的默认值；cache 上次的缓存；server 本次启动后从接口取到的 */
  source: "default" | "cache" | "server";
  /** 取到这份数据的时刻（毫秒时间戳）；默认值为 null */
  fetchedAt: number | null;
  /** 接口取到了：缺的字段用默认值补齐 */
  apply(data: Partial<BootstrapData>, fetchedAt: number): void;
  /** 冷启动时放回上次的缓存 */
  restore(data: Partial<BootstrapData>, fetchedAt: number): void;
  /** 只换订阅点位清单（上报授权结果之后） */
  setSubscribePlan(plan: SubscribePlanItem[] | null): void;
}

const merged = (data: Partial<BootstrapData>): BootstrapData => ({
  ...DEFAULT_BOOTSTRAP,
  ...data,
  flags: { ...CONSERVATIVE_FLAGS, ...data.flags },
});

export const useBootstrapStore = create<BootstrapState>()((set, get) => ({
  data: DEFAULT_BOOTSTRAP,
  source: "default",
  fetchedAt: null,
  apply: (data, fetchedAt) => set({ data: merged(data), source: "server", fetchedAt }),
  restore: (data, fetchedAt) => set({ data: merged(data), source: "cache", fetchedAt }),
  setSubscribePlan: (subscribePlan) => set({ data: { ...get().data, subscribePlan } }),
}));

/** 布尔开关此刻的值；没下发的按保守默认（关） */
export function flagOn(key: ClientFlagKey): boolean {
  return useBootstrapStore.getState().data.flags[key] === true;
}

/** 该不该刷新：还没从接口取到过，或距上次取数超过 5 分钟 */
export function bootstrapStale(now: number): boolean {
  const { source, fetchedAt } = useBootstrapStore.getState();
  return source !== "server" || fetchedAt === null || now - fetchedAt > BOOTSTRAP_MAX_AGE_MS;
}
