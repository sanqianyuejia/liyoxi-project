import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Prisma } from "@liyoxi/db";
import { ApprovalListQuerySchema } from "@liyoxi/contract";
import {
  createApproval,
  bindApprovalSla,
  findI3Violations,
  findI5Violations,
  onApprovalCalendarImported,
  handleApprovalSlaBreach,
} from "./index.js";
import type { Approval, ApprovalSlaBinding } from "./index.js";
import { alertsOf, createBizNoIssuer, uuidv7 } from "../kernel/index.js";
import { createSla, lockCalendarImport } from "../sla/index.js";
import { createTimers, runTimer } from "../timers/index.js";
import { claimDeliveries, consumeDelivery } from "../events/index.js";
import { sampleSystemContext, SAMPLE_APPROVAL_TABLE } from "../testing/index.js";
import { SLOW, useApprovalWorld, refusal } from "./__fixtures__/world.js";
import type { Merchant, Person } from "./__fixtures__/world.js";
import { decisionTimerKey, executionTimerKey } from "./sla.js";

const world = useApprovalWorld({ max: 12 });
const T = { timeout: SLOW };
let approval: Approval;
let deps: ApprovalSlaBinding;
let unbind: () => void;
let requester: Person;
const submitted: string[] = [];
const system = sampleSystemContext("lyxtest.approval_sla");

beforeAll(async () => {
  const { sample } = world;
  const sla = createSla({ assembly: sample.assembly, clock: sample.clock });
  const timers = createTimers({ assembly: sample.assembly });
  approval = createApproval({
    assembly: sample.assembly,
    clock: sample.clock,
    flow: sample.flow,
    events: sample.events,
    bizNo: createBizNoIssuer({ clock: sample.clock, appEnv: "test" }),
    sla,
    timers,
  });
  deps = {
    flow: sample.flow,
    clock: sample.clock,
    events: sample.events,
    sla,
    timers,
    kinds: approval.kinds,
  };
  unbind = bindApprovalSla(deps);
  requester = await world.person({ role: "cs" });
}, SLOW);
beforeEach(() => world.sample.clock.set(new Date("2026-01-05T04:00:00.000Z")));
afterEach(async () => {
  for (const id of submitted.splice(0)) {
    const row = await world.prisma.approvalRequest.findUnique({ where: { id } });
    if (row?.status === "pending")
      await world.sample.tx.run((tx) => approval.withdraw(tx, system, { approvalId: id }));
  }
}, SLOW);
afterAll(() => unbind?.());

async function submit(
  merchant: Merchant,
  kind: "qualification" | "channel_account" | "points_adjust" = "qualification",
) {
  const input =
    kind === "qualification"
      ? world.input.qualification(merchant)
      : kind === "channel_account"
        ? world.input.channelAccount(merchant)
        : world.input.pointsAdjust(merchant);
  const domainId = uuidv7();
  const result = await world.sample.tx.run(async (tx) => {
    const result = await approval.submit(
      tx,
      kind === "points_adjust" ? requester.identity : merchant.identity,
      {
        ...input,
        input: { domainId },
      },
    );
    await tx.$executeRawUnsafe(
      `INSERT INTO ${SAMPLE_APPROVAL_TABLE} (id, approval_request_id, status) VALUES ($1::uuid, $2::uuid, 'pending')`,
      domainId,
      result.approvalId,
    );
    return result;
  });
  submitted.push(result.approvalId);
  return world.prisma.approvalRequest.findUniqueOrThrow({ where: { id: result.approvalId } });
}
async function changedDay(day: string, isWorkday: boolean) {
  return world.sample.tx.run(async (tx) => {
    await lockCalendarImport(tx, "exclusive");
    const { _max } = await tx.workCalendarDay.aggregate({ _max: { calendarVersion: true } });
    const version = (_max.calendarVersion ?? 0) + 1;
    await tx.workCalendarDay.update({
      where: { day: new Date(`${day}T00:00:00Z`) },
      data: {
        isWorkday,
        kind: isWorkday ? "weekday" : "holiday",
        calendarVersion: version,
      },
    });
    const emitted = await world.sample.events.emit(tx, system, {
      type: "calendar.imported",
      payload: {
        v: 1,
        year: Number(day.slice(0, 4)),
        calendarVersion: version,
        changedDays: [day],
      },
      dedupeKey: `calendar.imported:${String(version)}`,
    });
    return {
      id: emitted.id!,
      type: "calendar.imported",
      payload: {
        v: 1,
        year: Number(day.slice(0, 4)),
        calendarVersion: version,
        changedDays: [day],
      },
    };
  });
}
async function consumeCalendar(event: { id: string }) {
  await world.sample.events.expand();
  const claimed = await world.sample.tx.run((tx) => claimDeliveries(tx));
  const ref = claimed.claimed.find(
    (item) => item.eventId === event.id && item.subscriber === "approval.onCalendarImported",
  );
  expect(ref).toBeDefined();
  expect(
    await consumeDelivery(
      {
        tx: world.sample.tx,
        subscribers: world.sample.events.subscribers,
        alerts: alertsOf(world.sample.assembly),
      },
      ref!,
    ),
  ).toBe("done");
  expect(
    await world.prisma.outboxDelivery.findFirstOrThrow({
      where: { outboxEventId: event.id, subscriber: "approval.onCalendarImported" },
    }),
  ).toMatchObject({ status: "done", consumedAt: expect.any(Date) });
}

async function timers(id: string) {
  return world.prisma.timer.findMany({
    where: { subjectType: "approval_request", subjectId: id },
    orderBy: { createdAt: "asc" },
  });
}
async function healthy() {
  expect(
    await world.sample.tx.run((tx) =>
      findI3Violations(tx, world.sample.clock.now(), approval.kinds),
    ),
  ).toEqual([]);
  expect(await world.sample.tx.run((tx) => findI5Violations(tx, world.sample.clock.now()))).toEqual(
    [],
  );
}

describe("审批决定 SLA", () => {
  it("提交保存策略快照与用途键；A93无时限类型不登记决定timer", T, async () => {
    const merchant = await world.merchant();
    const timed = await submit(merchant);
    expect(timed.dueAt).not.toBeNull();
    expect(timed.slaSnapshot).toMatchObject({
      policy: "review.qualification",
      amount: 1,
      unit: "work_days",
    });
    expect(await timers(timed.id)).toEqual([
      expect.objectContaining({
        dedupeKey: decisionTimerKey(
          timed.id,
          (timed.slaSnapshot as { calendarVersion: number }).calendarVersion,
        ),
        fireAt: timed.dueAt,
        status: "scheduled",
      }),
    ]);
    const untimed = await submit(merchant, "points_adjust");
    expect(untimed.dueAt).toBeNull();
    expect(untimed.slaSnapshot).toBeNull();
    expect(await timers(untimed.id)).toHaveLength(0);
    await healthy();
  });

  it("touch只升版本，旧版本通过被拒；驳回/撤回在原事务取消决定timer", T, async () => {
    const row = await submit(await world.merchant());
    const beforeHistory = await world.prisma.statusTransition.count({
      where: { subjectId: row.id },
    });
    const beforeAudit = await world.prisma.auditLog.count({ where: { targetId: row.id } });
    await world.sample.tx.run((tx) =>
      approval.touchPending(tx, { approvalId: row.id, lockVersion: 0 }),
    );
    const touched = await world.prisma.approvalRequest.findUniqueOrThrow({ where: { id: row.id } });
    expect(touched).toMatchObject({
      status: "pending",
      lockVersion: 1,
      dueAt: row.dueAt,
      slaSnapshot: row.slaSnapshot,
    });
    expect(await world.prisma.statusTransition.count({ where: { subjectId: row.id } })).toBe(
      beforeHistory,
    );
    expect(await world.prisma.auditLog.count({ where: { targetId: row.id } })).toBe(beforeAudit);
    expect(
      await refusal(
        world.sample.tx.run((tx) =>
          approval.touchPending(tx, { approvalId: row.id, lockVersion: 0 }),
        ),
      ),
    ).toMatchObject({ error: "VERSION_CONFLICT", details: { lockVersion: 1 } });
    const reviewer = await world.person({ role: "super_admin" });
    expect(
      await refusal(
        world.sample.tx.run((tx) =>
          approval.approve(tx, reviewer.identity, {
            approvalId: row.id,
            staff: reviewer.staff,
            lockVersion: 0,
          }),
        ),
      ),
    ).toMatchObject({ error: "VERSION_CONFLICT" });
    await world.sample.tx.run((tx) =>
      approval.reject(tx, system, { approvalId: row.id, note: "测试驳回" }),
    );
    expect((await timers(row.id)).every((timer) => timer.status === "cancelled")).toBe(true);
    expect(
      await refusal(
        world.sample.tx.run((tx) =>
          approval.touchPending(tx, { approvalId: row.id, lockVersion: 1 }),
        ),
      ),
    ).toMatchObject({ error: "APPROVAL_NOT_PENDING" });
    const withdrawn = await submit(await world.merchant());
    await world.sample.tx.run((tx) => approval.withdraw(tx, system, { approvalId: withdrawn.id }));
    expect((await timers(withdrawn.id)).every((timer) => timer.status === "cancelled")).toBe(true);
    await healthy();
  });

  it("日历只重算交集窗口；重复/旧事件无副作用，保留提交策略和历史工时", T, async () => {
    const row = await submit(await world.merchant());
    const initial = row.slaSnapshot as Record<string, unknown>;
    // 参数写入发生在提交之后，重算不可借用新的策略或新的工作时段。
    await world.prisma.paramValue.createMany({
      data: [
        {
          id: uuidv7(),
          key: "sla.review.qualification",
          value: { amount: 5, unit: "work_days" },
          effectiveAt: new Date("2026-01-05T04:00:00.001Z"),
          createdAt: world.sample.clock.now(),
          createdByStaffId: requester.id,
        },
        {
          id: uuidv7(),
          key: "work.end",
          value: "15:00",
          effectiveAt: new Date("2026-01-05T04:00:00.001Z"),
          createdAt: world.sample.clock.now(),
          createdByStaffId: requester.id,
        },
      ],
    });
    const outside = await changedDay("2026-03-02", false);
    await world.sample.tx.run((tx) => onApprovalCalendarImported(tx, deps, outside));
    expect(
      (await world.prisma.approvalRequest.findUniqueOrThrow({ where: { id: row.id } })).slaSnapshot,
    ).toEqual(initial);
    const inWindow = await changedDay("2026-01-06", false);
    await world.sample.tx.run((tx) => onApprovalCalendarImported(tx, deps, inWindow));
    const updated = await world.prisma.approvalRequest.findUniqueOrThrow({ where: { id: row.id } });
    expect(updated.dueAt!.getTime()).toBeGreaterThan(row.dueAt!.getTime());
    expect(updated.slaSnapshot).toMatchObject({
      amount: 1,
      policy: "review.qualification",
      unit: "work_days",
      calendarVersion: inWindow.payload.calendarVersion,
    });
    const history = await timers(row.id);
    expect(history.filter((timer) => timer.status === "scheduled")).toHaveLength(1);
    const counts = [
      history.length,
      await world.prisma.auditLog.count({ where: { targetId: row.id } }),
    ];
    await world.sample.tx.run((tx) => onApprovalCalendarImported(tx, deps, inWindow));
    await world.sample.tx.run((tx) => onApprovalCalendarImported(tx, deps, outside));
    expect([
      (await timers(row.id)).length,
      await world.prisma.auditLog.count({ where: { targetId: row.id } }),
    ]).toEqual(counts);
    await healthy();
    await changedDay("2026-01-06", true);
  });

  it("工作分钟策略的重算使用提交时工时，之后的新工时不会替换历史窗口", T, async () => {
    await world.prisma.paramValue.create({
      data: {
        id: uuidv7(),
        key: "sla.review.channel_account",
        value: { amount: 120, unit: "work_minutes" },
        createdByStaffId: requester.id,
        createdAt: new Date("2026-01-04T00:00:00Z"),
        effectiveAt: new Date("2026-01-04T00:00:00Z"),
      },
    });
    const row = await submit(await world.merchant(), "channel_account");
    expect(row.dueAt).toEqual(new Date("2026-01-05T06:00:00Z"));
    await world.prisma.paramValue.createMany({
      data: [
        {
          id: uuidv7(),
          key: "work.start",
          value: "10:00",
          createdByStaffId: requester.id,
          createdAt: world.sample.clock.now(),
          effectiveAt: new Date("2026-01-05T04:00:00.002Z"),
        },
        {
          id: uuidv7(),
          key: "work.end",
          value: "11:00",
          createdByStaffId: requester.id,
          createdAt: world.sample.clock.now(),
          effectiveAt: new Date("2026-01-05T04:00:00.002Z"),
        },
      ],
    });
    world.sample.clock.advance(3);
    const event = await changedDay("2026-01-05", false);
    await world.sample.tx.run((tx) => onApprovalCalendarImported(tx, deps, event));
    const revised = await world.prisma.approvalRequest.findUniqueOrThrow({ where: { id: row.id } });
    // 原09:00–18:00工时：下一个工作日09:00起算120分钟，11:00到期。
    expect(revised.dueAt).toEqual(new Date("2026-01-06T03:00:00Z"));
    expect(revised.slaSnapshot).toMatchObject({ amount: 120, unit: "work_minutes" });
    await healthy();
    await world.sample.tx.run((tx) => approval.withdraw(tx, system, { approvalId: row.id }));
    await changedDay("2026-01-05", true);
  });

  it("连续导入时旧事件无副作用，最新批次仍补齐未消费的窗口更正", T, async () => {
    const row = await submit(await world.merchant());
    const older = await changedDay("2026-01-06", false);
    const latest = await changedDay("2026-03-02", true);
    await world.sample.tx.run((tx) => onApprovalCalendarImported(tx, deps, older));
    expect(
      (await world.prisma.approvalRequest.findUniqueOrThrow({ where: { id: row.id } })).dueAt,
    ).toEqual(row.dueAt);
    await world.sample.tx.run((tx) => onApprovalCalendarImported(tx, deps, latest));
    const recomputed = await world.prisma.approvalRequest.findUniqueOrThrow({
      where: { id: row.id },
    });
    expect(recomputed.dueAt!.getTime()).toBeGreaterThan(row.dueAt!.getTime());
    expect(recomputed.slaSnapshot).toMatchObject({
      calendarVersion: latest.payload.calendarVersion,
    });
    await healthy();
    await world.sample.tx.run((tx) => approval.withdraw(tx, system, { approvalId: row.id }));
    await changedDay("2026-01-06", true);
  });

  it("日历重算与决定并发后不会复活timer", T, async () => {
    for (let attempt = 0; attempt < 6; attempt++) {
      const row = await submit(await world.merchant());
      const event = await changedDay("2026-01-06", false);
      await Promise.all([
        world.sample.tx.run((tx) => onApprovalCalendarImported(tx, deps, event)),
        world.sample.tx.run((tx) => approval.approve(tx, system, { approvalId: row.id })),
      ]);
      expect(
        (await world.prisma.approvalRequest.findUniqueOrThrow({ where: { id: row.id } })).status,
      ).toBe("approved");
      expect(
        (await timers(row.id)).filter((timer) =>
          ["scheduled", "dispatched"].includes(timer.status),
        ),
      ).toHaveLength(0);
      await changedDay("2026-01-06", true);
    }
    await healthy();
  });

  it("sla.breach当前事实与时刻守卫，事件去重；已决定/旧时刻不再发", T, async () => {
    const row = await submit(await world.merchant());
    const timer = (await timers(row.id))[0]!;
    await world.prisma.timer.update({
      where: { id: timer.id },
      data: { status: "dispatched", leaseUntil: new Date("2030-01-01T00:00:00Z"), dispatchNo: 1 },
    });
    const input = {
      id: timer.id,
      kind: timer.kind,
      subjectType: timer.subjectType,
      subjectId: timer.subjectId,
      payload: timer.payload as Record<string, unknown>,
    };
    expect(await world.sample.tx.run((tx) => handleApprovalSlaBreach(tx, deps, input))).toBe(
      "skipped",
    );
    world.sample.clock.set(row.dueAt!);
    expect(await world.sample.tx.run((tx) => handleApprovalSlaBreach(tx, deps, input))).toBe(
      "fired",
    );
    expect(await world.sample.tx.run((tx) => handleApprovalSlaBreach(tx, deps, input))).toBe(
      "fired",
    );
    expect(
      await world.prisma.outboxEvent.count({ where: { dedupeKey: `tmr:${timer.dedupeKey}` } }),
    ).toBe(1);
    await world.prisma.timer.update({
      where: { id: timer.id },
      data: { status: "fired", firedAt: world.sample.clock.now(), leaseUntil: null },
    });
    await healthy();
    await world.sample.tx.run((tx) => approval.approve(tx, system, { approvalId: row.id }));
    expect(await world.sample.tx.run((tx) => handleApprovalSlaBreach(tx, deps, input))).toBe(
      "skipped",
    );
  });

  it("已触发后日历延期创建新批次timer、同态历史留痕，旧派发不发新事件", T, async () => {
    const row = await submit(await world.merchant());
    const previous = (await timers(row.id))[0]!;
    await world.prisma.timer.update({
      where: { id: previous.id },
      data: {
        status: "dispatched",
        leaseUntil: new Date("2030-01-01T00:00:00Z"),
        dispatchNo: 1,
      },
    });
    world.sample.clock.set(row.dueAt!);
    const runner = {
      tx: world.sample.tx,
      assembly: world.sample.assembly,
      registry: createTimers({ assembly: world.sample.assembly }).registry,
      clock: world.sample.clock,
      alerts: alertsOf(world.sample.assembly),
    };
    expect(
      await runTimer(runner, { timerId: previous.id, dispatchNo: 1, kind: "sla.breach" }),
    ).toBe("fired");
    const event = await changedDay("2026-01-05", false);
    await world.sample.tx.run((tx) => onApprovalCalendarImported(tx, deps, event));
    const revised = await world.prisma.approvalRequest.findUniqueOrThrow({ where: { id: row.id } });
    expect(revised.dueAt!.getTime()).toBeGreaterThan(world.sample.clock.now().getTime());
    const currentTimers = await timers(row.id);
    expect(currentTimers).toContainEqual(
      expect.objectContaining({ id: previous.id, status: "fired" }),
    );
    expect(currentTimers.filter((timer) => timer.status === "scheduled")).toEqual([
      expect.objectContaining({
        dedupeKey: decisionTimerKey(row.id, event.payload.calendarVersion),
        fireAt: revised.dueAt,
      }),
    ]);
    expect(
      await world.prisma.statusTransition.findMany({
        where: { subjectId: row.id, event: "sla.recalculated" },
      }),
    ).toEqual([expect.objectContaining({ fromState: "pending", toState: "pending" })]);
    const eventCount = await world.prisma.outboxEvent.count({
      where: { aggregateId: row.id, eventType: "approval.sla_breached" },
    });
    // 延迟队列即使仍携带旧派发序号也只得到stale，不会再运行旧批次。
    expect(
      await runTimer(runner, { timerId: previous.id, dispatchNo: 1, kind: "sla.breach" }),
    ).toBe("stale");
    expect(
      await world.prisma.outboxEvent.count({
        where: { aggregateId: row.id, eventType: "approval.sla_breached" },
      }),
    ).toBe(eventCount);
    await world.sample.tx.run((tx) => onApprovalCalendarImported(tx, deps, event));
    expect(await timers(row.id)).toHaveLength(2);
    await healthy();
    await world.sample.tx.run((tx) => approval.withdraw(tx, system, { approvalId: row.id }));
    await changedDay("2026-01-05", true);
  });

  it("超期列表/summary按实际due快照，无时限审批仍用升级工作日，只读零写入", T, async () => {
    const merchant = await world.merchant();
    const timed = await submit(merchant);
    const untimed = await submit(merchant, "points_adjust");
    const reviewer = await world.person({ role: "super_admin" });
    world.sample.clock.set(new Date(timed.dueAt!.getTime() + 1));
    const before = [
      await world.prisma.auditLog.count(),
      await world.prisma.outboxEvent.count(),
      await world.prisma.timer.count(),
    ];
    const query = ApprovalListQuerySchema.parse({
      tab: "all",
      entityId: merchant.entityId,
      overdue: "true",
    });
    const overdue = await world.sample.tx.run((tx) => approval.list(tx, reviewer.staff, query));
    expect(overdue.items.map((item) => item.approvalId)).toEqual([timed.id]);
    expect(overdue.items[0]!.badges).toContain("overdue");
    const summary = await world.sample.tx.run((tx) =>
      approval.summary(tx, reviewer.staff, { entityId: merchant.entityId }),
    );
    expect(summary.total.overdue).toBe(1);
    world.sample.clock.set(new Date("2026-01-20T04:00:00Z"));
    const upgraded = await world.sample.tx.run((tx) => approval.list(tx, reviewer.staff, query));
    expect(upgraded.items.map((item) => item.approvalId).sort()).toEqual(
      [timed.id, untimed.id].sort(),
    );
    expect([
      await world.prisma.auditLog.count(),
      await world.prisma.outboxEvent.count(),
      await world.prisma.timer.count(),
    ]).toEqual(before);
    await healthy();
  });

  it("I3缺timer/污染载荷与未登记执行来源、I5错due/坏快照都报告", T, async () => {
    const row = await submit(await world.merchant());
    const timer = (await timers(row.id))[0]!;
    await world.prisma.timer.update({ where: { id: timer.id }, data: { status: "cancelled" } });
    expect(
      await world.sample.tx.run((tx) =>
        findI3Violations(tx, world.sample.clock.now(), approval.kinds),
      ),
    ).toContainEqual(
      expect.objectContaining({
        detail: expect.objectContaining({ problem: "decision_timer_count" }),
      }),
    );
    await world.prisma.timer.update({
      where: { id: timer.id },
      data: { status: "scheduled", payload: { purpose: "decision" } },
    });
    expect(
      await world.sample.tx.run((tx) =>
        findI3Violations(tx, world.sample.clock.now(), approval.kinds),
      ),
    ).toContainEqual(
      expect.objectContaining({
        detail: expect.objectContaining({ problem: "decision_timer_snapshot" }),
      }),
    );
    await world.prisma.timer.update({
      where: { id: timer.id },
      data: { payload: timer.payload as Prisma.InputJsonValue },
    });
    await world.prisma.approvalRequest.update({
      where: { id: row.id },
      data: { dueAt: new Date(row.dueAt!.getTime() + 86_400_000) },
    });
    expect(
      await world.sample.tx.run((tx) => findI5Violations(tx, world.sample.clock.now())),
    ).toContainEqual(
      expect.objectContaining({
        detail: expect.objectContaining({ problem: "decision_due_mismatch" }),
      }),
    );
    await world.prisma.approvalRequest.update({
      where: { id: row.id },
      data: { dueAt: row.dueAt, slaSnapshot: { amount: "broken" } },
    });
    expect(
      await world.sample.tx.run((tx) => findI5Violations(tx, world.sample.clock.now())),
    ).toContainEqual(
      expect.objectContaining({
        detail: expect.objectContaining({ problem: "decision_sla_snapshot" }),
      }),
    );
    await world.prisma.approvalRequest.update({
      where: { id: row.id },
      data: { slaSnapshot: row.slaSnapshot as Prisma.InputJsonValue },
    });
    const fake = await world.prisma.timer.create({
      data: {
        id: uuidv7(),
        kind: "sla.breach",
        subjectType: "approval_request",
        subjectId: row.id,
        dedupeKey: executionTimerKey(row.id),
        fireAt: row.dueAt!,
        payload: { purpose: "execution" },
      },
    });
    expect(
      await world.sample.tx.run((tx) =>
        findI3Violations(tx, world.sample.clock.now(), approval.kinds),
      ),
    ).toContainEqual(
      expect.objectContaining({
        detail: expect.objectContaining({ problem: "execution_source_missing" }),
      }),
    );
    await world.prisma.timer.update({ where: { id: fake.id }, data: { status: "cancelled" } });
    await healthy();
  });
  it("P2 窗口外更正真实消费后不掩盖I5截止时间污染", T, async () => {
    const row = await submit(await world.merchant());
    const event = await changedDay("2026-01-20", false);
    try {
      await consumeCalendar(event);
      const unchanged = await world.prisma.approvalRequest.findUniqueOrThrow({
        where: { id: row.id },
      });
      expect(unchanged).toMatchObject({ dueAt: row.dueAt, slaSnapshot: row.slaSnapshot });
      await healthy();
      const polluted = new Date(row.dueAt!.getTime() + 3_600_000);
      expect(polluted.getTime()).toBeLessThan(new Date("2026-01-20").getTime());
      await world.prisma.approvalRequest.update({
        where: { id: row.id },
        data: { dueAt: polluted },
      });
      expect(
        await world.sample.tx.run((tx) => findI5Violations(tx, world.sample.clock.now())),
      ).toContainEqual(
        expect.objectContaining({
          subject: { type: "approval_request", id: row.id },
          detail: expect.objectContaining({
            problem: "decision_due_mismatch",
            expected: row.dueAt!.toISOString(),
            actual: polluted.toISOString(),
          }),
        }),
      );
    } finally {
      await world.prisma.approvalRequest.update({
        where: { id: row.id },
        data: { dueAt: row.dueAt },
      });
      await consumeCalendar(await changedDay("2026-01-20", true));
      await healthy();
    }
  });

  it("P2 窗口内日历更正在途仍豁免，真实消费后I3I5健康", T, async () => {
    const row = await submit(await world.merchant());
    const event = await changedDay("2026-01-06", false);
    try {
      expect(
        (await world.prisma.approvalRequest.findUniqueOrThrow({ where: { id: row.id } }))
          .slaSnapshot,
      ).toEqual(row.slaSnapshot);
      expect(
        await world.sample.tx.run((tx) => findI5Violations(tx, world.sample.clock.now())),
      ).toEqual([]);
      await consumeCalendar(event);
      const recomputed = await world.prisma.approvalRequest.findUniqueOrThrow({
        where: { id: row.id },
      });
      expect(recomputed.dueAt!.getTime()).toBeGreaterThan(row.dueAt!.getTime());
      expect(recomputed.slaSnapshot).toMatchObject({
        calendarVersion: event.payload.calendarVersion,
      });
      await healthy();
    } finally {
      await consumeCalendar(await changedDay("2026-01-06", true));
      await healthy();
    }
  });
});
