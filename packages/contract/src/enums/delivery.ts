// delivery 模块的枚举。取值的中文含义见 docs/data-model/ 下 10 分组文档的第 3 节。
// 一列一个枚举，名字是“表名_列名”；同一模块里几列同组同义的合成一个。跨模块共用的在 shared.ts。
import { defineEnum } from "./define.js";

export const DELIVERY_TICKET_STEP = defineEnum(
  "delivery_ticket_step",
  ["delivery_ticket.step"],
  [
    "assigning",
    "plan_confirm",
    "ad_prep",
    "sample_making",
    "sample_confirm",
    "batch_compose",
    "delivering",
    "awaiting_launch",
    "launch_verify",
    "in_service",
    "takedown",
    "archived",
    "terminated",
  ],
);

export const DELIVERY_TICKET_WAITING_ON = defineEnum(
  "delivery_ticket_waiting_on",
  ["delivery_ticket.waiting_on"],
  ["staff", "merchant", "none"],
);

export const DELIVERY_TICKET_STAGE_STEP = defineEnum(
  "delivery_ticket_stage_step",
  ["delivery_ticket_stage.step"],
  [
    "assigning",
    "plan_confirm",
    "ad_prep",
    "sample_making",
    "sample_confirm",
    "batch_compose",
    "delivering",
    "awaiting_launch",
    "launch_verify",
    "in_service",
    "takedown",
  ],
);

export const DELIVERY_TICKET_PAUSE_REASON = defineEnum(
  "delivery_ticket_pause_reason",
  ["delivery_ticket_pause.reason"],
  ["cancel_review", "plan_amendment"],
);

export const DELIVERY_TICKET_PAUSE_REF_TYPE = defineEnum(
  "delivery_ticket_pause_ref_type",
  ["delivery_ticket_pause.ref_type"],
  ["approval_request", "delivery_plan_version"],
);

export const DELIVERY_TICKET_PAUSE_RELEASE_EVENT = defineEnum(
  "delivery_ticket_pause_release_event",
  ["delivery_ticket_pause.release_event"],
  ["rejected", "withdrawn", "voided", "plan_confirmed", "superseded", "terminated", "self_heal"],
);

export const DELIVERY_PLAN_STATUS = defineEnum(
  "delivery_plan_status",
  ["delivery_plan.status"],
  ["drafting", "pending_confirm", "revising", "confirmed"],
);

export const DELIVERY_PLAN_VERSION_DECISION = defineEnum(
  "delivery_plan_version_decision",
  ["delivery_plan_version.decision"],
  ["confirmed", "change_requested", "superseded"],
);

export const SAMPLE_STATUS = defineEnum(
  "sample_status",
  ["sample.status"],
  [
    "uploaded",
    "check_rejected",
    "qc_rejected",
    "qc_passed",
    "pushed",
    "confirmed",
    "change_requested",
    "superseded",
  ],
);

export const SAMPLE_CONFIRM_VIEWED_VIA = defineEnum(
  "sample_confirm_viewed_via",
  ["sample.confirm_viewed_via"],
  ["weapp", "album", "portal", "wecom"],
);

export const SAMPLE_FEEDBACK_KIND = defineEnum(
  "sample_feedback_kind",
  ["sample.feedback_kind"],
  ["compose", "ad_content"],
);

export const EPISODE_OUTPUT_SOURCE = defineEnum(
  "episode_output_source",
  ["episode_output.source"],
  ["manual_upload", "normalized", "sample_adopted", "restamped", "auto_compose"],
);

export const EPISODE_OUTPUT_STATUS = defineEnum(
  "episode_output_status",
  ["episode_output.status"],
  ["uploaded", "check_rejected", "qc_passed", "qc_rejected", "replaced"],
);

export const QC_RECORD_TARGET_TYPE = defineEnum(
  "qc_record_target_type",
  ["qc_record.target_type"],
  ["sample", "episode_output", "delivery_ticket"],
);

export const QC_RECORD_VERDICT = defineEnum(
  "qc_record_verdict",
  ["qc_record.verdict"],
  ["pass", "fail"],
);

export const DELIVERY_RELEASE_KIND = defineEnum(
  "delivery_release_kind",
  ["delivery_release.kind"],
  ["initial", "reissue"],
);

export const DELIVERY_RELEASE_STATE = defineEnum(
  "delivery_release_state",
  ["delivery_release.state"],
  ["pushed", "superseded", "closed"],
);

export const DELIVERY_RELEASE_CHECKLIST_CODE = defineEnum(
  "delivery_release_checklist_code",
  ["delivery_release.checklist_code"],
  ["delivery.precheck"],
);

export const DELIVERY_RELEASE_CLOSE_REASON = defineEnum(
  "delivery_release_close_reason",
  ["delivery_release.close_reason"],
  ["cancelled", "usage_ended"],
);

export const DELIVERY_REISSUE_STATUS = defineEnum(
  "delivery_reissue_status",
  ["delivery_reissue.status"],
  ["open", "published", "cancelled"],
);

export const DOWNLOAD_GRANT_GRANTEE_TYPE = defineEnum(
  "download_grant_grantee_type",
  ["download_grant.grantee_type"],
  ["entity", "partner"],
);

export const DOWNLOAD_GRANT_STATE = defineEnum(
  "download_grant_state",
  ["download_grant.state"],
  ["active", "superseded", "revoked"],
);

export const DELIVERY_DOWNLOAD_LOG_KIND = defineEnum(
  "delivery_download_log_kind",
  ["delivery_download_log.kind"],
  ["episode", "zip", "publish_list"],
);

export const DELIVERY_DOWNLOAD_LOG_ACTOR_TYPE = defineEnum(
  "delivery_download_log_actor_type",
  ["delivery_download_log.actor_type"],
  ["merchant", "staff", "partner"],
);

export const DELIVERY_DOWNLOAD_LOG_CLIENT_ACK = defineEnum(
  "delivery_download_log_client_ack",
  ["delivery_download_log.client_ack"],
  ["saved", "failed"],
);
