// ad 模块的枚举。取值的中文含义见 docs/data-model/ 下 09 分组文档的第 3 节。
// 一列一个枚举，名字是“表名_列名”；同一模块里几列同组同义的合成一个。跨模块共用的在 shared.ts。
import { defineEnum } from "./define.js";

export const AD_STATUS = defineEnum(
  "ad_status",
  ["ad.status"],
  [
    "pending_assign",
    "producing",
    "returned",
    "pending_confirm",
    "revising",
    "confirmed",
    "cancelled",
  ],
);

export const AD_RETURNED_FROM = defineEnum(
  "ad_returned_from",
  ["ad.returned_from"],
  ["pending_assign", "producing"],
);

export const AD_VERSION_DECISION = defineEnum(
  "ad_version_decision",
  ["ad_version.decision"],
  ["confirmed", "revision_requested", "superseded"],
);

export const AD_REVISION_SOURCE = defineEnum(
  "ad_revision_source",
  ["ad_revision.source"],
  ["ad_page", "sample_feedback", "staff_on_behalf"],
);
