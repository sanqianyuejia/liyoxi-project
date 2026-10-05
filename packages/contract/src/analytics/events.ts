// @liyoxi/contract/analytics/events：埋点事件的登记，纯常量子路径（14 分组 第 2.9 节 analytics_event.name；
// D6 第 5.1.1 节；m08 第 2.11 节、第 4 节 ClientEventName；D7 第 4.12 节）。
// PRD 的 26 个事件按来源分三类：端上上报 7 个、由出站事件派生 11 个、用例事务里直记 8 个；另有 3 个扩展事件，都是端上报。
// 端上只许报来源是 client 的事件，服务端拒收端上冒充的服务端事件。
// 事件名、来源与文档对账（pnpm api-registries:check）。端上事件的属性这里只给类型；接收时逐事件的校验结构
//（多带字段即拒收）随埋点接收接口所在的包登记，并与这里的类型保持同形。
// 纯常量：本文件只引类型，不引任何包。
import type { ANALYTICS_EVENT_SOURCE } from "../enums/analytics.js";
import type { EnumValue } from "../enums/define.js";
import type { NameFormat } from "../registry/formats.js";

/** 来源：client 端上上报、outbox 由出站事件派生、direct 用例事务里直记（analytics_event.source） */
export type AnalyticsEventSource = EnumValue<typeof ANALYTICS_EVENT_SOURCE>;

export interface AnalyticsEventDef<
  N extends string = string,
  S extends AnalyticsEventSource = AnalyticsEventSource,
> {
  /** 事件名（analytics_event.name） */
  readonly name: N;
  readonly source: S;
  /** 扩展事件：不在 PRD 的 26 个之内 */
  readonly extension: boolean;
}

/** 事件名的写法（ck_analytics_event_name） */
export const ANALYTICS_EVENT_NAME_FORMAT = {
  column: "analytics_event.name",
  pattern: "^[a-z][a-z0-9_]{1,39}$",
} as const satisfies NameFormat;

function event<const N extends string, const S extends AnalyticsEventSource>(
  name: N,
  source: S,
  extension?: "extension",
): AnalyticsEventDef<N, S> {
  return { name, source, extension: extension === "extension" };
}

export const ANALYTICS_EVENTS = [
  // PRD 的 26 个，顺序照 D6 第 5.1.1 节
  event("app_launch", "client"),
  event("login_success", "direct"),
  event("profile_step_save", "client"),
  event("profile_submit", "outbox"),
  event("store_add_submit", "direct"),
  event("store_switch", "client"),
  event("member_invite_send", "direct"),
  event("member_join", "direct"),
  event("asset_upload", "direct"),
  event("asset_adopted", "direct"),
  event("plan_purchase", "outbox"),
  event("points_topup", "outbox"),
  event("ad_request_submit", "outbox"),
  event("ad_confirm", "outbox"),
  event("mall_view", "client"),
  event("trailer_play", "client"),
  event("drama_detail_view", "client"),
  event("cart_add", "direct"),
  event("order_submit", "outbox"),
  event("plan_confirm", "outbox"),
  event("sample_confirm", "outbox"),
  event("package_download", "direct"),
  event("publish_link_submit", "outbox"),
  event("points_expire", "outbox"),
  event("ticket_submit", "outbox"),
  event("share_click", "client"),
  // 扩展事件
  event("banner_click", "client", "extension"),
  event("playback_fallback", "client", "extension"),
  event("trailer_first_frame", "client", "extension"),
] as const;

type AnyEvent = (typeof ANALYTICS_EVENTS)[number];

/** 已登记的事件名 */
export type AnalyticsEventName = AnyEvent["name"];
/** 端上上报的事件名（埋点接收接口 name 的取值） */
export type ClientEventName = Extract<AnyEvent, { source: "client" }>["name"];

export const ANALYTICS_EVENT_NAMES: readonly AnalyticsEventName[] = ANALYTICS_EVENTS.map(
  (item) => item.name,
);
export const CLIENT_EVENT_NAMES = ANALYTICS_EVENTS.filter((item) => item.source === "client").map(
  (item) => item.name,
) as readonly ClientEventName[];

export function isAnalyticsEventName(value: unknown): value is AnalyticsEventName {
  return typeof value === "string" && (ANALYTICS_EVENT_NAMES as readonly string[]).includes(value);
}

export function isClientEventName(value: unknown): value is ClientEventName {
  return typeof value === "string" && (CLIENT_EVENT_NAMES as readonly string[]).includes(value);
}

/**
 * 属性里的短编码：字典编码、枚举值、页面键，写法见 ANALYTICS_CODE_PATTERN。
 * 属性里不放手机号、证照号、邀请令牌，字符串属性只能是枚举、uuid 或这种短编码。
 */
export type AnalyticsCode = string;
export const ANALYTICS_CODE_PATTERN = /^[A-Za-z0-9_-]{1,16}$/;

/** wx.getNetworkType 的取值 */
export const NETWORK_TYPES = ["wifi", "5g", "4g", "3g", "2g", "none", "unknown"] as const;
export type NetworkType = (typeof NETWORK_TYPES)[number];

/** 清晰度 */
export type PlaybackQuality = "hd" | "sd";

/** 端上事件的属性（m08 第 2.11 节）。id 都是 uuid 字符串；时长都是整数毫秒 */
export interface ClientEventProps {
  /** 渠道码取启动参数；由邀请链接进入时 hasInvitation 为真，邀请令牌本身不上报 */
  app_launch: { channelCode?: AnalyticsCode; hasInvitation: boolean };
  /** 建档第几步、本步从进入到保存成功的耗时 */
  profile_step_save: { step: 1 | 2 | 3 | 4; durationMs: number };
  /** 发起切换的页面键 */
  store_switch: { fromPage: AnalyticsCode };
  mall_view: {
    category?: AnalyticsCode;
    filters?: {
      genre?: AnalyticsCode;
      industry?: AnalyticsCode;
      episodes?: AnalyticsCode;
      price?: AnalyticsCode;
    };
    sort?: "composite" | "heat" | "price_asc" | "price_desc" | "newest";
    mode: "list" | "trailer";
  };
  /** playMs 在 0 到 3,600,000 之间 */
  trailer_play: { dramaId: string; playMs: number; finished: boolean };
  drama_detail_view: { dramaId: string; fromPage: AnalyticsCode };
  /** 分享按钮所在页面；在短剧页时带剧目 */
  share_click: { page: AnalyticsCode; dramaId?: string };
  banner_click: { homeBannerId: string };
  /** sdkVersion 形如 3.4.10，至多四段数字 */
  playback_fallback: {
    playableId: string;
    network: NetworkType;
    fromQuality: PlaybackQuality;
    toQuality: PlaybackQuality;
    sdkVersion?: string;
  };
  trailer_first_frame: {
    playableId: string;
    firstFrameMs: number;
    network: NetworkType;
    quality: PlaybackQuality;
  };
}
