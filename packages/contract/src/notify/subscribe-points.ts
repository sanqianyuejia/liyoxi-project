// 小程序订阅消息的授权引导点位（m08 第 4 节 SubscribePoint；D6 第 2.9.3 节；D7 第 4.8 节）。
// 页面只引这里的常量：在用户本来就要点的按钮上顺带请求订阅，withSubscribe(点位, 处理函数)。
// 每个点位请求哪些模板不在这里：由引导接口的 subscribePlan 下发（服务端按槽位配置与购买入口模式裁剪）。
// 新增取值不算契约的破坏性变更（请求枚举）。键与文档对账（pnpm api-registries:check）。纯常量：本文件不引任何包。
export interface SubscribePointDef<K extends string = string> {
  /** 点位键 */
  readonly key: K;
  /** 挂在哪个按钮上（D6 第 2.9.3 节“按钮”一栏；只作说明，不对账） */
  readonly label: string;
}

const point = <const K extends string>(key: K, label: string): SubscribePointDef<K> => ({
  key,
  label,
});

export const SUBSCRIBE_POINTS = [
  point("profile_submit", "提交资质审核、新增门店提交"),
  point("pay_success", "支付成功回调（开通、续费、升级、加购）"),
  point("transfer_submit", "提交对公转账凭证"),
  point("order_submit", "确认订购"),
  point("plan_confirm", "确认交付方案"),
  point("ad_submit", "提交广告需求"),
  point("ad_confirm", "确认广告"),
  point("sample_confirm", "确认样片"),
  point("package_download", "下载成片"),
  point("link_submit", "回填上线链接"),
  point("offline_confirm", "确认已下架"),
  point("ticket_submit", "提交工单"),
  point("ticket_reply", "追加回复"),
  point("invoice_apply", "申请开票"),
  point("renew_enter", "点击“去续费”"),
  point("member_invite", "发送邀请"),
  point("member_join", "店员确认加入"),
  point("asset_upload", "店员提交素材"),
  point("notify_settings", "“通知设置”页的“开启”按钮"),
] as const;

/** 点位键 */
export type SubscribePoint = (typeof SUBSCRIBE_POINTS)[number]["key"];
export const SUBSCRIBE_POINT_KEYS: readonly SubscribePoint[] = SUBSCRIBE_POINTS.map(
  (item) => item.key,
);

export function isSubscribePoint(value: unknown): value is SubscribePoint {
  return typeof value === "string" && (SUBSCRIBE_POINT_KEYS as readonly string[]).includes(value);
}

/** 点位键的写法：小写蛇形 */
export const SUBSCRIBE_POINT_KEY_PATTERN = /^[a-z][a-z0-9_]*$/;
