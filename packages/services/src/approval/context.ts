// 写函数共用的依赖与小工具（W1-06）：按 kind 取登记、认操作人、审计的缺省内容。
import type { ApprovalKind } from "@liyoxi/contract";

import type { AuditEntry, AuditRequestMeta } from "../audit/index.js";
import type { StaffContext } from "../authz/index.js";
import type { EmitContext, Events } from "../events/index.js";
import type { Flow } from "../flow/index.js";
import { AppError } from "../kernel/index.js";
import type { BizNoIssuer, Clock, Tx } from "../kernel/index.js";

import type { ApprovalSlaBinding } from "./sla.js";

import { ApprovalError } from "./errors.js";
import type { ApprovalKindRegistration, ApprovalRow } from "./kinds.js";
import { findApproval } from "./repo.js";

export interface ApprovalDeps {
  /** 业务时钟：提交时间、决定时间取它 */
  readonly clock: Clock;
  readonly flow: Pick<Flow, "transition">;
  readonly events: Pick<Events, "emit">;
  readonly bizNo: Pick<BizNoIssuer, "next">;
  /** 已校验过的登记，键是 kind */
  readonly kinds: ReadonlyMap<string, ApprovalKindRegistration>;
  /** 各事务里刚提交的审批单：同一事务里对它的决定不再加锁（别的事务看不见它） */
  readonly fresh: WeakMap<Tx, Set<string>>;
  readonly sla?: ApprovalSlaBinding;
}

/** 四个写函数都收的两样：领域用例自己的审计内容（给了即以它为准，本模块不再补第二行）、请求元信息 */
export interface AuditOverride {
  readonly audit?: AuditEntry;
  readonly meta?: AuditRequestMeta;
}

export function kindOf(deps: ApprovalDeps, kind: string): ApprovalKindRegistration {
  const registration = deps.kinds.get(kind);
  if (registration === undefined) {
    throw new ApprovalError(
      "unregistered",
      `审批类型 ${JSON.stringify(kind)} 还没有模块登记处理器`,
    );
  }
  return registration;
}

/** 取审批单与它的登记；没有这一张即 404 */
export async function loadApproval(
  tx: Tx,
  deps: ApprovalDeps,
  approvalId: string,
): Promise<{ row: ApprovalRow; kind: ApprovalKindRegistration }> {
  const row = await findApproval(tx, approvalId);
  if (row === null) throw new AppError("NOT_FOUND");
  return { row, kind: kindOf(deps, row.kind) };
}

export type Operator =
  | { readonly type: "system" }
  | { readonly type: "staff"; readonly staff: StaffContext }
  | { readonly type: "merchant"; readonly id: string };

/**
 * 认操作人：身份上下文说是谁，员工另要这名员工的上下文（权限点与数据范围）。两边对不上是代码缺陷。
 * 没有请求上下文的地方（演示种子、用例）照样能调：身份上下文与员工上下文都由调用方给。
 */
export function operatorOf(ctx: EmitContext, staff: StaffContext | undefined): Operator {
  const { actor } = ctx;
  if (actor.type === "system") {
    if (staff !== undefined) throw new ApprovalError("actor", "系统动作不带员工上下文");
    return { type: "system" };
  }
  if (actor.type === "staff") {
    if (staff?.staff.id !== actor.id) {
      throw new ApprovalError("actor", "员工操作要给这名员工自己的员工上下文（staff）");
    }
    return { type: "staff", staff };
  }
  if (actor.type === "merchant" && staff === undefined) return { type: "merchant", id: actor.id };
  throw new ApprovalError("actor", `操作人类型 ${actor.type} 不能操作审批单，或多给了员工上下文`);
}

const VERBS = { submit: "提交", approve: "通过", reject: "驳回", withdraw: "撤回" } as const;
export type ApprovalEvent = keyof typeof VERBS;

type Described = Pick<
  ApprovalRow,
  "id" | "kind" | "category" | "requestNo" | "summary" | "entityId" | "storeId"
>;

/**
 * 每次迁移恰一行审计（a03 第 1.1 节“留痕”）：审核类写 activity 流、类别 review；员工发起的审批写 ops 流、类别 approval。
 * 领域用例传了审计内容就用它的，这里的缺省不再写。
 */
export function auditOf(
  event: ApprovalEvent,
  row: Described,
  to: string,
  options: AuditOverride & { reason?: { code: string; text?: string | null }; onBehalf?: boolean },
): AuditEntry {
  if (options.audit !== undefined) return options.audit;
  const review = row.category === "review";
  const verb = options.onBehalf === true ? "代为撤回" : VERBS[event];
  const entry = {
    stream: review ? "activity" : "ops",
    category: review ? "review" : "approval",
    action: `approval.request.${event}`,
    summary: `${verb}${review ? "审核" : "审批"}：${row.summary.title}`,
    target: { type: "approval_request", id: row.id, label: row.requestNo ?? row.summary.title },
    ...(options.reason === undefined ? {} : { reason: options.reason }),
    meta: {
      approvalStatus: to,
      approvalKind: row.kind satisfies ApprovalKind,
      ...(row.requestNo === null ? {} : { requestNo: row.requestNo }),
    },
  } as const;
  return row.entityId === null ? entry : { ...entry, entityId: row.entityId, storeId: row.storeId };
}
