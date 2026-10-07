// 审批单状态机的登记（W1-06）：approval_request.status 的四行决定迁移和一行 SLA 同态迁移（03 分组 第 2.12 节状态机表，03:804–808）。
// 守卫的各步（不在审、发起人审批、权限与范围、锁版本、重算前提）有先后与各自的错误码（a03 第 1.1 节），
// 写在 submit.ts、decide.ts 里、迁移之前；登记给 flow 的守卫只认“这次迁移是本模块的函数发起的”：
// 它们发起迁移时随 args 带一张通行证，别处直接调 flow.transition 迁移审批单拿不到，按代码缺陷拒掉。
// 处理器（onApproved、onRejected、onWithdrawn）挂在副作用上：状态与历史已写，审计、事件还没写，同一个事务。
import { chainKey, rowKey } from "../flow/index.js";
import type { Effect, Guard, MachineBinding } from "../flow/index.js";
import type { Tx } from "../kernel/index.js";

import { ApprovalError } from "./errors.js";

/** 随状态在同一条 UPDATE 里写的列：库的 CHECK 把它们与状态绑在一起（ck_approval_request_decision 等） */
export const DECISION_COLUMNS = [
  "decided_at",
  "decided_by_staff_id",
  "is_decided_by_system",
  "decision_note",
  "reason_codes",
  "confirm_checks",
  "checklist_code",
  "checklist_version_no",
  "checklist_result",
  "due_at",
  "sla_snapshot",
] as const;

/** 通行证：本模块发起迁移时放进 args；after 是迁移之后、审计之前要调的处理器 */
export interface TransitionPass {
  readonly after?: (tx: Tx) => Promise<void>;
}

const issued = new WeakSet<object>();

export function issuePass(after?: (tx: Tx) => Promise<void>): TransitionPass {
  const pass: TransitionPass = Object.freeze(after === undefined ? {} : { after });
  issued.add(pass);
  return pass;
}

const passOf = (args: unknown): TransitionPass | undefined =>
  typeof args === "object" && args !== null && issued.has(args)
    ? (args as TransitionPass)
    : undefined;

const guard: Guard = (_tx, facts) => {
  if (passOf(facts.args) === undefined) {
    throw new ApprovalError(
      "bypass",
      `审批单的 ${facts.event} 只经 approval 的业务用例与日历订阅迁移`,
    );
  }
  return Promise.resolve(true);
};

const effect: Effect = async (tx, facts) => {
  await passOf(facts.args)?.after?.(tx);
};

export const APPROVAL_CHAIN = chainKey("approval_request", "status");

export const approvalBinding: MachineBinding = {
  companions: DECISION_COLUMNS,
  guards: {
    [rowKey("03:804", "submit")]: guard,
    [rowKey("03:805", "approve")]: guard,
    [rowKey("03:806", "reject")]: guard,
    [rowKey("03:807", "withdraw")]: guard,
    [rowKey("03:808", "sla.recalculated")]: guard,
  },
  effects: {
    [rowKey("03:805", "approve")]: effect,
    [rowKey("03:806", "reject")]: effect,
    [rowKey("03:807", "withdraw")]: effect,
  },
};
