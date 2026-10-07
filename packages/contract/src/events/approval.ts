// approval 模块发出的事件的载荷（docs/api/x01-events-jobs.md 第 3.3 节；03 分组 第 2.12 节状态机）。
// 载荷规则见 x01 第 2.3 节 P1–P7：只放 id 与枚举；四个迁移事件另带三个迁移键（P4），由 flow.transition() 补上。
// W2-05 补 approval.sla_breached，区分决定与执行用途。
import { IdSchema, InstantSchema, orNull } from "../common/scalars.js";
import { APPROVAL_KIND, APPROVAL_STATUS } from "../enums/shared.js";
import { zodEnum } from "../enums/zod.js";
import {
  APPROVAL_CATEGORIES,
  APPROVAL_EXECUTION_KINDS,
} from "../routes/a01-system/approvals.schemas.js";
import { z } from "../zod.js";

const subject = {
  approvalRequestId: IdSchema,
  kind: zodEnum(APPROVAL_KIND),
  /** 对象的最终表名 */
  subjectType: z.string().regex(/^[a-z][a-z0-9_]*$/),
  subjectId: IdSchema,
};
const status = zodEnum(APPROVAL_STATUS);

/** approval.submitted：迁移码 submit（03:804） */
export const approvalSubmittedPayload = z.strictObject({
  v: z.literal(1),
  ...subject,
  category: z.enum(APPROVAL_CATEGORIES),
  entityId: orNull(IdSchema),
  storeId: orNull(IdSchema),
  roundNo: z.int().min(1),
  fromState: z.null(),
  toState: z.literal("pending"),
  transition: z.literal("submit"),
});

/** approval.approved：迁移码 approve（03:805） */
export const approvalApprovedPayload = z.strictObject({
  v: z.literal(1),
  ...subject,
  /** 免审批或系统决定 */
  isDecidedBySystem: z.boolean(),
  fromState: status,
  toState: z.literal("approved"),
  transition: z.literal("approve"),
});

/** approval.rejected：迁移码 reject（03:806） */
export const approvalRejectedPayload = z.strictObject({
  v: z.literal(1),
  ...subject,
  /** 字典 reject_reason 的编码 */
  reasonCodes: z.array(z.string().min(1)).max(20),
  isDecidedBySystem: z.boolean(),
  fromState: status,
  toState: z.literal("rejected"),
  transition: z.literal("reject"),
});

/** approval.withdrawn：迁移码 withdraw（03:807） */
export const approvalWithdrawnPayload = z.strictObject({
  v: z.literal(1),
  ...subject,
  fromState: status,
  toState: z.literal("withdrawn"),
  transition: z.literal("withdraw"),
});

/** approval.executed：有执行步的四类在领域行进入 done 时发；审批单停在 approved，不是迁移，没有迁移键 */
export const approvalExecutedPayload = z.strictObject({
  v: z.literal(1),
  approvalRequestId: IdSchema,
  kind: z.enum(APPROVAL_EXECUTION_KINDS),
  /** 领域行的表名 */
  domainType: z.enum(["cancel_request", "refund_request"]),
  domainId: IdSchema,
});

export const approvalSlaBreachedPayload = z.strictObject({
  v: z.literal(1),
  approvalRequestId: IdSchema,
  kind: zodEnum(APPROVAL_KIND),
  purpose: z.enum(["decision", "execution"]),
  dueAt: InstantSchema,
});

export const payloads = {
  "approval.submitted": approvalSubmittedPayload,
  "approval.approved": approvalApprovedPayload,
  "approval.rejected": approvalRejectedPayload,
  "approval.withdrawn": approvalWithdrawnPayload,
  "approval.executed": approvalExecutedPayload,
  "approval.sla_breached": approvalSlaBreachedPayload,
} as const;
