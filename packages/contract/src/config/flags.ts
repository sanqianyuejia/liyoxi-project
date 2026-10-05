// 特性开关登记（14 分组 第 2.7 节；D7 第 3.2 节；约定 C80）：键、值类型、V1.0 默认值、下发范围。
// 开关的键必须先在这里登记。库里的行由播种按这张表写入（W0-21），后台只改默认值与规则；
// 不变量 config.N19 核对库里的键都在这里、值类型一致。新增键不算契约的破坏性变更（C80）。
// 购买入口不是开关，不在这里（它是受控财务配置里的规则表）。
// 纯常量：经 ./config/flags 子路径给小程序用，本文件不引任何包。json 类型的值长什么样（Zod 结构）不在这里。
import type { FEATURE_FLAG_EXPOSED_TO, FEATURE_FLAG_VALUE_TYPE } from "../enums/config.js";
import type { EnumValue } from "../enums/define.js";
import type { NameFormat } from "../registry/formats.js";

/** 值类型：bool、enum、json（feature_flag.value_type）。版本号这类字符串值登记为 json */
export type FlagValueType = EnumValue<typeof FEATURE_FLAG_VALUE_TYPE>;
/** 下发范围：client 经引导接口下发给前端，server 只在服务端用（feature_flag.exposed_to） */
export type FlagExposedTo = EnumValue<typeof FEATURE_FLAG_EXPOSED_TO>;

/** 能写进 feature_flag.default_value（jsonb）的值 */
export type FlagValue =
  boolean | string | number | null | readonly FlagValue[] | { readonly [key: string]: FlagValue };

export interface FlagDef<K extends string = string, X extends FlagExposedTo = FlagExposedTo> {
  /** 开关键（feature_flag.key） */
  readonly key: K;
  readonly valueType: FlagValueType;
  /** V1.0 的默认值：没有规则命中时的值，也是播种值。bool 是布尔，enum 是字符串，json 不限 */
  readonly defaultValue: FlagValue;
  readonly exposedTo: X;
  /** 一句话说明：关掉（或取默认值）时是什么表现 */
  readonly description: string;
}

/** 开关键的写法（ck_feature_flag_key）：小写点分 2–6 段，不超过 48 个字符 */
export const FLAG_KEY_FORMAT = {
  column: "feature_flag.key",
  pattern: "^[a-z][a-z0-9_]*(\\.[a-z0-9_]+){1,5}$",
  maxLength: 48,
} as const satisfies NameFormat;

function flag<const K extends string, const X extends FlagExposedTo>(
  key: K,
  valueType: FlagValueType,
  defaultValue: FlagValue,
  exposedTo: X,
  description: string,
): FlagDef<K, X> {
  return { key, valueType, defaultValue, exposedTo, description };
}

/**
 * 14 个开关，键、值类型、默认值照 14 分组 第 2.7 节的播种表。
 * 下发范围文档没有逐个给：D7 第 3.2 节列为前端要消费的记 client，其余记 server（任务书 W0-09a 第 11 节第 4 项）。
 */
export const FLAGS = [
  // 版本隐藏：V1.1 的功能在 V1.0 关闭。关着时服务端路由同样返回 FEATURE_DISABLED，不是只藏入口
  flag("release.partner", "bool", false, "client", "V1.1 功能的入口与路由，V1.0 关闭"),
  flag("release.notice_faq", "bool", false, "client", "V1.1 功能的入口与路由，V1.0 关闭"),
  flag("release.trial_episodes", "bool", false, "client", "V1.1 功能的入口与路由，V1.0 关闭"),
  flag("release.delegate_publish", "bool", false, "client", "V1.1 功能的入口与路由，V1.0 关闭"),
  // 内容形态：三个视频开关互相独立（ADR-028：预告片默认关）
  flag(
    "weapp.video.trailer.enabled",
    "bool",
    false,
    "client",
    "关：接口不返回预告片地址，商城与详情只有海报与剧情简介",
  ),
  flag(
    "weapp.video.sample.enabled",
    "bool",
    false,
    "client",
    "关：样片确认页不内嵌播放器，改为存相册查看与在电脑上预览",
  ),
  flag("weapp.video.ad.enabled", "bool", true, "client", "关：广告详情不内嵌播放器"),
  flag("weapp.trailer.autoplay", "bool", false, "client", "关：预告片点击才播放，不自动播放"),
  flag("weapp.trailer.feed", "bool", false, "client", "关：不提供“预告片模式”入口"),
  // 通道急停
  flag("notify.sms.enabled", "bool", true, "server", "关：不发短信"),
  flag("notify.wx.enabled", "bool", true, "client", "关：不发订阅消息，端上不再请求订阅授权"),
  flag("analytics.ingest.enabled", "bool", true, "client", "关：不收埋点，端上不再上报"),
  flag("export.enabled", "bool", true, "client", "关：不能导出，后台隐藏导出按钮"),
  // 版本下限：semver 字符串，登记为 json
  flag(
    "client.min_version",
    "json",
    "0.0.0",
    "client",
    "低于它的客户端版本得到 CLIENT_OUTDATED，端上引导更新",
  ),
] as const;

/** 已登记的开关键 */
export type FlagKey = (typeof FLAGS)[number]["key"];
/** 下发给前端的开关键（引导接口 flags 的键） */
export type ClientFlagKey = Extract<(typeof FLAGS)[number], { exposedTo: "client" }>["key"];

/** 按键找登记项 */
export function flagByKey(key: string): FlagDef | undefined {
  return (FLAGS as readonly FlagDef[]).find((item) => item.key === key);
}
