// media 模块的枚举。取值的中文含义见 docs/data-model/ 下 06 分组文档的第 3 节。
// 一列一个枚举，名字是“表名_列名”；同一模块里几列同组同义的合成一个。跨模块共用的在 shared.ts。
import { defineEnum } from "./define.js";

/** 内容安全审核结论 */
export const MODERATION_STATE = defineEnum(
  "moderation_state",
  ["file_object.moderation_state", "store_asset.moderation_state"],
  ["none", "pending", "pass", "review", "block"],
);

/** 上传人、发起人类型；actor_type 去掉 partner */
export const MEDIA_ACTOR_TYPE = defineEnum(
  "media_actor_type",
  ["file_object.upload_actor_type", "ocr_result.request_actor_type"],
  ["merchant", "staff", "system"],
);

export const FILE_OBJECT_BUCKET = defineEnum(
  "file_object_bucket",
  ["file_object.bucket"],
  ["secure", "asset", "media", "pub"],
);

export const FILE_OBJECT_INCOMING_BUCKET = defineEnum(
  "file_object_incoming_bucket",
  ["file_object.incoming_bucket"],
  ["secure", "asset", "media"],
);

export const FILE_OBJECT_CATEGORY = defineEnum(
  "file_object_category",
  ["file_object.category"],
  [
    "kyc_license",
    "kyc_permit",
    "pay_receipt",
    "invoice",
    "legal_doc",
    "seal_image",
    "consent_digest",
    "drama_license_doc",
    "evidence",
    "export",
    "profile_image",
    "profile_video",
    "profile_promo",
    "store_asset",
    "channel_screenshot",
    "ticket_attachment",
    "video_cover",
    "drama_master",
    "trailer_src",
    "ad_video",
    "sample_video",
    "sample_wm",
    "final_episode",
    "package_zip",
    "publish_list",
    "trailer_out",
    "poster",
    "banner",
    "pay_bill",
    "wecom_qr",
    "account_proof",
    "portrait_auth",
  ],
);

export const FILE_OBJECT_SCOPE_TYPE = defineEnum(
  "file_object_scope_type",
  ["file_object.scope_type"],
  ["platform", "entity", "store"],
);

export const FILE_OBJECT_STATUS = defineEnum(
  "file_object_status",
  ["file_object.status"],
  ["pending", "promoting", "stored", "rejected", "expired", "deleting", "deleted"],
);

export const FILE_OBJECT_REJECT_REASON = defineEnum(
  "file_object_reject_reason",
  ["file_object.reject_reason"],
  ["size_mismatch", "bad_magic", "changed_after_confirm", "copy_verify_failed", "stamp_failed"],
);

export const FILE_OBJECT_UPLOAD_MODE = defineEnum(
  "file_object_upload_mode",
  ["file_object.upload_mode"],
  ["post", "multipart", "server"],
);

export const FILE_REF_STATE = defineEnum(
  "file_ref_state",
  ["file_ref.state"],
  ["live", "released"],
);

export const FILE_PURGE_RUN_MODE = defineEnum(
  "file_purge_run_mode",
  ["file_purge_run.mode"],
  ["list_only", "auto"],
);

export const FILE_PURGE_RUN_STATE = defineEnum(
  "file_purge_run_state",
  ["file_purge_run.state"],
  ["proposed", "held", "approved", "running", "done", "aborted", "rejected"],
);

export const MEDIA_INFO_KIND = defineEnum(
  "media_info_kind",
  ["media_info.kind"],
  ["video", "audio", "image"],
);

export const MEDIA_CHECK_PROFILE = defineEnum(
  "media_check_profile",
  ["media_check.profile"],
  ["master", "trailer_src", "ad", "sample", "final", "asset"],
);

export const MEDIA_CHECK_GATE = defineEnum(
  "media_check_gate",
  ["media_check.gate"],
  ["pass", "reject"],
);

/** 原片替换原因 */
export const MASTER_REPLACE_REASON = defineEnum(
  "master_replace_reason",
  ["upload_batch.replace_reason", "drama_episode_master.replace_reason"],
  ["quality_fix", "license_info_fix", "other"],
);

export const UPLOAD_BATCH_PURPOSE = defineEnum(
  "upload_batch_purpose",
  ["upload_batch.purpose"],
  ["drama_master", "final_release"],
);

export const UPLOAD_BATCH_STATE = defineEnum(
  "upload_batch_state",
  ["upload_batch.state"],
  ["matching", "uploading", "verifying", "ready", "committed", "canceled", "expired"],
);

export const UPLOAD_BATCH_SCOPE = defineEnum(
  "upload_batch_scope",
  ["upload_batch.scope"],
  ["full", "partial"],
);

export const UPLOAD_BATCH_ITEM_MATCH_METHOD = defineEnum(
  "upload_batch_item_match_method",
  ["upload_batch_item.match_method"],
  ["pattern", "sequence", "manual"],
);

export const UPLOAD_BATCH_ITEM_STATE = defineEnum(
  "upload_batch_item_state",
  ["upload_batch_item.state"],
  ["pending", "uploaded", "checked", "rejected", "skipped", "replaced"],
);

export const MEDIA_JOB_KIND = defineEnum(
  "media_job_kind",
  ["media_job.kind"],
  [
    "promote",
    "probe",
    "restamp",
    "transcode_mp4",
    "watermark_sample",
    "normalize",
    "zip_package",
    "audit_image",
    "audit_image_wx",
    "audit_video",
    "audit_text",
    "asr",
    "vision",
    "doc_extract",
    "digest",
    "ocr",
  ],
);

export const MEDIA_JOB_MODE = defineEnum("media_job_mode", ["media_job.mode"], ["local", "remote"]);

export const MEDIA_JOB_SUBJECT_TYPE = defineEnum(
  "media_job_subject_type",
  ["media_job.subject_type"],
  ["file_object", "zip_bundle", "store_asset", "ocr_result"],
);

export const MEDIA_JOB_PARENT_TYPE = defineEnum(
  "media_job_parent_type",
  ["media_job.parent_type"],
  ["store_asset", "playable_asset", "upload_batch", "production_record", "zip_bundle"],
);

export const MEDIA_JOB_STATE = defineEnum(
  "media_job_state",
  ["media_job.state"],
  ["queued", "running", "submitting", "submitted", "succeeded", "failed", "canceled"],
);

export const PRODUCTION_RECORD_KIND = defineEnum(
  "production_record_kind",
  ["production_record.kind"],
  ["sample", "final", "ad"],
);

export const PRODUCTION_RECORD_SOURCE = defineEnum(
  "production_record_source",
  ["production_record.source"],
  ["manual_upload", "normalized", "restamped", "render", "ai_assisted"],
);

export const PRODUCTION_RECORD_MASTER_SOURCE = defineEnum(
  "production_record_master_source",
  ["production_record.master_source"],
  ["checkout", "declared", "current_fallback"],
);

export const PRODUCTION_RECORD_AIGC_STATE = defineEnum(
  "production_record_aigc_state",
  ["production_record.aigc_state"],
  ["not_required", "pending", "verified", "failed"],
);

export const PRODUCTION_RECORD_AIGC_ORIGIN = defineEnum(
  "production_record_aigc_origin",
  ["production_record.aigc_origin"],
  ["upstream", "stamped"],
);

export const PRODUCTION_RECORD_PIPELINE_STATE = defineEnum(
  "production_record_pipeline_state",
  ["production_record.pipeline_state"],
  ["uploading", "checking", "ready", "rejected"],
);

export const PLAYABLE_ASSET_KIND = defineEnum(
  "playable_asset_kind",
  ["playable_asset.kind"],
  ["trailer", "sample", "ad"],
);

export const PLAYABLE_ASSET_OWNER_TYPE = defineEnum(
  "playable_asset_owner_type",
  ["playable_asset.owner_type"],
  ["drama", "order_item", "ad"],
);

export const PLAYABLE_ASSET_STATE = defineEnum(
  "playable_asset_state",
  ["playable_asset.state"],
  ["processing", "ready", "failed", "retired"],
);

export const ZIP_BUNDLE_OWNER_TYPE = defineEnum(
  "zip_bundle_owner_type",
  ["zip_bundle.owner_type"],
  ["delivery_release"],
);

export const ZIP_BUNDLE_ZIP_STATE = defineEnum(
  "zip_bundle_zip_state",
  ["zip_bundle.zip_state"],
  ["none", "building", "ready", "failed"],
);

export const DRAMA_EPISODE_MASTER_STATE = defineEnum(
  "drama_episode_master_state",
  ["drama_episode_master.state"],
  ["ready", "superseded"],
);

export const STORE_ASSET_TYPE = defineEnum(
  "store_asset_type",
  ["store_asset.type"],
  ["image", "video", "recording", "audio", "document", "text"],
);

export const STORE_ASSET_UPLOAD_ACTOR_TYPE = defineEnum(
  "store_asset_upload_actor_type",
  ["store_asset.upload_actor_type"],
  ["merchant", "staff"],
);

export const STORE_ASSET_PROCESSING_STATE = defineEnum(
  "store_asset_processing_state",
  ["store_asset.processing_state"],
  ["pending", "processing", "processed"],
);

export const STORE_ASSET_REVIEW_STATE = defineEnum(
  "store_asset_review_state",
  ["store_asset.review_state"],
  ["unreviewed", "reviewed"],
);

export const STORE_ASSET_USABILITY = defineEnum(
  "store_asset_usability",
  ["store_asset.usability"],
  ["ready", "reference_only", "need_reshoot", "need_portrait_auth"],
);

export const STORE_ASSET_INSIGHT_KIND = defineEnum(
  "store_asset_insight_kind",
  ["store_asset_insight.kind"],
  ["transcript", "vision", "doc_text", "structured_items", "digest", "tech_spec"],
);

export const STORE_ASSET_INSIGHT_STATUS = defineEnum(
  "store_asset_insight_status",
  ["store_asset_insight.status"],
  ["ok", "skipped", "failed"],
);

export const STORE_ASSET_TAG_DIMENSION = defineEnum(
  "store_asset_tag_dimension",
  ["store_asset_tag.dimension"],
  ["content", "usage", "timeliness"],
);

export const STORE_ASSET_TAG_SOURCE = defineEnum(
  "store_asset_tag_source",
  ["store_asset_tag.source"],
  ["auto", "uploader", "reviewer"],
);

export const STORE_ASSET_USAGE_USED_BY_TYPE = defineEnum(
  "store_asset_usage_used_by_type",
  ["store_asset_usage.used_by_type"],
  ["ad", "drama_order", "order_item", "ad_version", "episode_output"],
);

export const STORE_ASSET_USAGE_ROLE = defineEnum(
  "store_asset_usage_role",
  ["store_asset_usage.role"],
  ["reference", "adopted"],
);

export const STORE_ASSET_DEMAND_NOTIFY_SCOPE = defineEnum(
  "store_asset_demand_notify_scope",
  ["store_asset_demand.notify_scope"],
  ["owner_and_clerks", "owner_only"],
);

export const STORE_ASSET_DEMAND_STATUS = defineEnum(
  "store_asset_demand_status",
  ["store_asset_demand.status"],
  ["open", "done", "canceled"],
);

export const OCR_RESULT_DOC_TYPE = defineEnum(
  "ocr_result_doc_type",
  ["ocr_result.doc_type"],
  ["business_license", "industry_permit", "bank_receipt"],
);

export const OCR_RESULT_STATUS = defineEnum(
  "ocr_result_status",
  ["ocr_result.status"],
  ["pending", "ok", "unavailable", "unreadable"],
);
