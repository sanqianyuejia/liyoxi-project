// approval 模块：审批单的状态迁移表。
// 每行：分组文档的行（分组:行号）、当前状态（null 是新建）、迁移事件码、新状态（SAME 是不改状态）；文档没写守卫的行尾是 NO_GUARD。
// 改这里的行，要在同一个 PR 改分组文档的那一行：pnpm machines:check 逐行对照。
import { APPROVAL_STATUS } from "@liyoxi/contract/enums";

import { chain, SAME } from "./define.js";

/** approval_request.status：docs/data-model/03-staff-authz-audit.md */
export const approvalRequest = chain("approval_request", "status", APPROVAL_STATUS, [
  ["03:804", null, "submit", ["pending"]],
  ["03:805", ["pending"], "approve", ["approved"]],
  ["03:806", ["pending"], "reject", ["rejected"]],
  ["03:807", ["pending"], "withdraw", ["withdrawn"]],
  ["03:808", ["pending"], "sla.recalculated", SAME],
]);
