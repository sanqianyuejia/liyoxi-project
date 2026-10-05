// support 模块的枚举。取值的中文含义见 docs/data-model/ 下 12 分组文档的第 3 节。
// 一列一个枚举，名字是“表名_列名”；同一模块里几列同组同义的合成一个。跨模块共用的在 shared.ts。
import { defineEnum } from "./define.js";

export const SERVICE_TICKET_SOURCE = defineEnum(
  "service_ticket_source",
  ["service_ticket.source"],
  ["weapp", "online_chat", "phone"],
);

export const SERVICE_TICKET_PRIORITY = defineEnum(
  "service_ticket_priority",
  ["service_ticket.priority"],
  ["high", "mid", "low"],
);

export const SERVICE_TICKET_STATUS = defineEnum(
  "service_ticket_status",
  ["service_ticket.status"],
  ["pending", "processing", "awaiting_confirm", "resolved", "closed"],
);

export const SERVICE_TICKET_CLOSE_REASON = defineEnum(
  "service_ticket_close_reason",
  ["service_ticket.close_reason"],
  ["duplicate", "invalid", "withdrawn"],
);

export const SERVICE_TICKET_RESOLVED_VIA = defineEnum(
  "service_ticket_resolved_via",
  ["service_ticket.resolved_via"],
  ["merchant", "auto"],
);

export const SERVICE_TICKET_ENTRY_KIND = defineEnum(
  "service_ticket_entry_kind",
  ["service_ticket_entry.kind"],
  ["merchant_message", "staff_reply", "internal_note", "system_event"],
);

export const SERVICE_TICKET_ENTRY_TAG = defineEnum(
  "service_ticket_entry_tag",
  ["service_ticket_entry.tag"],
  [
    "submit",
    "supplement",
    "reopen",
    "reply",
    "solution",
    "result",
    "transfer",
    "status",
    "biz_event",
  ],
);

export const SERVICE_TICKET_REF_REF_TYPE = defineEnum(
  "service_ticket_ref_ref_type",
  ["service_ticket_ref.ref_type"],
  ["drama_order", "billing_order", "delivery_ticket", "ad", "approval_request"],
);
