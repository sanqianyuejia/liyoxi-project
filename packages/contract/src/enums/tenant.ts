// tenant 模块的枚举。取值的中文含义见 docs/data-model/ 下 02 分组文档的第 3 节。
// 一列一个枚举，名字是“表名_列名”；同一模块里几列同组同义的合成一个。跨模块共用的在 shared.ts。
import { defineEnum } from "./define.js";

export const ENTITY_LIFECYCLE = defineEnum(
  "entity_lifecycle",
  ["entity.lifecycle"],
  ["active", "abandoned", "closed"],
);

export const STORE_LIFECYCLE = defineEnum(
  "store_lifecycle",
  ["store.lifecycle"],
  ["active", "archived"],
);

export const STORE_ARCHIVE_REASON = defineEnum(
  "store_archive_reason",
  ["store.archive_reason"],
  ["by_owner", "draft_deleted", "entity_closed", "entity_abandoned"],
);

export const ENTITY_MEMBER_STATUS = defineEnum(
  "entity_member_status",
  ["entity_member.status"],
  ["active", "removed"],
);

export const ENTITY_MEMBER_REMOVE_REASON = defineEnum(
  "entity_member_remove_reason",
  ["entity_member.remove_reason"],
  [
    "by_owner",
    "self",
    "dormant",
    "owner_transfer",
    "account_deleted",
    "draft_abandoned",
    "store_archived",
    "entity_closed",
  ],
);

export const INVITATION_ROLE = defineEnum("invitation_role", ["invitation.role"], ["clerk"]);

export const INVITATION_STATUS = defineEnum(
  "invitation_status",
  ["invitation.status"],
  ["pending", "accepted", "revoked", "expired"],
);

export const INVITATION_REVOKE_REASON = defineEnum(
  "invitation_revoke_reason",
  ["invitation.revoke_reason"],
  ["by_owner", "unshared_leave", "store_archived", "entity_closed"],
);

export const REFERRAL_CODE_SOURCE_TYPE = defineEnum(
  "referral_code_source_type",
  ["referral_code.source_type"],
  ["sales", "campaign", "partner"],
);

export const REFERRAL_CODE_STATUS = defineEnum(
  "referral_code_status",
  ["referral_code.status"],
  ["active", "disabled"],
);
