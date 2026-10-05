// profile 模块的枚举。取值的中文含义见 docs/data-model/ 下 04 分组文档的第 3 节。
// 一列一个枚举，名字是“表名_列名”；同一模块里几列同组同义的合成一个。跨模块共用的在 shared.ts。
import { defineEnum } from "./define.js";

export const STORE_PROFILE_CONTACT_PHONE_SOURCE = defineEnum(
  "store_profile_contact_phone_source",
  ["store_profile.contact_phone_source"],
  ["login", "sms_verified", "unverified"],
);

export const STORE_PROFILE_MEDIA_MEDIA_GROUP = defineEnum(
  "store_profile_media_media_group",
  ["store_profile_media.media_group"],
  ["door", "interior", "product", "promo"],
);

export const STORE_PROFILE_MEDIA_MEDIA_KIND = defineEnum(
  "store_profile_media_media_kind",
  ["store_profile_media.media_kind"],
  ["image", "video"],
);

export const QUALIFICATION_SUBMISSION_KIND = defineEnum(
  "qualification_submission_kind",
  ["qualification_submission.kind"],
  ["initial", "new_store", "change"],
);

export const QUALIFICATION_SUBMISSION_OUTCOME = defineEnum(
  "qualification_submission_outcome",
  ["qualification_submission.outcome"],
  ["approved", "rejected", "withdrawn", "discarded"],
);

export const QUALIFICATION_SUBMISSION_APPROVE_MODE = defineEnum(
  "qualification_submission_approve_mode",
  ["qualification_submission.approve_mode"],
  ["normal", "corrected", "override"],
);

export const QUALIFICATION_SUBMISSION_SYSTEM_REJECT_CODE = defineEnum(
  "qualification_submission_system_reject_code",
  ["qualification_submission.system_reject_code"],
  ["duplicate_entity"],
);

export const QUALIFICATION_DOC_DOC_TYPE = defineEnum(
  "qualification_doc_doc_type",
  ["qualification_doc.doc_type"],
  ["business_license", "branch_license", "industry_permit"],
);

export const QUALIFICATION_DOC_SCOPE = defineEnum(
  "qualification_doc_scope",
  ["qualification_doc.scope"],
  ["entity", "store"],
);

export const QUALIFICATION_DOC_ORIGIN = defineEnum(
  "qualification_doc_origin",
  ["qualification_doc.origin"],
  ["uploaded", "carried"],
);

export const QUALIFICATION_DOC_PRINCIPAL_ROLE = defineEnum(
  "qualification_doc_principal_role",
  ["qualification_doc.principal_role"],
  ["legal_rep", "operator", "branch_head"],
);

export const QUALIFICATION_DOC_SUBJECT_TYPE = defineEnum(
  "qualification_doc_subject_type",
  ["qualification_doc.subject_type"],
  ["enterprise", "individual", "branch", "unknown"],
);

export const QUALIFICATION_DOC_VERDICT = defineEnum(
  "qualification_doc_verdict",
  ["qualification_doc.verdict"],
  ["accepted", "rejected"],
);
