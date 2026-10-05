// docs 模块的枚举。取值的中文含义见 docs/data-model/ 下 13 分组文档的第 3 节。
// 一列一个枚举，名字是“表名_列名”；同一模块里几列同组同义的合成一个。跨模块共用的在 shared.ts。
import { defineEnum } from "./define.js";

export const AGREEMENT_SUBJECT_KIND = defineEnum(
  "agreement_subject_kind",
  ["agreement.subject_kind"],
  ["user", "entity", "partner"],
);

export const AGREEMENT_CONSENT_MODE = defineEnum(
  "agreement_consent_mode",
  ["agreement.consent_mode"],
  ["checkbox", "by_action", "esign"],
);

export const AGREEMENT_SINCE_VERSION = defineEnum(
  "agreement_since_version",
  ["agreement.since_version"],
  ["V1.0", "V1.1"],
);

export const AGREEMENT_VERSION_STATUS = defineEnum(
  "agreement_version_status",
  ["agreement_version.status"],
  ["draft", "pending", "active", "superseded", "withdrawn"],
);

export const AGREEMENT_CONSENT_SCENE = defineEnum(
  "agreement_consent_scene",
  ["agreement_consent.scene"],
  ["login", "reconsent", "member_join", "plan_purchase", "topup", "order_submit", "ad_request"],
);

export const AGREEMENT_CONSENT_BIZ_TYPE = defineEnum(
  "agreement_consent_biz_type",
  ["agreement_consent.biz_type"],
  ["billing_order", "drama_order", "ad"],
);

export const AGREEMENT_CONSENT_METHOD = defineEnum(
  "agreement_consent_method",
  ["agreement_consent.method"],
  ["checkbox", "by_action", "prior_consent"],
);

export const LICENSE_LETTER_STATUS = defineEnum(
  "license_letter_status",
  ["license_letter.status"],
  ["pending_effective", "effective", "voided"],
);

export const LICENSE_LETTER_VOID_REASON = defineEnum(
  "license_letter_void_reason",
  ["license_letter.void_reason"],
  ["cancelled", "terminated", "account_removed", "manual"],
);

export const LICENSE_LETTER_REVISION_REASON = defineEnum(
  "license_letter_revision_reason",
  ["license_letter_revision.reason"],
  ["initial", "go_live", "period_changed", "correction", "resign"],
);

export const LICENSE_LETTER_REVISION_RENDER_STATUS = defineEnum(
  "license_letter_revision_render_status",
  ["license_letter_revision.render_status"],
  ["queued", "rendering", "ready", "failed"],
);

export const LICENSE_LETTER_REVISION_SIGN_MODE = defineEnum(
  "license_letter_revision_sign_mode",
  ["license_letter_revision.sign_mode"],
  ["platform_cert", "esign_seal", "stamp"],
);
