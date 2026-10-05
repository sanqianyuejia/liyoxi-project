// 共用枚举：几个模块的列用同一组取值、同一个含义的，只在这里声明一次，各模块的文件不再重复。
// 前 15 个是数据模型登记的共用枚举（docs/data-model/working/catalogue.json 的 enums_shared，顺序与取值照抄）；
// 后 5 个是与库对账时发现的：取值相同、含义相同、分属两个以上模块的列。
// 纯常量：本文件不引任何包。取值的增减先在这里声明，下一版再写入（约定 C37；x01 第 6 节 V4）。
import { defineEnum } from "./define.js";
import type { EnumValue } from "./define.js";

/** 操作人类型（06 第 3.3 节）。partner 在 V1.0 只声明、不写入 */
export const ACTOR_TYPE = defineEnum(
  "actor_type",
  [
    "outbox_event.actor_type",
    "status_transition.actor_type",
    "store.archive_actor_type",
    "entity_member.remove_actor_type",
    "invitation.revoke_actor_type",
    "audit_log.actor_type",
    "approval_request.submit_actor_type",
    "store_profile.last_edit_actor_type",
    "store_profile_media.create_actor_type",
    "subscription_event.actor_type",
    "point_hold.actor_type",
    "ledger_operation.actor_type",
    "ad_revision.actor_type",
    "delivery_ticket_pause.actor_type",
    "delivery_plan_version.decide_actor_type",
    "download_grant.actor_type",
    "launch_submission.submit_actor_type",
    "service_ticket_entry.actor_type",
    "analytics_event.actor_type",
  ],
  ["merchant", "staff", "system", "partner"],
);
export type ActorType = EnumValue<typeof ACTOR_TYPE>;

/** 客户端来源；系统动作为空。审计日志另有 cli，见 audit.ts 的 AUDIT_LOG_CLIENT */
export const CLIENT = defineEnum(
  "client",
  [
    "outbox_event.client",
    "status_transition.client",
    "store.archive_client",
    "entity_member.remove_client",
    "invitation.revoke_client",
    "approval_request.submit_client",
    "store_profile.last_edit_client",
    "store_profile_media.create_client",
    "file_object.upload_client",
    "store_asset.upload_client",
    "ocr_result.request_client",
    "subscription_event.client",
    "point_hold.client",
    "ledger_operation.client",
    "billing_order.proxy_client",
    "ad_revision.client",
    "delivery_ticket_pause.client",
    "delivery_plan_version.decide_client",
    "sample.decide_client",
    "download_grant.client",
    "delivery_download_log.client",
    "launch_submission.submit_client",
    "service_ticket_entry.client",
    "analytics_event.client",
  ],
  ["weapp", "portal", "admin"],
);
export type Client = EnumValue<typeof CLIENT>;

/** 渠道平台：抖音、视频号 */
export const CHANNEL_PLATFORM = defineEnum(
  "channel_platform",
  [
    "order_item_account.platform",
    "channel_account.platform",
    "launch_task.platform",
    "license_letter.platform",
  ],
  ["douyin", "wechat_channels"],
);
export type ChannelPlatform = EnumValue<typeof CHANNEL_PLATFORM>;

/** 商家角色快照：老板、店员 */
export const MERCHANT_ROLE = defineEnum(
  "merchant_role",
  [
    "outbox_event.actor_role",
    "entity_member.role",
    "store_asset.upload_actor_role",
    "agreement_consent.role",
    "analytics_event.role",
  ],
  ["owner", "clerk"],
);
export type MerchantRole = EnumValue<typeof MERCHANT_ROLE>;

/** 注册来源类型。partner 在 V1.0 只声明 */
export const SOURCE_TYPE = defineEnum(
  "source_type",
  ["merchant_user.source_type", "entity.source_type"],
  ["organic", "sales", "campaign", "partner"],
);
export type SourceType = EnumValue<typeof SOURCE_TYPE>;

/** 广告位。V1.0 只接受 opening、ending，后两个是 V1.1 预留 */
export const PLACEMENT_SLOT = defineEnum(
  "placement_slot",
  ["order_item_placement.slot", "ad.type"],
  ["opening", "ending", "corner", "mid_roll"],
);
export type PlacementSlot = EnumValue<typeof PLACEMENT_SLOT>;

/** 热度等级：content 维护，billing 的模板价按它取值 */
export const HEAT_TIER = defineEnum(
  "heat_tier",
  ["drama.heat_tier", "price_tier_revision.tier"],
  ["S", "A", "B", "C"],
);
export type HeatTier = EnumValue<typeof HEAT_TIER>;

/** 退回原因类别：order 与 billing 共用 */
export const RETURN_REASON_CLASS = defineEnum(
  "return_reason_class",
  ["cancel_request_line.reason_class"],
  ["merchant", "platform", "qualification"],
);
export type ReturnReasonClass = EnumValue<typeof RETURN_REASON_CLASS>;

/** 积分类型：套餐积分、加购积分 */
export const POINT_LOT_KIND = defineEnum(
  "point_lot_kind",
  [
    "point_lot.kind",
    "point_hold_alloc.lot_kind",
    "point_ledger_entry.lot_kind",
    "point_adjustment_request.lot_kind",
  ],
  ["plan", "addon"],
);
export type PointLotKind = EnumValue<typeof POINT_LOT_KIND>;

/** 冻结用途，也是账本幂等键的一段；取值是最终表名 */
export const POINT_HOLD_PURPOSE = defineEnum(
  "point_hold_purpose",
  ["point_hold.purpose", "point_hold.ref_type"],
  ["order_item", "ad", "ad_revision"],
);
export type PointHoldPurpose = EnumValue<typeof POINT_HOLD_PURPOSE>;

/** 收款渠道。退款渠道另有 offline，见 billing.ts 的 REFUND_TXN_CHANNEL */
export const PAY_CHANNEL = defineEnum(
  "pay_channel",
  ["billing_order.channel", "payment_txn.channel", "recon_day.channel"],
  ["wechat_jsapi", "bank_transfer"],
);
export type PayChannel = EnumValue<typeof PAY_CHANNEL>;

/** 审批单状态。执行状态在各领域表 */
export const APPROVAL_STATUS = defineEnum(
  "approval_status",
  ["approval_request.status"],
  ["pending", "approved", "rejected", "withdrawn"],
);
export type ApprovalStatus = EnumValue<typeof APPROVAL_STATUS>;

/** 审批单类型。有执行步的四个：order_cancel、ad_cancel、qualification_cancel、plan_refund；transfer_confirm 默认不启用 */
export const APPROVAL_KIND = defineEnum(
  "approval_kind",
  ["approval_request.kind"],
  [
    "qualification",
    "channel_account",
    "launch_link",
    "order_cancel",
    "ad_cancel",
    "qualification_cancel",
    "plan_refund",
    "points_adjust",
    "subscription_extend",
    "finance_config_change",
    "account_change",
    "transfer_confirm",
  ],
);
export type ApprovalKind = EnumValue<typeof APPROVAL_KIND>;

/** 资质结论：tenant 的 entity、store 与 profile 共用 */
export const QUALIFICATION_STATUS = defineEnum(
  "qualification_status",
  ["entity.verification_status", "store.qualification_status"],
  ["unsubmitted", "pending", "verified", "rejected"],
);
export type QualificationStatus = EnumValue<typeof QUALIFICATION_STATUS>;

/** 主体类型：企业、个体工商户 */
export const ENTITY_TYPE = defineEnum(
  "entity_type",
  ["entity.entity_type", "qualification_submission.claimed_entity_type"],
  ["enterprise", "individual"],
);
export type EntityType = EnumValue<typeof ENTITY_TYPE>;

// ---------- 与库对账时发现的跨模块共用 ----------

/** 成片的平台版本（媒体与交付共用；V1.0 只写 common）。在 channel_platform 之外多一个 common */
export const OUTPUT_VARIANT = defineEnum(
  "output_variant",
  [
    "upload_batch.variant",
    "production_record.variant",
    "episode_output.variant",
    "delivery_release.variant",
  ],
  ["common", "douyin", "wechat_channels"],
);
export type OutputVariant = EnumValue<typeof OUTPUT_VARIANT>;

/** 制作档位：标准、高级、顶级（套餐权益、订单项、制作留痕共用） */
export const PRODUCTION_MODEL = defineEnum(
  "production_model",
  [
    "production_record.production_tier",
    "plan_revision.production_model",
    "subscription_term.production_model",
    "order_item.production_model",
  ],
  ["standard", "advanced", "top"],
);
export type ProductionModel = EnumValue<typeof PRODUCTION_MODEL>;

/** 取消原因（取消申请、订单项、广告共用）。到 return_reason_class 的映射固定：前两个 merchant，第三个 platform，第四个 qualification */
export const CANCEL_REASON_CODE = defineEnum(
  "cancel_reason_code",
  ["order_item.cancel_reason_code", "cancel_request.reason_code", "ad.cancel_reason_code"],
  ["merchant_request", "store_closed", "platform_fault", "qualification_final"],
);
export type CancelReasonCode = EnumValue<typeof CANCEL_REASON_CODE>;

/** 制作排期：标准、优先、加急（套餐权益与交付工单共用） */
export const SCHEDULE_PRIORITY = defineEnum(
  "schedule_priority",
  [
    "plan_revision.schedule_priority",
    "subscription_term.schedule_priority",
    "delivery_ticket.schedule_priority",
  ],
  ["standard", "priority", "rush"],
);
export type SchedulePriority = EnumValue<typeof SCHEDULE_PRIORITY>;

/** 申请未执行即关闭的原因：审批驳回、审批前撤回、审批通过后作废（取消申请与退款申请共用，M54） */
export const REQUEST_CLOSE_REASON = defineEnum(
  "request_close_reason",
  ["refund_request.close_reason", "cancel_request.close_reason"],
  ["rejected", "withdrawn", "voided"],
);
export type RequestCloseReason = EnumValue<typeof REQUEST_CLOSE_REASON>;
