// approval.approve、reject、withdraw（W1-06）：决定与撤回。领域用例开事务后先调进来，再锁自己的行。
// 依据：03 分组 第 2.12 节（状态机、撤回的三种来源、系统决定）；a03 第 1.1 节“审批决定的守卫顺序”；D4 第 7.6 节；约定 C67。
//
// 加锁：员工行 FOR SHARE（20）→ 审批单（30）→ 领域行（处理器自己锁）。
// 守卫的先后（各自的错误码）：
//   不是 pending → 409 APPROVAL_NOT_PENDING
//   审批人是发起人 → 403 APPROVAL_SELF_FORBIDDEN（超级管理员也不例外；库里另有 CHECK）
//   决定权限点、“仅主管”与发起人所在组、对象在数据范围内 → 403 PERMISSION_DENIED
//   通过时 lockVersion 不符 → 409 VERSION_CONFLICT（驳回不校验）
//   revalidate 认为前提已变 → 409 PRECONDITION_CHANGED，调用方的事务回滚，审批单保持 pending
// 再验证、confirm 回显、路由级的模块等级不在这里：由路由侧与各领域接口做。
// 系统决定（免审批、同信用代码自动驳回、对象失效代撤）：不查权限与发起人，is_decided_by_system = true。
import { hasPermission } from "../authz/index.js";
import type { StaffContext } from "../authz/index.js";
import type { EmitContext } from "../events/index.js";
import { AppError, lockRows } from "../kernel/index.js";
import type { Tx } from "../kernel/index.js";

import { cancelDecisionTimer } from "./sla.js";

import { auditOf, loadApproval, operatorOf } from "./context.js";
import type { ApprovalDeps, AuditOverride, Operator } from "./context.js";
import { ApprovalError } from "./errors.js";
import type { ApprovalDecision, ApprovalKindRegistration, ApprovalRow } from "./kinds.js";
import { issuePass } from "./machine.js";
import {
  findApproval,
  inScope,
  isActiveChecklist,
  staffFactsOf,
  unknownReasonCodes,
} from "./repo.js";
import type { StaffFacts } from "./repo.js";

/** 清单结论的一条（03 分组 第 4 节 checklist_result）：fail 必有说明 */
export interface ChecklistResultItem {
  readonly key: string;
  readonly result: "pass" | "fail" | "na";
  readonly note?: string;
}

interface DecideBase extends AuditOverride {
  readonly approvalId: string;
  /** 员工操作时必给：这名员工的上下文（生效的权限点、数据范围）。系统动作、商家撤回不给 */
  readonly staff?: StaffContext;
  /** 决定说明或撤回说明 */
  readonly note?: string | null;
  /** 随决定传给处理器（revalidate 与三个回调）的东西，本模块不看 */
  readonly args?: unknown;
}

export interface ApproveInput extends DecideBase {
  /** 审批人看到的锁版本：员工通过时必给；系统决定可以不给 */
  readonly lockVersion?: number;
  /** 界面上勾选的核对项 */
  readonly confirmChecks?: readonly string[];
  /** 审核所用的清单与结论：模板须是当前启用的那一版 */
  readonly checklist?: {
    readonly code: string;
    readonly versionNo: number;
    readonly result: readonly ChecklistResultItem[];
  };
}

export interface RejectInput extends DecideBase {
  /** 驳回说明必填 */
  readonly note: string;
  /** 字典 reject_reason 的编码；审核类由员工驳回时至少 1 项 */
  readonly reasonCodes?: readonly string[];
}

export type WithdrawInput = DecideBase;

export interface DecisionResult {
  readonly approvalId: string;
  readonly status: "approved" | "rejected" | "withdrawn";
  /** 迁移之后的锁版本 */
  readonly lockVersion: number;
  readonly decidedAt: Date;
}

const invalid = (message: string): AppError => new AppError("VALIDATION_FAILED", { message });
const clean = (note: string | null | undefined): string | null => {
  const text = note?.trim() ?? "";
  return text === "" ? null : text;
};

interface Locked {
  readonly row: ApprovalRow;
  readonly kind: ApprovalKindRegistration;
  /** 加了共享锁的员工行：操作的员工与发起员工 */
  readonly staffRows: ReadonlyMap<string, StaffFacts>;
}

/**
 * 20 → 30：先锁员工行，再锁审批单，锁住之后重读。发起员工的 id 提交后不变，可以先不加锁读出来。
 * 员工行只在员工操作时锁（撤回另锁发起员工：代撤要看他是否还在职）；系统动作、商家撤回不锁员工行，
 * 所以归属模块可以先锁审批单、再锁自己的行，最后才以系统身份调进来。
 * 本事务里刚提交的那一张不用锁（别的事务看不见它）：提交后同一事务里的免审批通过因此不受锁序限制。
 */
async function lockForDecision(
  tx: Tx,
  deps: ApprovalDeps,
  approvalId: string,
  operator: Operator,
  withRequester: boolean,
): Promise<Locked> {
  const first = await loadApproval(tx, deps, approvalId);
  const staffIds: string[] = [];
  if (operator.type === "staff") {
    staffIds.push(operator.staff.staff.id);
    const requester = first.row.requesterStaffId;
    if (withRequester && requester !== null && requester !== operator.staff.staff.id) {
      staffIds.push(requester);
    }
  }
  if (staffIds.length > 0) await lockRows(tx, "staff", staffIds, "share");
  const staffRows = await staffFactsOf(tx, staffIds);
  if (deps.fresh.get(tx)?.has(approvalId) !== true) {
    await lockRows(tx, "approval_request", [approvalId], "update");
  }
  const row = await findApproval(tx, approvalId);
  if (row === null) throw new AppError("NOT_FOUND");
  return { row, kind: first.kind, staffRows };
}

function assertPending(row: ApprovalRow): void {
  if (row.status !== "pending") {
    throw new AppError("APPROVAL_NOT_PENDING", {
      details: { status: row.status, decidedAt: row.decidedAt?.toISOString() ?? null },
    });
  }
}

/**
 * 这名员工能不能决定这一张（D4 第 7.6 节 assertDecision 的第 3 步）：
 * 启用状态；持决定权限点（“仅主管”已算在里面）；绑定发起人所在组的类型要是那一组的主管，超级管理员兜底；
 * 对象在数据范围内（角色队列不套范围）。员工是否启用、是否主管、所在组取锁住的那一行，不取上下文里的旧值。
 */
async function isEligible(tx: Tx, staff: StaffContext, locked: Locked): Promise<boolean> {
  const { row, kind } = locked;
  const self = locked.staffRows.get(staff.staff.id);
  if (self?.status !== "active" || !hasPermission(staff, kind.decidePermission)) return false;
  if (kind.groupBound && staff.staff.roleKey !== "super_admin") {
    const sameGroup = self.staffGroupId !== null && self.staffGroupId === row.requesterStaffGroupId;
    if (!self.isLead || !sameGroup) return false;
  }
  return kind.roleQueue === true || inScope(tx, staff.scope, row, kind);
}

async function assertMayDecide(tx: Tx, operator: Operator, locked: Locked): Promise<void> {
  if (operator.type === "merchant") throw new ApprovalError("actor", "商家不能决定审批单");
  assertPending(locked.row);
  if (operator.type === "system") return;
  const { id } = operator.staff.staff;
  if (id === locked.row.requesterStaffId || id === locked.row.submitActorId) {
    throw new AppError("APPROVAL_SELF_FORBIDDEN");
  }
  if (!(await isEligible(tx, operator.staff, locked))) throw new AppError("PERMISSION_DENIED");
}

interface Outcome {
  readonly event: "approve" | "reject" | "withdraw";
  readonly to: DecisionResult["status"];
  readonly emit: "approval.approved" | "approval.rejected" | "approval.withdrawn";
  readonly decision: ApprovalDecision;
  readonly confirmChecks?: readonly string[];
  readonly checklist?: ApproveInput["checklist"];
  readonly onBehalf?: boolean;
}

/** 迁移 → 处理器 → 审计 → 事件，全在调用方的事务里；每次迁移恰一行状态历史、一行审计、一条事件 */
async function settle(
  tx: Tx,
  deps: ApprovalDeps,
  ctx: EmitContext,
  locked: Locked,
  input: DecideBase,
  outcome: Outcome,
): Promise<DecisionResult> {
  const { row, kind } = locked;
  const { decision, event, to } = outcome;
  const decided: ApprovalRow = {
    ...row,
    status: to,
    decidedAt: decision.decidedAt,
    decidedByStaffId: decision.decidedByStaffId,
    isDecidedBySystem: decision.isDecidedBySystem,
    decisionNote: decision.note,
    reasonCodes: decision.reasonCodes,
    lockVersion: row.lockVersion + 1,
  };
  const callback = {
    approve: kind.onApproved,
    reject: kind.onRejected,
    withdraw: kind.onWithdrawn,
  };
  const subject = {
    v: 1 as const,
    approvalRequestId: row.id,
    kind: row.kind,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
  };
  const system = { isDecidedBySystem: decision.isDecidedBySystem };
  const reasonCode = decision.reasonCodes[0];
  if (deps.sla !== undefined) await cancelDecisionTimer(tx, deps.sla.timers, row.id);
  await deps.flow.transition(tx, ctx, {
    machine: "approval_request",
    stateField: "status",
    id: row.id,
    event,
    set: {
      decided_at: decision.decidedAt,
      decided_by_staff_id: decision.decidedByStaffId,
      is_decided_by_system: decision.isDecidedBySystem,
      decision_note: decision.note,
      ...(event === "reject" ? { reason_codes: [...decision.reasonCodes] } : {}),
      ...(outcome.confirmChecks === undefined
        ? {}
        : { confirm_checks: [...outcome.confirmChecks] }),
      ...(outcome.checklist === undefined
        ? {}
        : {
            checklist_code: outcome.checklist.code,
            checklist_version_no: outcome.checklist.versionNo,
            checklist_result: outcome.checklist.result,
          }),
    },
    reasonCode: reasonCode ?? null,
    note: decision.note,
    entityId: row.entityId,
    storeId: row.storeId,
    audit: auditOf(event, row, to, {
      ...input,
      // 原因编码取第一项；只写了说明、没选原因的记 unspecified（审计的原因说明要挂在一个编码上）
      ...(reasonCode === undefined && decision.note === null
        ? {}
        : { reason: { code: reasonCode ?? "unspecified", text: decision.note } }),
      ...(outcome.onBehalf === undefined ? {} : { onBehalf: outcome.onBehalf }),
    }),
    ...(input.meta === undefined ? {} : { meta: input.meta }),
    emit:
      outcome.emit === "approval.approved"
        ? { type: outcome.emit, payload: { ...subject, ...system } }
        : outcome.emit === "approval.rejected"
          ? {
              type: outcome.emit,
              payload: { ...subject, ...system, reasonCodes: [...decision.reasonCodes] },
            }
          : { type: outcome.emit, payload: subject },
    args: issuePass((handle) => callback[event](handle, decided, decision)),
  });
  return {
    approvalId: row.id,
    status: to,
    lockVersion: decided.lockVersion,
    decidedAt: decision.decidedAt,
  };
}

const decisionOf = (
  deps: ApprovalDeps,
  operator: Operator,
  input: DecideBase,
  extra: { note: string | null; reasonCodes?: readonly string[]; decider: boolean },
): ApprovalDecision => ({
  decidedByStaffId: extra.decider && operator.type === "staff" ? operator.staff.staff.id : null,
  isDecidedBySystem: operator.type === "system",
  decidedAt: deps.clock.now(),
  note: extra.note,
  reasonCodes: extra.reasonCodes ?? [],
  args: input.args,
});

export async function approve(
  tx: Tx,
  deps: ApprovalDeps,
  ctx: EmitContext,
  input: ApproveInput,
): Promise<DecisionResult> {
  const operator = operatorOf(ctx, input.staff);
  const locked = await lockForDecision(tx, deps, input.approvalId, operator, false);
  await assertMayDecide(tx, operator, locked);
  const { row, kind } = locked;
  if (operator.type === "staff" && input.lockVersion === undefined) {
    throw new ApprovalError("actor", "员工通过审批单要带 lockVersion（约定 C53）");
  }
  if (input.lockVersion !== undefined && input.lockVersion !== row.lockVersion) {
    throw new AppError("VERSION_CONFLICT", { details: { lockVersion: row.lockVersion } });
  }
  const { checklist } = input;
  if (checklist !== undefined) {
    if (checklist.result.some((item) => item.result === "fail" && clean(item.note) === null)) {
      throw invalid("清单里不通过的条目要写说明");
    }
    // 审批人打开页面之后清单换了版本：照旧结论通过没有意义，让他刷新
    if (!(await isActiveChecklist(tx, checklist.code, checklist.versionNo))) {
      throw new AppError("PRECONDITION_CHANGED", { message: "审核清单已更新，请刷新后重新核对" });
    }
  }
  await kind.revalidate(tx, row, input.args);
  return settle(tx, deps, ctx, locked, input, {
    event: "approve",
    to: "approved",
    emit: "approval.approved",
    decision: decisionOf(deps, operator, input, { note: clean(input.note), decider: true }),
    ...(input.confirmChecks === undefined ? {} : { confirmChecks: input.confirmChecks }),
    ...(checklist === undefined ? {} : { checklist }),
  });
}

export async function reject(
  tx: Tx,
  deps: ApprovalDeps,
  ctx: EmitContext,
  input: RejectInput,
): Promise<DecisionResult> {
  const operator = operatorOf(ctx, input.staff);
  const locked = await lockForDecision(tx, deps, input.approvalId, operator, false);
  await assertMayDecide(tx, operator, locked);
  const note = clean(input.note);
  if (note === null) throw invalid("驳回要写说明");
  const reasonCodes = [...new Set(input.reasonCodes ?? [])];
  if (locked.row.category === "review" && operator.type === "staff" && reasonCodes.length === 0) {
    throw invalid("驳回审核至少选一项原因");
  }
  const unknown = await unknownReasonCodes(tx, reasonCodes);
  if (unknown.length > 0) throw invalid(`驳回原因 ${unknown.join("、")} 不在字典里或已停用`);
  return settle(tx, deps, ctx, locked, input, {
    event: "reject",
    to: "rejected",
    emit: "approval.rejected",
    decision: decisionOf(deps, operator, input, { note, reasonCodes, decider: true }),
  });
}

/**
 * 撤回的三种来源（03 分组 第 2.12 节）：提交人本人；发起人已不是启用状态时由能决定这一张的员工代撤；
 * 对象失效时归属模块以 system 调。其余 403 APPROVAL_WITHDRAW_FORBIDDEN。
 */
export async function withdraw(
  tx: Tx,
  deps: ApprovalDeps,
  ctx: EmitContext,
  input: WithdrawInput,
): Promise<DecisionResult> {
  const operator = operatorOf(ctx, input.staff);
  const locked = await lockForDecision(tx, deps, input.approvalId, operator, true);
  const { row } = locked;
  assertPending(row);
  let onBehalf = false;
  if (operator.type === "merchant") {
    if (row.submitActorType !== "merchant" || row.submitActorId !== operator.id) {
      throw new AppError("APPROVAL_WITHDRAW_FORBIDDEN");
    }
  } else if (operator.type === "staff" && operator.staff.staff.id !== row.requesterStaffId) {
    const requester =
      row.requesterStaffId === null ? undefined : locked.staffRows.get(row.requesterStaffId);
    onBehalf =
      requester !== undefined &&
      requester.status !== "active" &&
      (await isEligible(tx, operator.staff, locked));
    if (!onBehalf) throw new AppError("APPROVAL_WITHDRAW_FORBIDDEN");
  }
  return settle(tx, deps, ctx, locked, input, {
    event: "withdraw",
    to: "withdrawn",
    emit: "approval.withdrawn",
    decision: decisionOf(deps, operator, input, { note: clean(input.note), decider: false }),
    onBehalf,
  });
}
