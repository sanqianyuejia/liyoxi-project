// order 模块的枚举。取值的中文含义见 docs/data-model/ 下 09 分组文档的第 3 节。
// 一列一个枚举，名字是“表名_列名”；同一模块里几列同组同义的合成一个。跨模块共用的在 shared.ts。
import { defineEnum } from "./define.js";

export const DRAMA_ORDER_STATUS = defineEnum(
  "drama_order_status",
  ["drama_order.status"],
  [
    "pending_start",
    "producing",
    "to_launch",
    "live",
    "ended",
    "cancelled",
    "after_sale",
    "refunded",
  ],
);

/** 使用期止日来源 */
export const USAGE_END_SOURCE = defineEnum(
  "usage_end_source",
  ["order_item.usage_end_source", "cancel_request_line.usage_end_source"],
  ["license", "early_end", "expired"],
);

export const ORDER_ITEM_PHASE = defineEnum(
  "order_item_phase",
  ["order_item.phase"],
  [
    "pending_start",
    "producing",
    "to_launch",
    "live",
    "ended",
    "cancelled",
    "refunded",
    "terminated",
  ],
);

export const CANCEL_REQUEST_KIND = defineEnum(
  "cancel_request_kind",
  ["cancel_request.kind"],
  ["order_cancel", "ad_cancel", "qualification_cancel"],
);

export const CANCEL_REQUEST_STATUS = defineEnum(
  "cancel_request_status",
  ["cancel_request.status"],
  ["pending_approval", "pending_execution", "done", "not_executed"],
);

export const CANCEL_REQUEST_LINE_TARGET_TYPE = defineEnum(
  "cancel_request_line_target_type",
  ["cancel_request_line.target_type"],
  ["order_item", "ad"],
);

export const CANCEL_REQUEST_LINE_MODE = defineEnum(
  "cancel_request_line_mode",
  ["cancel_request_line.mode"],
  ["release", "refund", "terminate_only"],
);

export const CANCEL_REQUEST_LINE_STAGE = defineEnum(
  "cancel_request_line_stage",
  ["cancel_request_line.stage"],
  [
    "pending_start",
    "plan_confirm",
    "ad_and_sample",
    "sample_pending",
    "post_sample",
    "live",
    "ad_unassigned",
    "ad_in_production",
  ],
);
