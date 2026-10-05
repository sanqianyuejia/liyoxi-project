// billing 模块的枚举。取值的中文含义见 docs/data-model/ 下 07、08 分组文档的第 3 节。
// 一列一个枚举，名字是“表名_列名”；同一模块里几列同组同义的合成一个。跨模块共用的在 shared.ts。
import { defineEnum } from "./define.js";

export const PLAN_SCOPE = defineEnum("plan_scope", ["plan.scope"], ["public", "entity"]);

export const DRAMA_PRICE_REVISION_MODE = defineEnum(
  "drama_price_revision_mode",
  ["drama_price_revision.mode"],
  ["template", "custom"],
);

export const DRAMA_PRICE_REVISION_REASON_CODE = defineEnum(
  "drama_price_revision_reason_code",
  ["drama_price_revision.reason_code"],
  ["quality", "genre_fit", "release_timing", "license_remaining", "restore_template"],
);

export const BILLING_PARAM_KEY = defineEnum(
  "billing_param_key",
  ["billing_param.key"],
  [
    "adUnitPoints",
    "adFreeRevisions",
    "topModelSurchargeBp",
    "cancelDeductionBp",
    "expiredTermRefund",
    "minLicenseMonths",
    "renewalReminderDays",
    "prorationBaseDays",
    "planRefundWindowHours",
    "enabledCycles",
    "maxScheduledTerms",
    "noticeDays",
  ],
);

/** 主体的订阅状态 */
export const BILLING_SUB_STATUS = defineEnum(
  "billing_sub_status",
  ["billing_account.sub_status", "billing_entity_daily.sub_status"],
  ["none", "active", "expired"],
);

export const SUBSCRIPTION_TERM_ORIGIN = defineEnum(
  "subscription_term_origin",
  ["subscription_term.origin"],
  ["new", "renew", "resume"],
);

export const SUBSCRIPTION_TERM_STATUS = defineEnum(
  "subscription_term_status",
  ["subscription_term.status"],
  ["scheduled", "active", "ended", "refunded", "cancelled"],
);

export const SUBSCRIPTION_TERM_REFUND_RULE = defineEnum(
  "subscription_term_refund_rule",
  ["subscription_term.refund_rule"],
  ["window", "qualification_failed", "override"],
);

export const SUBSCRIPTION_EVENT_TYPE = defineEnum(
  "subscription_event_type",
  ["subscription_event.type"],
  [
    "activated",
    "renewal_scheduled",
    "rolled_over",
    "upgraded",
    "downgrade_scheduled",
    "extended",
    "expired",
    "resumed",
    "refund_suspended",
    "refund_resumed",
    "refunded",
    "cancelled",
  ],
);

export const GRANT_SCHEDULE_STATUS = defineEnum(
  "grant_schedule_status",
  ["grant_schedule.status"],
  ["pending", "granted", "cancelled"],
);

export const POINT_LOT_SOURCE_TYPE = defineEnum(
  "point_lot_source_type",
  ["point_lot.source_type"],
  ["grant_monthly", "grant_upgrade", "purchase", "adjust", "conversion"],
);

export const POINT_HOLD_STATUS = defineEnum(
  "point_hold_status",
  ["point_hold.status"],
  ["held", "captured", "released", "refunded_partial", "refunded_full"],
);

export const LEDGER_OPERATION_OP_TYPE = defineEnum(
  "ledger_operation_op_type",
  ["ledger_operation.op_type"],
  [
    "grant",
    "purchase",
    "hold",
    "capture",
    "release",
    "refund",
    "expire",
    "unexpire",
    "adjust",
    "revoke",
    "addon_suspend",
    "addon_resume",
    "refund_suspend",
    "refund_resume",
    "fulfill",
    "extend",
    "fix",
  ],
);

export const LEDGER_OPERATION_REF_TYPE = defineEnum(
  "ledger_operation_ref_type",
  ["ledger_operation.ref_type"],
  [
    "order_item",
    "ad",
    "ad_revision",
    "billing_order",
    "grant_schedule",
    "subscription_term",
    "approval_request",
    "refund_request",
    "payment_exception",
    "cancel_request_line",
  ],
);

/** 积分流水的来去桶 */
export const POINT_BUCKET = defineEnum(
  "point_bucket",
  ["point_ledger_entry.from_bucket", "point_ledger_entry.to_bucket"],
  [
    "external",
    "available",
    "held",
    "consumed",
    "expired",
    "revoked",
    "converted_out",
    "adjusted_out",
  ],
);

export const POINT_ENTRY_VALUATION_EFFECT = defineEnum(
  "point_entry_valuation_effect",
  ["point_entry_valuation.effect"],
  [
    "inflow",
    "recognize",
    "recognize_breakage",
    "reverse",
    "reverse_transfer",
    "reverse_breakage",
    "reverse_breakage_refund",
    "transfer_out",
    "refund_out",
    "adjust_out",
    "none",
  ],
);

export const POINT_ADJUSTMENT_REQUEST_DIRECTION = defineEnum(
  "point_adjustment_request_direction",
  ["point_adjustment_request.direction"],
  ["increase", "decrease"],
);

export const POINT_ADJUSTMENT_REQUEST_REASON_CODE = defineEnum(
  "point_adjustment_request_reason_code",
  ["point_adjustment_request.reason_code"],
  ["compensation", "platform_refund", "correction", "campaign", "other"],
);

export const TERM_EXTENSION_REQUEST_APPLIED_MODE = defineEnum(
  "term_extension_request_applied_mode",
  ["term_extension_request.applied_mode"],
  ["extend", "revive"],
);

export const BILLING_ORDER_TYPE = defineEnum(
  "billing_order_type",
  ["billing_order.type"],
  ["plan_new", "plan_renew", "plan_upgrade", "topup"],
);

export const BILLING_ORDER_STATUS = defineEnum(
  "billing_order_status",
  ["billing_order.status"],
  ["pending_payment", "pending_confirmation", "paid", "cancelled", "refunded"],
);

export const BILLING_ORDER_SOURCE = defineEnum(
  "billing_order_source",
  ["billing_order.source"],
  ["weapp", "admin"],
);

export const BILLING_ORDER_TRANSFER_STATE = defineEnum(
  "billing_order_transfer_state",
  ["billing_order.transfer_state"],
  ["awaiting_proof", "proof_submitted", "proof_rejected", "confirm_review"],
);

export const BILLING_ORDER_FULFILLMENT_STATUS = defineEnum(
  "billing_order_fulfillment_status",
  ["billing_order.fulfillment_status"],
  ["none", "done", "blocked"],
);

export const BILLING_ORDER_CANCEL_REASON = defineEnum(
  "billing_order_cancel_reason",
  ["billing_order.cancel_reason"],
  ["timeout", "user", "staff", "transfer_ttl", "amount_mismatch", "payer_mismatch"],
);

export const BILLING_ORDER_CLIENT_PLATFORM = defineEnum(
  "billing_order_client_platform",
  ["billing_order.client_platform"],
  ["ios", "android", "harmony", "windows", "mac", "devtools", "unknown"],
);

export const BILLING_ORDER_PROXY_ACTOR_TYPE = defineEnum(
  "billing_order_proxy_actor_type",
  ["billing_order.proxy_actor_type"],
  ["merchant", "partner"],
);

/** 对账状态 */
export const RECON_STATE = defineEnum(
  "recon_state",
  ["payment_txn.recon_state", "refund_txn.recon_state"],
  ["pending", "matched", "diff", "resolved"],
);

export const PAYMENT_TXN_STATUS = defineEnum(
  "payment_txn_status",
  ["payment_txn.status"],
  ["created", "prepaid", "succeeded", "closed"],
);

export const TRANSFER_PROOF_REVIEW_STATUS = defineEnum(
  "transfer_proof_review_status",
  ["transfer_proof.review_status"],
  ["pending", "accepted", "rejected", "superseded"],
);

export const REFUND_REQUEST_SOURCE = defineEnum(
  "refund_request_source",
  ["refund_request.source"],
  ["customer_service", "exception"],
);

export const REFUND_REQUEST_RULE_CODE = defineEnum(
  "refund_request_rule_code",
  ["refund_request.rule_code"],
  ["window", "qualification_failed", "override", "fulfillment_blocked", "unapplied_receipt"],
);

export const REFUND_REQUEST_STATUS = defineEnum(
  "refund_request_status",
  ["refund_request.status"],
  ["pending_approval", "pending_execution", "executing", "done", "not_executed"],
);

export const REFUND_REQUEST_EXEC_ROUTE = defineEnum(
  "refund_request_exec_route",
  ["refund_request.exec_route"],
  ["wechat_original", "offline"],
);

export const REFUND_TXN_CHANNEL = defineEnum(
  "refund_txn_channel",
  ["refund_txn.channel"],
  ["wechat_jsapi", "offline"],
);

export const REFUND_TXN_ORIGIN = defineEnum(
  "refund_txn_origin",
  ["refund_txn.origin"],
  ["system", "external"],
);

export const REFUND_TXN_STATUS = defineEnum(
  "refund_txn_status",
  ["refund_txn.status"],
  ["created", "processing", "succeeded", "closed", "abnormal", "not_accepted", "abandoned"],
);

export const PAYMENT_EXCEPTION_KIND = defineEnum(
  "payment_exception_kind",
  ["payment_exception.kind"],
  [
    "paid_after_cancel",
    "amount_mismatch",
    "payer_mismatch",
    "duplicate_receipt",
    "fulfillment_blocked",
    "bill_only",
    "platform_only",
    "status_mismatch",
    "bank_unmatched",
    "refund_bill_only",
    "refund_platform_only",
    "refund_amount_mismatch",
    "refund_over",
    "entitlement_unrecovered",
  ],
);

export const PAYMENT_EXCEPTION_DETECTED_BY = defineEnum(
  "payment_exception_detected_by",
  ["payment_exception.detected_by"],
  ["callback", "query", "apply", "reconciliation", "manual"],
);

export const PAYMENT_EXCEPTION_STATUS = defineEnum(
  "payment_exception_status",
  ["payment_exception.status"],
  ["open", "resolving", "resolved", "auto_healed", "ignored"],
);

export const PAYMENT_EXCEPTION_RESOLUTION = defineEnum(
  "payment_exception_resolution",
  ["payment_exception.resolution"],
  [
    "restore",
    "refund",
    "retried",
    "rebuild_order",
    "link_order",
    "offline_return",
    "record_channel_refund",
    "corrected",
    "written_off",
    "none",
  ],
);

export const WX_BILL_FILE_BILL_TYPE = defineEnum(
  "wx_bill_file_bill_type",
  ["wx_bill_file.bill_type"],
  ["trade_all"],
);

export const WX_BILL_FILE_STATUS = defineEnum(
  "wx_bill_file_status",
  ["wx_bill_file.status"],
  ["pending", "downloaded", "parsed", "empty", "failed"],
);

export const WX_BILL_LINE_LINE_KIND = defineEnum(
  "wx_bill_line_line_kind",
  ["wx_bill_line.line_kind"],
  ["payment", "refund"],
);

export const WX_BILL_LINE_MATCH_STATE = defineEnum(
  "wx_bill_line_match_state",
  ["wx_bill_line.match_state"],
  ["matched", "matched_pending", "diff", "unmatched", "foreign"],
);

export const RECON_DAY_STATUS = defineEnum(
  "recon_day_status",
  ["recon_day.status"],
  ["wait", "ok", "diff", "fixed"],
);

export const INVOICE_REQUEST_INVOICE_TYPE = defineEnum(
  "invoice_request_invoice_type",
  ["invoice_request.invoice_type"],
  ["normal", "special"],
);

export const INVOICE_REQUEST_MEDIUM = defineEnum(
  "invoice_request_medium",
  ["invoice_request.medium"],
  ["electronic", "paper"],
);

export const INVOICE_REQUEST_STATUS = defineEnum(
  "invoice_request_status",
  ["invoice_request.status"],
  ["pending", "issued", "rejected", "red_pending", "red_issued"],
);

export const INVOICE_REQUEST_REJECT_KIND = defineEnum(
  "invoice_request_reject_kind",
  ["invoice_request.reject_kind"],
  ["manual", "order_refunded"],
);

export const INVOICE_REQUEST_PROVIDER = defineEnum(
  "invoice_request_provider",
  ["invoice_request.provider"],
  ["manual"],
);

export const INVOICE_DOC_DOC_KIND = defineEnum(
  "invoice_doc_doc_kind",
  ["invoice_doc.doc_kind"],
  ["blue", "red"],
);

export const INVOICE_DOC_FILE_FORMAT = defineEnum(
  "invoice_doc_file_format",
  ["invoice_doc.file_format"],
  ["pdf", "ofd", "xml"],
);

export const INVOICE_DOC_EMAIL_STATE = defineEnum(
  "invoice_doc_email_state",
  ["invoice_doc.email_state"],
  ["none", "queued", "sent", "failed", "skipped"],
);

export const FINANCE_CONFIG_REVISION_CONFIG_KEY = defineEnum(
  "finance_config_revision_config_key",
  ["finance_config_revision.config_key"],
  ["bank_account", "purchase_policy", "controls"],
);
