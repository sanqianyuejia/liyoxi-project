// content 模块的枚举。取值的中文含义见 docs/data-model/ 下 05 分组文档的第 3 节。
// 一列一个枚举，名字是“表名_列名”；同一模块里几列同组同义的合成一个。跨模块共用的在 shared.ts。
import { defineEnum } from "./define.js";

export const DRAMA_STATUS = defineEnum(
  "drama_status",
  ["drama.status"],
  ["draft", "listed", "delisted"],
);

export const DRAMA_DELIST_REASON_CODE = defineEnum(
  "drama_delist_reason_code",
  ["drama.delist_reason_code"],
  ["ops_strategy", "rights_issue", "content_revision", "other", "license_expired"],
);

export const DRAMA_DRAMA_CLASS = defineEnum(
  "drama_drama_class",
  ["drama.drama_class"],
  ["class_1", "class_2", "class_3"],
);

export const DRAMA_BODY_EDIT_POLICY = defineEnum(
  "drama_body_edit_policy",
  ["drama.body_edit_policy"],
  ["undecided", "allowed", "forbidden"],
);

export const DRAMA_PERMIT_PLATFORM = defineEnum(
  "drama_permit_platform",
  ["drama_permit.platform"],
  ["all", "douyin", "wechat_channels"],
);

export const DRAMA_PERMIT_PERMIT_KIND = defineEnum(
  "drama_permit_permit_kind",
  ["drama_permit.permit_kind"],
  ["license_no", "approval_no", "program_no"],
);

export const DRAMA_PERMIT_STATUS = defineEnum(
  "drama_permit_status",
  ["drama_permit.status"],
  ["active", "retired"],
);

export const DRAMA_COPYRIGHT_SOURCE = defineEnum(
  "drama_copyright_source",
  ["drama_copyright.source"],
  ["own", "licensed"],
);

export const DRAMA_COPYRIGHT_REVISION_CHANGE_KIND = defineEnum(
  "drama_copyright_revision_change_kind",
  ["drama_copyright_revision.change_kind"],
  ["initial", "extend", "shorten", "scope_change", "correction"],
);
