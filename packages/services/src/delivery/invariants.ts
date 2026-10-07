import { getLaunchFacts } from "../publish/index.js";
import { createIdentityContext, lockRows } from "../kernel/index.js";
import type { InvariantViolation, Tx } from "../kernel/index.js";
import { boundDelivery } from "./binding.js";
import { PlanContentSchema } from "@liyoxi/contract";
import { planApplied, reevaluate } from "./reevaluate.js";
import { lockTickets, ticketInclude } from "./repo.js";
import { productionViolations } from "./production-invariants.js";
export const DELIVERY_INVARIANT_CODES = [
  "I1",
  "I3",
  "I4",
  "I5",
  "I6",
  "I7",
  "I8",
  "I9",
  "I10",
  "I11",
  "I12",
  "I13",
  "I15",
] as const;
export async function findDeliveryViolations(tx: Tx, code: string): Promise<InvariantViolation[]> {
  const result: InvariantViolation[] = [],
    bad = (type: string, id: string, entityId: string, detail: Record<string, unknown>) =>
      result.push({ subject: { type, id }, entityId, detail });
  if (["I1", "I3", "I5"].includes(code)) {
    const rows = await tx.deliveryTicket.findMany({
      include: ticketInclude,
      orderBy: { id: "asc" },
    });
    const initialHistory = new Map<string, { event: string; toState: string }>();
    if (code === "I5") {
      // 对原初始票集有界批量读取；保留最早 occurredAt 语义，不为旧查询增加同时间 tie 约定。
      for (let start = 0; start < rows.length; start += 1_000) {
        const initial = await tx.statusTransition.findMany({
          where: {
            machine: "delivery_ticket",
            stateField: "step",
            fromState: null,
            subjectId: { in: rows.slice(start, start + 1_000).map((r) => r.id) },
          },
          select: { subjectId: true, event: true, toState: true },
          orderBy: { occurredAt: "asc" },
        });
        for (const entry of initial)
          if (!initialHistory.has(entry.subjectId)) initialHistory.set(entry.subjectId, entry);
      }
    }
    if (code === "I3") {
      // full 检查是一个事务：先持有全部低级父锁，避免第二张工单在方案锁之后首次加父锁。
      await lockTickets(
        tx,
        rows.map((r) => r.id),
      );
      await lockRows(
        tx,
        "delivery_plan",
        rows.flatMap((r) => (r.dramaOrder.deliveryPlan ? [r.dramaOrder.deliveryPlan.id] : [])),
      );
    }
    if (code === "I3") {
      // 自动推进多工单可能预填封面；同事务统一先持全部封面锁，不能逐项回退文件 id。
      const posters = rows.flatMap((r) => {
        const shot = r.orderItem.dramaSnapshot as { posterFileId?: string };
        return shot.posterFileId ? [shot.posterFileId] : [];
      });
      const dramas = await tx.drama.findMany({ where: { id: { in: rows.map((r) => r.dramaId) } } });
      await lockRows(tx, "file_object", [
        ...posters,
        ...dramas.flatMap((d) => (d.posterFileId ? [d.posterFileId] : [])),
      ]);
    }
    for (const r of rows) {
      if (code === "I1") {
        const advanced = [
          "sample_making",
          "sample_confirm",
          "batch_compose",
          "delivering",
          "awaiting_launch",
          "launch_verify",
          "in_service",
          "takedown",
          "archived",
        ].includes(r.step);
        if (advanced && !r.dramaOrder.deliveryPlan?.confirmedVersionNo)
          bad("delivery_ticket", r.id, r.entityId, { missingConfirmedPlan: true });
        if (
          [
            "batch_compose",
            "delivering",
            "awaiting_launch",
            "launch_verify",
            "in_service",
            "takedown",
            "archived",
          ].includes(r.step) &&
          !(await tx.sample.count({ where: { deliveryTicketId: r.id, status: "confirmed" } }))
        )
          bad("delivery_ticket", r.id, r.entityId, { missingConfirmedSample: true });
        if (
          [
            "delivering",
            "awaiting_launch",
            "launch_verify",
            "in_service",
            "takedown",
            "archived",
          ].includes(r.step) &&
          (r.episodeOutputs.length !== r.orderItem.episodeCount ||
            r.episodeOutputs.some((e) => e.status !== "qc_passed"))
        )
          bad("delivery_ticket", r.id, r.entityId, { invalidCurrentEpisodes: true });
      }
      if (code === "I5") {
        const open = r.deliveryTicketStages.filter((s) => s.completedAt === null),
          closed = ["archived", "terminated"].includes(r.step);
        const initial = initialHistory.get(r.id);
        if (closed ? open.length > 0 : open.length !== 1 || open[0]?.step !== r.step)
          bad("delivery_ticket", r.id, r.entityId, { step: r.step, openCount: open.length });
        if (
          initial?.event === "ticket.created" &&
          initial.toState === "plan_confirm" &&
          !r.deliveryTicketStages.some(
            (s) =>
              s.step === "assigning" &&
              s.exitEvent === "ticket.created" &&
              s.completedAt?.getTime() === s.enteredAt.getTime(),
          )
        )
          bad("delivery_ticket", r.id, r.entityId, { missingInitialAssigning: true });
      }
      if (code === "I3" && !r.pauseCount) {
        const p = r.dramaOrder.deliveryPlan,
          v = p?.deliveryPlanVersions.find((v) => v.versionNo === p.confirmedVersionNo);
        const facts = ["awaiting_launch", "launch_verify"].includes(r.step)
          ? await getLaunchFacts(tx, r.orderItemId)
          : null;
        const composed =
          r.episodeOutputs.length === r.orderItem.episodeCount &&
          new Set(r.episodeOutputs.map((e) => e.episodeNo)).size === r.orderItem.episodeCount &&
          r.episodeOutputs.every(
            (e) =>
              e.episodeNo >= 1 &&
              e.episodeNo <= r.orderItem.episodeCount &&
              e.status === "qc_passed",
          ) &&
          r.qcRecords.find((q) => q.targetType === "delivery_ticket")?.verdict === "pass";
        const ready =
          (r.step === "plan_confirm" &&
            !!v &&
            v.decision === "confirmed" &&
            (await planApplied(tx, r.dramaOrderId, v.contentSnapshot))) ||
          r.step === "ad_prep" ||
          (r.step === "batch_compose" && composed) ||
          (!!facts &&
            (facts.hasLive ||
              (r.step === "awaiting_launch" && facts.hasVerifying) ||
              (r.step === "launch_verify" && !facts.hasVerifying)));
        if (ready) {
          const deps = boundDelivery(),
            { moved } = await reevaluate(
              tx,
              deps,
              createIdentityContext({ actor: { type: "system", job: "invariants.full" } }),
              r.id,
            );
          if (moved)
            result.push({
              subject: { type: "delivery_ticket", id: r.id },
              entityId: r.entityId,
              detail: { stepBefore: r.step, moved },
              healed: { action: "reevaluate", at: deps.clock.now() },
            });
        }
      }
    }
  }
  if (code === "I4") {
    for (const t of await tx.deliveryTicket.findMany({ include: { orderItem: true } }))
      if (
        t.entityId !== t.orderItem.entityId ||
        t.storeId !== t.orderItem.storeId ||
        t.dramaOrderId !== t.orderItem.dramaOrderId ||
        t.dramaId !== t.orderItem.dramaId
      )
        bad("delivery_ticket", t.id, t.entityId, { parentMismatch: true });
    for (const p of await tx.deliveryPlan.findMany({
      include: { dramaOrder: true, deliveryPlanVersions: true, deliveryPlanChangeRequests: true },
    })) {
      if (p.entityId !== p.dramaOrder.entityId || p.storeId !== p.dramaOrder.storeId)
        bad("delivery_plan", p.id, p.entityId, { parentMismatch: true });
      for (const child of [...p.deliveryPlanVersions, ...p.deliveryPlanChangeRequests])
        if (child.entityId !== p.entityId || child.storeId !== p.storeId)
          bad("delivery_plan", p.id, p.entityId, { childId: child.id, parentMismatch: true });
    }
  }
  if (code === "I6")
    for (const p of await tx.deliveryPlan.findMany({
      include: { deliveryPlanVersions: true, deliveryPlanChangeRequests: true },
    })) {
      const undecided = p.deliveryPlanVersions.filter((v) => v.decision === null),
        max = Math.max(0, ...p.deliveryPlanVersions.map((v) => v.versionNo));
      if (
        p.currentVersionNo !== max ||
        undecided.length > 1 ||
        undecided.some((v) => v.versionNo !== p.currentVersionNo) ||
        (p.status === "revising" &&
          !p.deliveryPlanChangeRequests.some((r) => r.resolvedByVersionNo === null))
      )
        bad("delivery_plan", p.id, p.entityId, {
          currentVersionNo: p.currentVersionNo,
          max,
          undecidedCount: undecided.length,
        });
      // 快照解析同时验证已存内容，检查项不能把坏 JSON 当成正常方案。
      for (const v of p.deliveryPlanVersions)
        if (!PlanContentSchema.safeParse(v.contentSnapshot).success)
          bad("delivery_plan_version", v.id, v.entityId, { invalidSnapshot: true });
    }
  return [...result, ...(await productionViolations(tx, code))];
}
