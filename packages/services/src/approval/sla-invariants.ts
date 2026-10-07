// I3 交叉核对业务行、用途键、时刻与 timer 载荷；I5 独立重算快照以防超期读侧被脏 due_at 隐藏。
import { paramDef, validateParamValue } from "@liyoxi/shared/params";
import { addDays, calendarDate } from "@liyoxi/shared/time";
import { dueAt } from "@liyoxi/shared/workcal";
import type { InvariantViolation, Tx } from "../kernel/index.js";
import { currentCalendarVersion, loadWorkCalendar, workHoursAt } from "../sla/index.js";
import { APPROVAL_INVARIANT_LIMIT, boundApprovalKinds } from "./invariants.js";
import { approvalRow } from "./repo.js";
import {
  decisionPolicyKey,
  decisionTimerKey,
  decisionTimerPrefix,
  executionTimerKey,
  parseApprovalSla,
} from "./sla.js";
import type { ApprovalKindRegistration, ApprovalRow } from "./kinds.js";

type Kinds = ReadonlyMap<string, Pick<ApprovalKindRegistration, "executionSla">>;
const problem = (
  row: Pick<ApprovalRow, "id" | "entityId">,
  code: string,
  detail: object = {},
): InvariantViolation => ({
  subject: { type: "approval_request", id: row.id },
  ...(row.entityId === null ? {} : { entityId: row.entityId }),
  detail: { problem: code, ...detail },
});

export async function findI3Violations(
  tx: Tx,
  now: Date,
  kinds: Kinds = boundApprovalKinds(),
): Promise<InvariantViolation[]> {
  const violations: InvariantViolation[] = [];
  const rows = await tx.approvalRequest.findMany({ orderBy: { id: "asc" } });
  const timers = await tx.timer.findMany({
    where: { kind: "sla.breach", subjectType: "approval_request" },
    orderBy: { id: "asc" },
  });
  const timersByApproval = new Map<string, typeof timers>();
  for (const timer of timers)
    if (timer.subjectId !== null) {
      const bucket = timersByApproval.get(timer.subjectId) ?? [];
      bucket.push(timer);
      timersByApproval.set(timer.subjectId, bucket);
    }
  for (const persisted of rows) {
    const row = approvalRow(persisted);
    const owned = timersByApproval.get(row.id) ?? [];
    const snapshot = parseApprovalSla(row.slaSnapshot);
    const currentDecisionKey =
      snapshot === null ? null : decisionTimerKey(row.id, snapshot.calendarVersion);
    const live = owned.filter(
      (timer) => timer.status === "scheduled" || timer.status === "dispatched",
    );
    for (const timer of live) {
      if (!(
        timer.dedupeKey.startsWith(`${decisionTimerPrefix(row.id)}:`) ||
        timer.dedupeKey === executionTimerKey(row.id)
      )) {
        violations.push(
          problem(row, "timer_purpose_key", { timerId: timer.id, key: timer.dedupeKey }),
        );
      }
    }
    const decision = live.filter((timer) =>
      timer.dedupeKey.startsWith(`${decisionTimerPrefix(row.id)}:`),
    );
    const completed = owned.some(
      (timer) =>
        timer.dedupeKey === currentDecisionKey &&
        timer.status === "fired" &&
        row.dueAt !== null &&
        timer.fireAt.getTime() === row.dueAt.getTime() &&
        row.dueAt <= now,
    );
    const required = row.status === "pending" && row.dueAt !== null && !completed;
    if (decision.length !== Number(required))
      violations.push(
        problem(row, "decision_timer_count", {
          actual: decision.length,
          expected: Number(required),
          dueAt: row.dueAt?.toISOString() ?? null,
        }),
      );
    for (const timer of decision) {
      const payload = timer.payload as Record<string, unknown> | null;
      if (
        row.dueAt === null ||
        timer.dedupeKey !== currentDecisionKey ||
        timer.fireAt.getTime() !== row.dueAt.getTime() ||
        payload?.purpose !== "decision" ||
        payload.dueAt !== row.dueAt.toISOString() ||
        !snapshot ||
        ["policy", "amount", "unit", "calendarVersion", "computedAt"].some(
          (key) => payload[key] !== snapshot[key as keyof typeof snapshot],
        )
      ) {
        violations.push(problem(row, "decision_timer_snapshot", { timerId: timer.id }));
      }
    }
    const execution = live.filter((timer) => timer.dedupeKey === executionTimerKey(row.id));
    const source = kinds.get(row.kind)?.executionSla;
    if (source === undefined) {
      if (execution.length)
        violations.push(
          problem(row, "execution_source_missing", { actual: execution.length, kind: row.kind }),
        );
    } else {
      const facts = await source(tx, row);
      const expected =
        row.status === "approved" &&
        facts?.status === "pending_execution" &&
        !facts.hasExecuted &&
        facts.dueAt !== null &&
        facts.dueAt > now;
      if (execution.length !== Number(expected))
        violations.push(
          problem(row, "execution_timer_count", {
            actual: execution.length,
            expected: Number(expected),
            domainStatus: facts?.status ?? null,
          }),
        );
      for (const timer of execution) {
        const payload = timer.payload as Record<string, unknown> | null;
        if (
          !facts ||
          facts.dueAt === null ||
          timer.fireAt.getTime() !== facts.dueAt.getTime() ||
          payload?.purpose !== "execution" ||
          payload.dueAt !== facts.dueAt.toISOString()
        ) {
          violations.push(problem(row, "execution_timer_due", { timerId: timer.id }));
        }
      }
    }
    if (violations.length >= APPROVAL_INVARIANT_LIMIT) break;
  }
  // timer 外键是多态：孤儿行需要独立发现。
  const ids = new Set(rows.map((row) => row.id));
  for (const timer of timers)
    if (
      (timer.status === "scheduled" || timer.status === "dispatched") &&
      timer.subjectId !== null &&
      !ids.has(timer.subjectId)
    ) {
      violations.push({
        subject: { type: "timer", id: timer.id },
        detail: { problem: "approval_timer_orphan", approvalId: timer.subjectId },
      });
    }
  return violations.slice(0, APPROVAL_INVARIANT_LIMIT);
}

export async function findI5Violations(tx: Tx, now: Date): Promise<InvariantViolation[]> {
  const violations: InvariantViolation[] = [];
  const currentVersion = await currentCalendarVersion(tx);
  const rows = await tx.approvalRequest.findMany({
    where: { status: "pending", dueAt: { not: null } },
    orderBy: { id: "asc" },
  });
  for (const persisted of rows) {
    const row = approvalRow(persisted);
    const snapshot = parseApprovalSla(row.slaSnapshot);
    const policy = decisionPolicyKey(row.kind);
    const def = policy === undefined ? undefined : paramDef(policy);
    if (
      !snapshot ||
      policy === undefined ||
      !def ||
      snapshot.policy !== policy.slice(4) ||
      validateParamValue(def, { amount: snapshot.amount, unit: snapshot.unit }) !== null ||
      snapshot.calendarVersion > currentVersion
    ) {
      violations.push(problem(row, "decision_sla_snapshot", { kind: row.kind }));
      continue;
    }
    // 在途日历订阅尚未消费时允许旧批次：当工作窗口有更新，不能把暂时旧 due_at 误报成污染。
    const from = calendarDate(row.submittedAt);
    const windowEnd = calendarDate(row.dueAt!);
    const to = addDays(windowEnd, Math.max(45, snapshot.amount * 4));
    const changed = await tx.workCalendarDay.count({
      where: {
        day: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${windowEnd}T00:00:00Z`) },
        calendarVersion: { gt: snapshot.calendarVersion },
      },
    });
    if (changed > 0 && ["work_days", "work_minutes", "same_day_cutoff"].includes(snapshot.unit))
      continue;
    const calendar = await loadWorkCalendar(
      tx,
      { from, to },
      await workHoursAt(tx, row.submittedAt),
    );
    const computed = dueAt(calendar, row.submittedAt, snapshot).at;
    if (computed.getTime() !== row.dueAt!.getTime())
      violations.push(
        problem(row, "decision_due_mismatch", {
          expected: computed.toISOString(),
          actual: row.dueAt!.toISOString(),
          expectedOverdue: computed < now,
          actualOverdue: row.dueAt! < now,
        }),
      );
    if (violations.length >= APPROVAL_INVARIANT_LIMIT) break;
  }
  return violations.slice(0, APPROVAL_INVARIANT_LIMIT);
}
