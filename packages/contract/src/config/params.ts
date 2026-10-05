// 参数键清单（14 分组 第 2.3 节“参数键的归属”表，加 07 第 7 节“待回写清单”里的参数）：只登记键名与所属分组。
// 参数的类型、单位、范围、默认值不在这里：定义由 W0-18 按 14 分组 第 2.3 节交付（任务书 W0-09a 第 11 节第 3 项）；
// 不变量 config.N17 核对库里 param_value.key 都是登记过的键。
// 归属表里用“等”带过的键、带通配的键（payment.description_template.*、invoice.item_name.*）不猜、不登记，
// 随用到它的包补登；计费规则参数的 12 个键在 billing_param，按枚举登记（enums/billing.ts 的 BILLING_PARAM_KEY）。
// 纯常量：经 ./config/params 子路径给 shared 用，本文件不引任何包。
import type { NameFormat } from "../registry/formats.js";

/** 参数键的写法（ck_param_value_key）：小写点分 2–6 段，不超过 64 个字符 */
export const PARAM_KEY_FORMAT = {
  column: "param_value.key",
  pattern: "^[a-z][a-z0-9_]*(\\.[a-z0-9_]+){1,5}$",
  maxLength: 64,
} as const satisfies NameFormat;

/**
 * 分组 → 键。07 第 7 节补登的 7 个键，归属表里没有：键以已有分组名开头的归那一组，其余按用它的模块归
 *（任务书 W0-09b 第 11 节第 12 项）。分组名照归属表第一栏；第一栏并列写了几个名字的（如 payment / refund / invoice / recon），
 * 按键的归属拆开：键以哪个名字开头就归哪个，对不上的按表里写的模块归（auth.* 归 identity，
 * invitation.* 归 tenant，admin.* 归 staff）。
 */
export const PARAM_KEYS_BY_GROUP = {
  /** 时限策略，值是 { amount, unit } */
  sla: [
    "sla.ticket.assign",
    "sla.ticket.plan_confirm",
    "sla.ticket.sample_making",
    "sla.ticket.batch_compose",
    "sla.ticket.delivering",
    "sla.delivery.target",
    "sla.ad.first_version",
    "sla.ad.revision",
    "sla.review.qualification",
    "sla.review.channel_account",
    "sla.review.launch_link",
    "sla.review.store_asset",
    "sla.review.refund_approve",
    "sla.review.refund_execute",
    "sla.review.transfer_proof",
    "sla.review.invoice_request",
    "sla.takedown.check",
    "sla.service.first_response",
    "sla.service.solution",
    "sla.service.auto_resolve",
    "sla.manager.first_contact",
  ],
  /** 工作时间段；节假日在 work_calendar_day */
  calendar: ["work.start", "work.end"],
  remind: [
    "remind.plan_expiry.time",
    "remind.launch.days",
    "remind.offline.days",
    "remind.sample.after_days",
    "remind.copyright.days",
    "remind.grace_hours",
    "remind.cert_expiry.days",
  ],
  notify: [
    "notify.window.start",
    "notify.window.end",
    "notify.sms.daily_cap",
    "notify.sms.keepalive_days",
    "notify.wx.quota_cap",
    "notify.wx.field_fail_streak",
    // 07 第 7 节的待回写项：后台“测试发送”的接收人；值里的 phone、wxOpenid 是敏感路径
    "notify.test_recipients",
  ],
  general: [
    "package.link_ttl_days",
    "audit.retention_years",
    // V1.1 才用，归属表里写出了，照登
    "trial.episodes",
    "inbox.scope",
    "home.banner.max_active",
  ],
  /** 三个时限键；计费规则参数在 billing_param，不在这里 */
  billing: [
    "billing.payment.order_timeout_minutes",
    "billing.payment.transfer_valid_days",
    "billing.upgrade_quote_valid_hours",
  ],
  payment: ["payment.bank_transfer.min_fen", "payment.wechat.advise_transfer_above_fen"],
  refund: [
    "refund.original_route_safety_hours",
    "refund.bill_wait_days",
    "refund.points.auto_approve_before_production",
    "refund.require_distinct_executor",
  ],
  invoice: ["invoice.apply_within_days", "invoice.no_rules"],
  recon: ["recon.first_run_time", "recon.alarm_time"],
  export: [
    "export.max_rows",
    "export.xlsx_max_rows",
    "export.max_concurrent_per_staff",
    "export.retention_hours",
  ],
  analytics: ["analytics.anon.daily_cap", "analytics.retention_months"],
  platform: [
    "platform.legal_entity",
    "agreement.announce_min_days",
    "docs.license.allow_stamp_only",
  ],
  identity: ["auth.dormant_days", "auth.identity_remove_min_age_days"],
  tenant: [
    "tenant.default_store_limit",
    "tenant.default_member_limit",
    "invitation.ttl_hours",
    "invitation.require_phone",
    "invitation.daily_cap",
  ],
  staff: ["admin.password_max_age_days"],
  approval: ["approval.remind_workdays", "approval.escalate_workdays"],
  content: [
    "content.permit.platform_check",
    "content.placement.open_slots",
    // 07 第 7 节的待回写项：搜索无结果时按行业兜底推荐
    "catalog.search.industry_fallback",
  ],
  media: [
    "files.purge.mode",
    "files.purge.max_objects",
    "files.purge.max_bytes",
    "files.retention.portrait_auth_adopted_years",
    // 07 第 7 节的待回写项：小程序上传视频的大小上限；逐集保存的落盘方式
    "upload.weapp_video_max_mb",
    "download.weapp_save_mode",
  ],
  order: ["order.start_delay_minutes", "order.rejected_stale_days"],
  ad: [
    "ad.returned_stale_days",
    // 07 第 7 节的待回写项：广告时长选项（秒）；每轮修改意见的截图上限
    "ad.duration_options",
    "ad.revision_screenshot_max",
  ],
  delivery: ["qc.episode.four_eyes"],
  publish: [
    "launch.partial_goes_live",
    "launch.verify_revoke_window",
    "patrol.weekly_sample",
    "takedown.check_mode",
  ],
  support: ["service.reopen_window_days"],
  /** 07 第 7 节的待回写项：每门店每日证照识别次数上限。14 分组的归属表里没有这一组 */
  profile: ["ocr.daily_limit_per_store"],
} as const;

/** 参数分组 */
export type ParamGroup = keyof typeof PARAM_KEYS_BY_GROUP;
/** 已登记的参数键 */
export type ParamKey = (typeof PARAM_KEYS_BY_GROUP)[ParamGroup][number];

export interface ParamKeyDef {
  readonly key: ParamKey;
  readonly group: ParamGroup;
}

/** 全部参数键，一项一个：键与所属分组 */
export const PARAM_KEYS: readonly ParamKeyDef[] = (
  Object.entries(PARAM_KEYS_BY_GROUP) as [ParamGroup, readonly ParamKey[]][]
).flatMap(([group, keys]) => keys.map((key) => ({ key, group })));

/** 一个键是否已登记 */
export function isParamKey(key: string): key is ParamKey {
  return PARAM_KEYS.some((item) => item.key === key);
}
