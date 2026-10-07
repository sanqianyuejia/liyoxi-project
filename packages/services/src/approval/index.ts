// approval：统一审批单的执行器框架（W1-06，L1）。用法见本目录的 README.md。
// 第一个 PR 交写侧：登记类型、提交、决定、撤回、记执行、三项每日校验。读侧三条接口随第二个 PR。
export { createApproval, approvalKindsOf } from "./runtime.js";
export type { Approval, ApprovalOptions } from "./runtime.js";
export { approvalKindPort, defineApprovalKind } from "./kinds.js";
export type {
  ApprovalDecision,
  ApprovalKindRegistration,
  ApprovalNumberPrefix,
  ApprovalOperations,
  ApprovalRow,
  ApprovalSubmission,
  ApprovalSubmitActorType,
} from "./kinds.js";
export type { SubmitInput, SubmitResult } from "./submit.js";
export type {
  ApproveInput,
  ChecklistResultItem,
  DecisionResult,
  RejectInput,
  WithdrawInput,
} from "./decide.js";
export type { RecordExecutedInput } from "./execute.js";
export { ApprovalError } from "./errors.js";
export type { ApprovalRefusal } from "./errors.js";
export {
  APPROVAL_INVARIANT_LIMIT,
  findI1Violations,
  findI2Violations,
  findI4Violations,
} from "./invariants.js";
export { registration } from "./register.js";
export { createApprovalReads, countTodo } from "./read.js";
export type { ApprovalReads } from "./read.js";

export { bindApprovalSla, onApprovalCalendarImported, handleApprovalSlaBreach } from "./sla.js";
export type { ApprovalSlaBinding } from "./sla.js";
export type { TouchPendingInput } from "./touch.js";

export { findI3Violations, findI5Violations } from "./sla-invariants.js";
