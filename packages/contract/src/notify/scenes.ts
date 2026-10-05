// 通知场景的登记（a09 第 2.9 节“通知场景清单”；13 分组 第 2.1 节 notify_scene 的播种清单）：键、受众、显示名。
// 库里 notify_scene 的行由播种按这张表写入（W0-21），后台只能改开关，不能增删行；新增、改名场景先改这里与 a09。
// 场景的触发事件、接收人、文案、深链、变量结构不在这里：在 packages/services 的通知注册表里，它登记的键要与这里一一对应。
// 通道绑定的播种值（订阅槽位、短信模板与策略、发送时段）也不在这里，随播种（W0-21）按 13 分组 第 2.1 节写。
// 键、受众、显示名与文档对账（pnpm api-registries:check）。纯常量：本文件只引类型，不引任何包。
import type { EnumValue } from "../enums/define.js";
import type { NOTIFY_SCENE_AUDIENCE } from "../enums/notify.js";
import type { NameFormat } from "../registry/formats.js";

/** 受众：merchant 商家、staff 员工（notify_scene.audience） */
export type NotifySceneAudience = EnumValue<typeof NOTIFY_SCENE_AUDIENCE>;

export interface NotifySceneDef<K extends string = string> {
  /** 场景键（notify_scene.scene_key）：商家场景以 m. 开头，员工场景以 s. 开头 */
  readonly key: K;
  /** 受众，由键的前缀得出 */
  readonly audience: NotifySceneAudience;
  /** 后台显示名（notify_scene.name） */
  readonly name: string;
}

/** 场景键的写法（ck_notify_scene_scene_key 里的正则；前缀与受众一致是同一条约束的另一半） */
export const NOTIFY_SCENE_KEY_FORMAT = {
  column: "notify_scene.scene_key",
  pattern: "^[ms]\\.[a-z][a-z0-9_]*$",
} as const satisfies NameFormat;
/** 长度上限（ck_notify_scene_text_len）：键不超过 48 个字符，显示名不超过 32 个字 */
export const NOTIFY_SCENE_KEY_MAX_LENGTH = 48;
export const NOTIFY_SCENE_NAME_MAX_LENGTH = 32;

function scene<const K extends `${"m" | "s"}.${string}`>(key: K, name: string): NotifySceneDef<K> {
  return { key, audience: key.startsWith("m.") ? "merchant" : "staff", name };
}

export const NOTIFY_SCENES = [
  // 商家场景
  scene("m.pay_success", "付款成功"),
  scene("m.order_submitted", "订购成功"),
  scene("m.plan_pending", "方案待确认"),
  scene("m.ad_pending", "广告待确认"),
  scene("m.sample_pending", "样片待确认"),
  scene("m.delivered", "成片已交付"),
  scene("m.launch_remind", "上线提醒"),
  scene("m.verify_result", "核验结果"),
  scene("m.plan_expiring", "套餐到期提醒"),
  scene("m.offline_remind", "下架提醒"),
  scene("m.ticket_reply", "工单回复"),
  scene("m.invoice_issued", "发票已开具"),
  scene("m.points_changed", "积分变动"),
  scene("m.review_result", "资质审核结果"),
  scene("m.member_changed", "成员变动"),
  scene("m.asset_feedback", "素材反馈"),
  scene("m.refund_result", "退款结果"),
  scene("m.rule_change_notice", "规则变更公告"),
  scene("m.rule_change_withdrawn", "调整已取消"),
  scene("m.plan_activated", "套餐已开通"),
  scene("m.plan_renewed", "续费成功"),
  scene("m.plan_upgraded", "套餐已升级"),
  scene("m.plan_extended", "有效期延长"),
  scene("m.points_captured", "积分已扣减"),
  scene("m.points_expired", "上期积分已清零"),
  scene("m.transfer_rejected", "对公收款驳回"),
  scene("m.invoice_rejected", "发票驳回"),
  scene("m.store_review_submitted", "新增门店已提交审核"),
  scene("m.profile_proxy_edited", "档案已代改"),
  scene("m.channel_account_result", "渠道账号核验结果"),
  scene("m.patrol_abnormal", "巡检异常"),
  scene("m.license_letter_updated", "授权书已更新"),
  scene("m.account_security", "账号安全通知"),
  scene("m.order_progress", "订单与交付进度"),
  scene("m.cart_price_changed", "选剧单变价提示"),
  scene("m.refund_initiated", "已发起原路退款"),
  // 员工场景：外部通道是企业微信应用消息，没有订阅消息与短信
  scene("s.work_ticket_assigned", "交付工单分配"),
  scene("s.step_overdue", "步骤超时"),
  scene("s.kf_assigned", "客服工单待处理"),
  scene("s.kf_response_overdue", "首次响应超时"),
  scene("s.complaint_created", "投诉建议"),
  scene("s.launch_overdue", "上线逾期"),
  scene("s.offline_overdue", "下架逾期"),
  scene("s.copyright_expiring", "版权即将到期"),
  scene("s.approval_pending", "待审批"),
  scene("s.approval_decided", "审批结果"),
  scene("s.receipt_pending", "对公凭证待确认"),
  scene("s.merchant_unreached", "商家未触达"),
  scene("s.export_ready", "导出完成"),
  scene("s.system_alert", "系统告警"),
  scene("s.approval_overdue", "审批超时"),
  scene("s.handover_overdue", "转移后未联系商家"),
  scene("s.asset_feedback", "商家素材反馈"),
  scene("s.asset_review_overdue", "素材整理超时"),
  scene("s.finance_overdue", "财务待办超时"),
  scene("s.payment_exception", "支付差异单"),
  scene("s.kf_solution_overdue", "处理方案超时"),
  scene("s.kf_supplemented", "商家补充了说明"),
  scene("s.kf_todo", "客服待办"),
  scene("s.finance_config", "受控财务配置变更"),
  scene("s.delivery_progress", "交付进度"),
  scene("s.publish_progress", "发布待办"),
  scene("s.merchant_changed", "商家变动"),
] as const;

/** 已登记的场景键 */
export type NotifySceneKey = (typeof NOTIFY_SCENES)[number]["key"];
/** 商家场景的键 */
export type MerchantSceneKey = Extract<NotifySceneKey, `m.${string}`>;
/** 员工场景的键 */
export type StaffSceneKey = Extract<NotifySceneKey, `s.${string}`>;

export const NOTIFY_SCENE_KEYS: readonly NotifySceneKey[] = NOTIFY_SCENES.map((item) => item.key);

export function isNotifySceneKey(value: unknown): value is NotifySceneKey {
  return typeof value === "string" && (NOTIFY_SCENE_KEYS as readonly string[]).includes(value);
}

/** 按键找登记项 */
export function notifySceneByKey(key: string): NotifySceneDef | undefined {
  return (NOTIFY_SCENES as readonly NotifySceneDef[]).find((item) => item.key === key);
}
