// 决定时限与日历修正（W2-05）。持审批行的原 FOR UPDATE 锁后操作同用途 timer。
import type { ApprovalKind } from "@liyoxi/contract";
import { EVENT_PAYLOAD_SCHEMAS, InstantSchema } from "@liyoxi/contract";
import { calendarDate } from "@liyoxi/shared/time";
import type { DefinedParamKey } from "@liyoxi/shared/params";
import type { SlaPolicy } from "@liyoxi/shared/workcal";

import type { Flow } from "../flow/index.js";
import { issuePass } from "./machine.js";
import { paramsAt } from "../config/index.js";
import type { Events } from "../events/index.js";
import { AppError, createIdentityContext, lockRows } from "../kernel/index.js";
import type { Clock, DeliveredEvent, FiredTimer, TimerOutcome, Tx } from "../kernel/index.js";
import {
  currentCalendarVersion,
  lockCalendarImport,
  workHoursAt,
  SLA_UNITS,
} from "../sla/index.js";
import type { Sla, SlaSnapshot } from "../sla/index.js";
import { timerKey } from "../timers/index.js";
import type { Timers } from "../timers/index.js";
import type { ApprovalKindRegistration, ApprovalRow } from "./kinds.js";
import { findApproval } from "./repo.js";

export interface ApprovalSlaBinding {
  readonly clock: Clock;
  readonly events: Pick<Events, "emit">;
  readonly flow: Pick<Flow, "transition">;
  readonly sla: Pick<Sla, "dueAt">;
  readonly timers: Pick<Timers, "arm" | "cancel">;
  readonly kinds?: ReadonlyMap<string, ApprovalKindRegistration>;
}
const scopes: Array<{ binding: ApprovalSlaBinding }> = [];
export function bindApprovalSla(binding: ApprovalSlaBinding): () => void {
  const scope = { binding };
  scopes.push(scope);
  return () => {
    const index = scopes.indexOf(scope);
    if (index >= 0) scopes.splice(index, 1);
  };
}
export function boundApprovalSla(): ApprovalSlaBinding {
  const scope = scopes.at(-1);
  if (!scope) throw new AppError("INTERNAL", { message: "审批时限尚未绑定运行时" });
  return scope.binding;
}

/** A93 的四类不计决定时限；账号变更没有登记决定策略，沿用无时限读侧升级。 */
export const DECISION_POLICY_KEYS = {
  qualification: "sla.review.qualification",
  channel_account: "sla.review.channel_account",
  launch_link: "sla.review.launch_link",
  order_cancel: "sla.review.refund_approve",
  ad_cancel: "sla.review.refund_approve",
  qualification_cancel: "sla.review.refund_approve",
  plan_refund: "sla.review.refund_approve",
} as const satisfies Partial<Record<ApprovalKind, DefinedParamKey>>;

export function decisionPolicyKey(kind: ApprovalKind): DefinedParamKey | undefined {
  return DECISION_POLICY_KEYS[kind as keyof typeof DECISION_POLICY_KEYS];
}
export function parseApprovalSla(value: unknown): SlaSnapshot | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).sort().join(",") !== "amount,calendarVersion,computedAt,policy,unit")
    return null;
  if (
    typeof row.policy !== "string" ||
    !row.policy ||
    typeof row.amount !== "number" ||
    !Number.isInteger(row.amount) ||
    row.amount < 0 ||
    typeof row.unit !== "string" ||
    !(SLA_UNITS as readonly string[]).includes(row.unit) ||
    typeof row.calendarVersion !== "number" ||
    !Number.isInteger(row.calendarVersion) ||
    row.calendarVersion < 0 ||
    !InstantSchema.safeParse(row.computedAt).success
  )
    return null;
  return row as unknown as SlaSnapshot;
}
export const decisionTimerPrefix = (id: string): string =>
  timerKey("sla.breach", { type: "approval_request", id }, "decision");
export const decisionTimerKey = (id: string, calendarVersion: number): string =>
  timerKey("sla.breach", { type: "approval_request", id }, "decision", calendarVersion);
export const executionTimerKey = (id: string): string =>
  timerKey("sla.breach", { type: "approval_request", id }, "execution");

export async function computeDecisionSla(
  tx: Tx,
  deps: Pick<ApprovalSlaBinding, "sla">,
  kind: ApprovalKind,
  from: Date,
): Promise<{ dueAt: Date; snapshot: SlaSnapshot } | null> {
  const key = decisionPolicyKey(kind);
  if (key === undefined) return null;
  const values = await paramsAt(tx, [key], from);
  const policy = values[key] as SlaPolicy | null;
  if (policy === null) return null;
  return deps.sla.dueAt(tx, {
    policy: key.slice(4),
    amount: policy.amount,
    unit: policy.unit,
    from,
    workHours: await workHoursAt(tx, from),
  });
}

export async function armDecisionTimer(
  tx: Tx,
  timers: Pick<Timers, "arm">,
  row: Pick<ApprovalRow, "id" | "entityId" | "storeId">,
  dueAt: Date,
  snapshot: SlaSnapshot,
): Promise<void> {
  await timers.arm(tx, {
    kind: "sla.breach",
    subject: { type: "approval_request", id: row.id },
    key: decisionTimerKey(row.id, snapshot.calendarVersion),
    fireAt: dueAt,
    payload: { ...snapshot, purpose: "decision", dueAt: dueAt.toISOString() },
    ...(row.entityId === null ? {} : { entityId: row.entityId }),
    ...(row.storeId === null ? {} : { storeId: row.storeId }),
  });
}
export async function cancelDecisionTimer(tx: Tx, timers: Pick<Timers, "cancel">, id: string) {
  return timers.cancel(tx, {
    subject: { type: "approval_request", id },
    kinds: ["sla.breach"],
    keyPrefix: decisionTimerPrefix(id),
  });
}

export async function onApprovalCalendarImported(
  tx: Tx,
  deps: ApprovalSlaBinding,
  event: DeliveredEvent,
): Promise<void> {
  if (event.type !== "calendar.imported") return;
  const payload = EVENT_PAYLOAD_SCHEMAS["calendar.imported"].parse(event.payload);
  await lockCalendarImport(tx);
  // 旧事件不能用新日历事实冒充旧批次。重复当前批次由每行 snapshot 版本挡住。
  if (payload.calendarVersion !== (await currentCalendarVersion(tx))) return;
  const candidates = await tx.approvalRequest.findMany({
    where: { status: "pending", dueAt: { not: null } },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  await lockRows(
    tx,
    "approval_request",
    candidates.map((row) => row.id),
  );
  for (const candidate of candidates) {
    const row = await findApproval(tx, candidate.id);
    if (!row || row.status !== "pending" || row.dueAt === null) continue;
    const snapshot = parseApprovalSla(row.slaSnapshot);
    if (
      !snapshot ||
      snapshot.calendarVersion >= payload.calendarVersion ||
      !["work_days", "work_minutes", "same_day_cutoff"].includes(snapshot.unit)
    )
      continue;
    const fromDate = calendarDate(row.submittedAt);
    const dueDate = calendarDate(row.dueAt);
    // 如果旧批次尚未消费就被新导入超越，最新事件同时覆盖该窗口内尚未重算的真实 kind 变化。
    // 否则“旧事件跳过 + 新事件 changedDays 不在窗口”会永久漏掉旧批次的更正。
    const changedInWindow = await tx.workCalendarDay.count({
      where: {
        day: { gte: new Date(`${fromDate}T00:00:00Z`), lte: new Date(`${dueDate}T00:00:00Z`) },
        calendarVersion: { gt: snapshot.calendarVersion, lte: payload.calendarVersion },
      },
    });
    if (changedInWindow === 0) continue;
    const recomputed = await deps.sla.dueAt(tx, {
      policy: snapshot.policy,
      amount: snapshot.amount,
      unit: snapshot.unit,
      from: row.submittedAt,
      workHours: await workHoursAt(tx, row.submittedAt),
    });
    await cancelDecisionTimer(tx, deps.timers, row.id);
    const ctx = createIdentityContext({
      actor: { type: "system", job: "approval.calendar_imported" },
    });
    await deps.flow.transition(tx, ctx, {
      machine: "approval_request",
      stateField: "status",
      id: row.id,
      event: "sla.recalculated",
      set: { due_at: recomputed.dueAt, sla_snapshot: { ...recomputed.snapshot } },
      entityId: row.entityId,
      storeId: row.storeId,
      payload: { calendarVersion: recomputed.snapshot.calendarVersion },
      audit: {
        stream: row.category === "review" ? "activity" : "ops",
        category: row.category,
        action: "approval.request.recalculate",
        summary: "日历修正后重算审批时限",
        target: { type: "approval_request", id: row.id },
        ...(row.entityId === null
          ? { entityId: null, storeId: null }
          : { entityId: row.entityId, storeId: row.storeId }),
        before: { dueAt: row.dueAt.toISOString(), slaSnapshot: snapshot },
        after: { dueAt: recomputed.dueAt.toISOString(), slaSnapshot: recomputed.snapshot },
        fields: ["dueAt", "slaSnapshot"],
      },
      emit: { none: true, primary: "calendar.imported" },
      args: issuePass(),
    });
    await armDecisionTimer(tx, deps.timers, row, recomputed.dueAt, recomputed.snapshot);
  }
}

export async function handleApprovalSlaBreach(
  tx: Tx,
  deps: ApprovalSlaBinding,
  timer: FiredTimer,
): Promise<TimerOutcome> {
  if (timer.subjectType !== "approval_request" || timer.subjectId === null) return "skipped";
  await lockRows(tx, "approval_request", [timer.subjectId]);
  const row = await findApproval(tx, timer.subjectId);
  if (!row) return "skipped";
  const persisted = await tx.timer.findUnique({ where: { id: timer.id } });
  if (!persisted || persisted.status !== "dispatched" || persisted.fireAt > deps.clock.now())
    return "skipped";
  const purpose = timer.payload?.purpose;
  let dueAt: Date | null;
  if (purpose === "decision") {
    const snapshot = parseApprovalSla(row.slaSnapshot);
    if (
      snapshot === null ||
      persisted.dedupeKey !== decisionTimerKey(row.id, snapshot.calendarVersion) ||
      row.status !== "pending" ||
      row.dueAt === null
    )
      return "skipped";
    dueAt = row.dueAt;
  } else if (purpose === "execution") {
    const source = deps.kinds?.get(row.kind)?.executionSla;
    if (persisted.dedupeKey !== executionTimerKey(row.id) || row.status !== "approved" || !source)
      return "skipped";
    const facts = await source(tx, row);
    if (facts === null || facts.status !== "pending_execution" || facts.hasExecuted)
      return "skipped";
    dueAt = facts.dueAt;
  } else return "skipped";
  if (
    dueAt === null ||
    dueAt.getTime() !== persisted.fireAt.getTime() ||
    dueAt > deps.clock.now() ||
    timer.payload?.dueAt !== dueAt.toISOString()
  )
    return "skipped";
  const ctx = createIdentityContext({ actor: { type: "system", job: "approval.sla_breach" } });
  await deps.events.emit(tx, ctx, {
    type: "approval.sla_breached",
    aggregate: { type: "approval_request", id: row.id },
    payload: {
      v: 1,
      approvalRequestId: row.id,
      kind: row.kind,
      purpose,
      dueAt: dueAt.toISOString(),
    },
    entityId: row.entityId,
    storeId: row.storeId,
    dedupeKey: `tmr:${persisted.dedupeKey}`,
  });
  return "fired";
}
