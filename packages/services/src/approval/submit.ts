// approval.submit（W1-06）：领域用例在自己的事务里调。依据：03 分组 第 2.12 节、第 3.2 节；x01 第 3.3 节。
//   查登记 → 锁发起员工（共享，20）→ validate → 生成摘要并校验 → 查在途 → 取号 → 插行 → 迁移到 pending（历史、审计、事件）
// 第一个参数是事务句柄，本模块不开事务。提交权限由领域接口自己判（各类型的发起权限点不同），这里不查。
import { ApprovalSummarySchema } from "@liyoxi/contract";
import type { ApprovalKind } from "@liyoxi/contract";

import type { EmitContext } from "../events/index.js";
import { AppError, lockRows, uuidv7 } from "../kernel/index.js";
import type { Tx } from "../kernel/index.js";

import { computeDecisionSla, armDecisionTimer } from "./sla.js";

import { auditOf, kindOf } from "./context.js";
import type { ApprovalDeps, AuditOverride } from "./context.js";
import { ApprovalError } from "./errors.js";
import type { ApprovalSubmission } from "./kinds.js";
import { issuePass } from "./machine.js";
import { findPendingByDedupeKey, insertPending, staffFactsOf } from "./repo.js";

export interface SubmitInput<I = unknown> extends AuditOverride {
  readonly kind: ApprovalKind;
  /** 对象的最终表名与 id（按 kind 固定，库里有 CHECK） */
  readonly subjectType: string;
  readonly subjectId: string;
  readonly entityId?: string | null;
  readonly storeId?: string | null;
  /** 所属交付工单：只有链接核验给 */
  readonly deliveryTicketId?: string | null;
  /** 系统代某员工生成时的发起员工（终局驳回后的取消申请、差异单转入的退款）；员工自己提交时不用给 */
  readonly requesterStaffId?: string | null;
  /** 员工发起时客户端带来的幂等键，只作记录；重放由 tx.run 的幂等上下文挡 */
  readonly idempotencyKey?: string | null;
  /** 交给处理器的东西（领域行的 id、申请的数额等）；处理器用不到就写 null */
  readonly input: I;
}

export interface SubmitResult {
  readonly approvalId: string;
  readonly requestNo: string | null;
  readonly roundNo: number;
  readonly lockVersion: number;
}

export async function submit<I>(
  tx: Tx,
  deps: ApprovalDeps,
  ctx: EmitContext,
  input: SubmitInput<I>,
): Promise<SubmitResult> {
  const kind = kindOf(deps, input.kind);
  // 提交不查权限点（各类型的发起权限由领域接口判），所以不要员工上下文：员工提交时发起人就是操作人
  const { actor } = ctx;
  if (actor.type === "partner") throw new ApprovalError("actor", "服务商在 V1.0 不提交审批单");
  const requesterStaffId = actor.type === "staff" ? actor.id : (input.requesterStaffId ?? null);
  if (actor.type === "merchant" && requesterStaffId !== null) {
    throw new ApprovalError("actor", "商家提交的审核没有发起员工");
  }

  // 20：发起员工的行加共享锁，取他此刻所在的组作快照（“仅限发起人所在组的主管审批”的类型据此判）
  let requesterStaffGroupId: string | null = null;
  if (requesterStaffId !== null) {
    await lockRows(tx, "staff", [requesterStaffId], "share");
    const requester = (await staffFactsOf(tx, [requesterStaffId])).get(requesterStaffId);
    if (requester === undefined) throw new AppError("NOT_FOUND");
    requesterStaffGroupId = requester.staffGroupId;
  }

  const submission: ApprovalSubmission<I> = {
    approvalId: uuidv7(),
    kind: input.kind,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    entityId: input.entityId ?? null,
    storeId: input.storeId ?? null,
    deliveryTicketId: input.deliveryTicketId ?? null,
    input: input.input,
  };
  await kind.validate(tx, submission);
  const summary = ApprovalSummarySchema.safeParse(await kind.summarize(tx, submission));
  if (!summary.success) {
    throw new ApprovalError("summary", `${input.kind} 的摘要不合结构：${summary.error.message}`);
  }

  const dedupeKey = kind.dedupeKey?.(submission) ?? null;
  const pendingOf = async (): Promise<AppError | null> => {
    const pending = dedupeKey === null ? null : await findPendingByDedupeKey(tx, dedupeKey);
    return pending === null
      ? null
      : new AppError("APPROVAL_ALREADY_PENDING", {
          details: { approvalId: pending.id, requestNo: pending.requestNo },
        });
  };
  const pending = await pendingOf();
  if (pending !== null) throw pending;

  const roundNo = (await kind.roundNo?.(tx, submission)) ?? 1;
  // 取号放在靠后：同前缀同日的取号持锁到提交
  const requestNo =
    kind.numberPrefix === null ? null : await deps.bizNo.next(tx, kind.numberPrefix);
  const now = deps.clock.now();
  const deadline =
    deps.sla === undefined ? null : await computeDecisionSla(tx, deps.sla, input.kind, now);
  const row = {
    id: submission.approvalId,
    requestNo,
    kind: input.kind,
    category: kind.category,
    subjectType: submission.subjectType,
    subjectId: submission.subjectId,
    entityId: submission.entityId,
    storeId: submission.storeId,
    deliveryTicketId: submission.deliveryTicketId,
    roundNo,
    summary: summary.data,
    submitActorType: actor.type,
    submitActorId: actor.id,
    // 员工提交的客户端来源库里只收 admin（运维命令行、演示种子以员工身份提交也写 admin）
    submitClient: actor.type === "staff" ? "admin" : actor.client,
    requesterStaffId,
    requesterStaffGroupId,
    dedupeKey,
    idempotencyKey: requesterStaffId === null ? null : (input.idempotencyKey ?? null),
    now,
    dueAt: deadline?.dueAt ?? null,
    slaSnapshot: deadline?.snapshot ?? null,
  };
  // 并发的两个提交：后到的在这里等前一个提交，然后一行都没插进去。
  // 没插进去又查不到在途的那一张（它刚好在这中间被决定了）：再插一次，还不行按繁忙回
  if (!(await insertPending(tx, row))) {
    const raced = await pendingOf();
    if (raced !== null) throw raced;
    if (!(await insertPending(tx, row))) throw new AppError("BUSY");
  }
  deps.fresh.set(tx, (deps.fresh.get(tx) ?? new Set<string>()).add(row.id));

  await deps.flow.transition(tx, ctx, {
    machine: "approval_request",
    stateField: "status",
    id: row.id,
    event: "submit",
    created: true,
    entityId: row.entityId,
    storeId: row.storeId,
    payload: { kind: row.kind, roundNo },
    audit: auditOf("submit", row, "pending", input),
    ...(input.meta === undefined ? {} : { meta: input.meta }),
    emit: {
      type: "approval.submitted",
      payload: {
        v: 1,
        approvalRequestId: row.id,
        kind: row.kind,
        category: row.category,
        subjectType: row.subjectType,
        subjectId: row.subjectId,
        entityId: row.entityId,
        storeId: row.storeId,
        roundNo,
      },
    },
    args: issuePass(),
  });
  if (deadline !== null && deps.sla !== undefined) {
    await armDecisionTimer(tx, deps.sla.timers, row, deadline.dueAt, deadline.snapshot);
  }
  return { approvalId: row.id, requestNo, roundNo, lockVersion: 0 };
}
