// 审计日志的登记值（W0-14；docs/data-model/ 下 03 分组文档的第 3.3 节）：类别编码、对象类型、登录方式、动作的写法。
// 这几列库里不逐值 CHECK（audit_log.target_type 只有格式 CHECK），取值的唯一来源在这里；
// stream、client 两个有 CHECK 的枚举在 ../enums/audit.ts。纯常量：本文件不引任何包。
// 只有服务端与契约自测用，不开子路径，从包入口给出。各域加类别、加对象类型时只往数组末尾加，同 PR 改 03 分组文档。

/** 类别编码（audit_log.category）。展示名与所属菜单模块见 docs/api/a01-system.md 第 4 节 auditCategory */
export const AUDIT_CATEGORIES = [
  // 03 分组原有的 17 个；前八项是“系统 › 操作日志”的类型筛选
  "refund",
  "points_adjust",
  "term_adjust",
  "price_adjust",
  "points_expire",
  "points_grant",
  "profile_edit",
  "staff_authz",
  "param",
  "dict",
  "plan_config",
  "export",
  "member",
  "account_security",
  "manager_assign",
  "pii_reveal",
  "file_access",
  // 接口阶段补登（A107）
  "system_ops",
  "report",
  "merchant_quota",
  "merchant_lifecycle",
  "referral_code",
  "ops_config",
  "agreement",
  "notify_config",
  // 接口阶段补登（A155）
  "payment",
  "invoice",
  "recon",
  "finance_config",
  "docs",
  "delivery",
  "service_ticket",
  "approval",
  "review",
  "flow",
] as const;
export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];

/**
 * 对象类型（audit_log.target_type）：取最终表名。对象的标识是 uuid 时写 target_id，否则写 target_key
 * （staff_role 的角色键、dict_type 的类型键、feature_flag 的开关键、参数键，以及复合主键的表）。
 * 进程启动时对照库里的表名单校验（unknownAuditTargetTypes；接线在 W0-22、W0-23）。
 * 25 张状态机表都在里面：flow.transition 补活动流的那一行，对象类型就是状态机的表名（契约自测核对）。
 */
export const AUDIT_TARGET_TYPES = [
  // 03 分组
  "staff",
  "staff_group",
  "approval_request",
  "follow_up",
  "assignment_history",
  "staff_role",
  // 02 分组各表
  "merchant_user",
  "wechat_identity",
  "user_session",
  "portal_session",
  "merchant_user_notice",
  "sms_verification",
  "wecom_contact",
  "account_change_request",
  "entity",
  "store",
  "entity_member",
  "store_member",
  "invitation",
  "referral_code",
  "portal_ticket",
  // 05：许可、版权、剧集的保存也记在剧目上
  "drama",
  // 06：access 流
  "file_object",
  // 08 分组 12 张表
  "billing_order",
  "payment_txn",
  "transfer_proof",
  "refund_request",
  "refund_txn",
  "payment_exception",
  "wx_bill_file",
  "wx_bill_line",
  "recon_day",
  "invoice_request",
  "invoice_doc",
  "finance_config_revision",
  // 09 分组的四张状态机表：迁移时由 flow 补活动流的那一行，对象就是它们（KF-1 补）
  "drama_order",
  "cancel_request",
  "ad",
  "order_item",
  // 10 分组各表，含 sample（样片访问）
  "delivery_ticket",
  "delivery_ticket_stage",
  "delivery_ticket_pause",
  "delivery_plan",
  "delivery_plan_version",
  "delivery_plan_change_request",
  "sample",
  "episode_output",
  "qc_record",
  "delivery_release",
  "delivery_reissue",
  "download_grant",
  "delivery_download_log",
  "publish_list",
  "publish_list_episode",
  // 11 分组 7 张表
  "channel_account",
  "channel_account_submission",
  "launch_task",
  "launch_submission",
  "patrol_batch",
  "patrol_task",
  "takedown_task",
  // 12、13 分组的两张状态机表（KF-1 补，缘由同 09 分组）
  "service_ticket",
  "license_letter",
  // 14 分组
  "dict_item",
  "site_config_revision",
  "home_banner",
  "site_notice",
  "checklist_template",
  "export_job",
  "report_month_close",
  "dict_type",
  "feature_flag",
  "param_value",
  // 07：参数键
  "billing_param",
  // 15 分组
  "webhook_event",
  "alert_event",
  "invariant_violation",
  "invariant_run",
  // 04：档案及资质实际审计对象（W1-08）
  "store_profile",
  "qualification_submission",
  "qualification_doc",
  "agreement_consent", // W2-04：协议同意快照字段的 access 审计
  // 01：年度日历配置审计的自然键对象（W2-05）
  "work_calendar_day",
] as const;
export type AuditTargetType = (typeof AUDIT_TARGET_TYPES)[number];

/** 登录方式（audit_log.auth_method）：员工两种、小程序会话、下载页会话、系统任务 */
export const AUDIT_AUTH_METHODS = [
  "password+totp",
  "password+recovery",
  "weapp",
  "portal",
  "system",
] as const;
export type AuditAuthMethod = (typeof AUDIT_AUTH_METHODS)[number];

/** 动作（audit_log.action）：<领域>.<对象>.<动作>，小写蛇形，至少三段，如 finance.refund.execute */
export type AuditAction = `${string}.${string}.${string}`;
export const AUDIT_ACTION_PATTERN = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*){2,}$/;

export const isAuditCategory = (value: string): value is AuditCategory =>
  (AUDIT_CATEGORIES as readonly string[]).includes(value);
export const isAuditTargetType = (value: string): value is AuditTargetType =>
  (AUDIT_TARGET_TYPES as readonly string[]).includes(value);
export const isAuditAction = (value: string): value is AuditAction =>
  AUDIT_ACTION_PATTERN.test(value);

/** 对照库里的表名单：返回登记了、库里却没有这张表的对象类型。启动自检用，空数组即通过 */
export function unknownAuditTargetTypes(tables: Iterable<string>): AuditTargetType[] {
  const known = new Set(tables);
  return AUDIT_TARGET_TYPES.filter((type) => !known.has(type));
}
