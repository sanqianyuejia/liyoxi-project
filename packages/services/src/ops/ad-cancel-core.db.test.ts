import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AdPricingSnapshotSchema } from "@liyoxi/contract";
import type { AdCancelCoreSubmitBody } from "@liyoxi/contract";
import type { Prisma } from "@liyoxi/db";
import { createPrismaClient } from "@liyoxi/db";
import { testDatabaseUrl } from "@liyoxi/db/testing/standalone";
import { createApproval, approvalKindPort } from "../approval/index.js";
import { ownTaskScope, SYSTEM_SCOPE } from "../authz/index.js";
import { requiresStepUp } from "../authz/index.js";
import { createFlow } from "../flow/index.js";
import { createBizNoIssuer, createIdentityContext, lockRows, uuidv7 } from "../kernel/index.js";
import {
  createAdCancel,
  executeCancel,
  prelockAdCancelTargets,
  quoteAdCancel,
  readAdCancelTargetGraph,
  submitAdCancel,
  withdrawAdCancel,
  bindOrder,
  boundOrder,
} from "../order/index.js";
import type { Tx } from "../kernel/index.js";
import type { CancelActor, CancelDeps } from "../order/index.js";
import { entityAdCancelClosePort } from "../tenant/index.js";
import type { EntityAdCancelCloser, EntityAdCancelClosePlan } from "../tenant/index.js";
import { createSla } from "../sla/index.js";
import { createAdCancelApprovalRefCompanion } from "../support/index.js";
import { createTimers, timerKey } from "../timers/index.js";
import type { TimerRef } from "../timers/index.js";
import {
  assembleForTest,
  assertSnapshotsEqual,
  createFakeProviders,
  createLedgerHarness,
  holdDrama,
  joinLedger,
  openTerm,
  prepareOrderDrama,
  sampleStaffContext,
  snapshotTables,
  useSeededDatabase,
} from "../testing/index.js";
import { buildWorkerServices } from "./worker.js";

const db = useSeededDatabase("services", { label: "adcancel", max: 4 });
let h: ReturnType<typeof createLedgerHarness>;
let sequence = 0;
const ownedWorkers: ReturnType<typeof buildWorkerServices>[] = [];
const tables = [
  "billing_account",
  "point_lot",
  "point_hold",
  "point_hold_alloc",
  "ledger_operation",
  "point_ledger_entry",
  "approval_request",
  "cancel_request",
  "cancel_request_line",
  "ad",
  "outbox_event",
  "timer",
  "status_transition",
  "audit_log",
  "delivery_ticket_pause",
  "service_ticket_ref",
];
beforeAll(async () => {
  h = createLedgerHarness(await db.prisma());
}, 120_000);
afterAll(async () => {
  for (const worker of ownedWorkers.reverse()) {
    worker.closeApproval?.();
    await worker.shutdownMediaJobs?.();
    worker.closeMediaJobs?.();
    await worker.closeDocs();
    await worker.documentConverter?.close();
    await worker.closeNotify();
    await worker.closeAnalytics?.();
    await worker.closeStaff?.();
    await worker.closeSmsHealth?.();
    await worker.closeAlertFacts?.();
    worker.closeOrder?.();
    worker.closeBillingTimers?.();
    worker.closePublish?.();
    worker.closeDelivery?.();
    worker.closeWebhooks?.();
    await worker.closeMediaDrivers?.();
    await worker.closeStorageDrivers?.();
  }
});
function deps(overrides: Partial<CancelDeps> = {}): CancelDeps {
  const assembly = assembleForTest({ entry: "api" });
  const events = overrides.events ?? h.events;
  const flow = createFlow({ assembly, clock: h.clock, events });
  const timers = createTimers({ assembly }),
    sla = createSla({ assembly, clock: h.clock });
  const approval = createApproval({
    assembly,
    clock: h.clock,
    flow,
    events,
    timers,
    sla,
    bizNo: createBizNoIssuer({ clock: h.clock, appEnv: "test" }),
  });
  return {
    tx: h.tx,
    clock: h.clock,
    approval,
    flow,
    ledger: h.ledger,
    events,
    timers,
    sla,
    ...overrides,
  };
}
async function person(role: "super_admin" | "publisher" = "super_admin"): Promise<CancelActor> {
  const group = await h.prisma.staffGroup.findFirstOrThrow({
    where: { staffRoleKey: role, isDefault: true },
  });
  const row = await h.make.staff({ staffRoleKey: role, staffGroupId: group.id, isLead: true });
  return {
    ctx: createIdentityContext({ actor: { type: "staff", id: row.id, client: "admin" } }),
    staff: await sampleStaffContext(h.prisma, row.id, { stepUpAt: h.clock.now() }),
  };
}
async function fresh(actor: CancelActor): Promise<CancelActor> {
  return {
    ...actor,
    staff: await sampleStaffContext(h.prisma, actor.staff!.staff.id, { stepUpAt: h.clock.now() }),
  };
}
async function param(key: string, value: Prisma.InputJsonValue, staffId: string) {
  h.clock.advance(1);
  return h.prisma.paramValue.create({
    data: {
      id: uuidv7(),
      key,
      value,
      effectiveAt: h.clock.now(),
      createdAt: h.clock.now(),
      createdByStaffId: staffId,
      reason: "广告取消集成夹具",
    },
  });
}
async function billingParam(key: string, value: Prisma.InputJsonValue) {
  h.clock.advance(1);
  return h.prisma.billingParam.create({
    data: {
      id: uuidv7(),
      key,
      value,
      effectiveAt: h.clock.now(),
      changeId: uuidv7(),
      createdAt: h.clock.now(),
    },
  });
}
const ratios = (adInProduction: number) => ({
  planConfirm: 3000,
  adAndSample: 3000,
  samplePending: 5000,
  postSample: null,
  adInProduction,
});
type Reason = AdCancelCoreSubmitBody["reasonCode"];
type CancelTenantFixture = {
  merchant: Awaited<ReturnType<ReturnType<typeof createLedgerHarness>["make"]["merchant"]>>;
  term: Awaited<ReturnType<typeof openTerm>>["term"];
};
async function fixture(
  options: {
    status?: string;
    returnedFrom?: string;
    ratioBp?: number;
    reasonCode?: Reason;
    tenant?: CancelTenantFixture;
  } = {},
) {
  h.clock.set(new Date(Date.parse("2026-01-05T04:00:00.000Z") + ++sequence * 60_000));
  const requester = await person(),
    approver = await person(),
    executor = await person();
  await param("refund.points.auto_approve_before_production", false, requester.staff!.staff.id);
  await param("refund.require_distinct_executor", false, requester.staff!.staff.id);
  await billingParam("cancelDeductionBp", ratios(options.ratioBp ?? 3000));
  await billingParam("expiredTermRefund", {
    merchant: "forfeit",
    platform: "addon",
    qualification: "addon",
  });
  const merchant = options.tenant?.merchant ?? (await h.make.merchant({ verified: true }));
  const { term } = options.tenant ?? (await openTerm(h, { entityId: merchant.entity.id }));
  const id = uuidv7(),
    now = h.clock.now(),
    adNo = `GG20260105${String(sequence).padStart(5, "0")}`;
  const ctx = createIdentityContext({
    actor: { type: "system", job: "lyxtest.ad_fixture" },
    entityId: merchant.entity.id,
  });
  // M5 has no ad producer yet. Only this upstream ad fixture is inserted; all cancellation rows use the real service.
  const held = await h.tx.run((tx) =>
    h.ledger.hold(tx, {
      entityId: merchant.entity.id,
      storeId: merchant.store.id,
      refType: "ad",
      refId: id,
      pricing: { kind: "ad" },
      title: { code: "ad_hold", args: { adNo, unitPoints: 50, discountBp: term.discountBp } },
      ctx,
    }),
  );
  const pricing = AdPricingSnapshotSchema.parse(held.snapshot),
    status = options.status ?? "pending_assign";
  const captured =
    status !== "pending_assign" &&
    !(status === "returned" && options.returnedFrom === "pending_assign");
  if (captured)
    await h.tx.run((tx) =>
      h.ledger.capture(tx, {
        pointHoldId: held.pointHoldId,
        title: { refType: "ad", refNo: adNo, count: 1 },
        ctx,
      }),
    );
  const hold = await h.prisma.pointHold.findUniqueOrThrow({ where: { id: held.pointHoldId } });
  const editor = captured ? await h.make.staff({ staffRoleKey: "editor" }) : null;
  const consent = await h.make.agreementConsent({
    scene: "ad_request",
    merchantUserId: merchant.user.id,
    entityId: merchant.entity.id,
    storeId: merchant.store.id,
    bizId: id,
  });
  const ad = await h.prisma.ad.create({
    data: {
      id,
      adNo,
      entityId: merchant.entity.id,
      storeId: merchant.store.id,
      requestedByUserId: merchant.user.id,
      type: "opening",
      durationSec: 3,
      promoPointCodes: ["TEST"],
      status,
      returnedFrom: options.returnedFrom ?? null,
      ...(status === "returned" ? { returnedAt: now, returnReason: "商家补充素材" } : {}),
      ...(status === "confirmed"
        ? { confirmedAt: now, confirmedVersionNo: 1, latestVersionNo: 1 }
        : {}),
      ...(status === "pending_confirm" ? { latestVersionNo: 1 } : {}),
      unitPricePoints: pricing.unitPoints,
      discountBp: pricing.discountBp,
      chargePoints: held.points,
      pricingSnapshot: held.snapshot,
      pointHoldId: held.pointHoldId,
      capturedAt: hold.capturedAt,
      editorId: editor?.id ?? null,
      freeRevisionQuota: pricing.freeRevisions,
      agreementConsentId: consent.id,
      submittedAt: now,
      firstDueAt: now,
      createdAt: now,
      updatedAt: now,
    },
  });
  const q = await h.tx.run((tx) =>
    quoteAdCancel(
      tx,
      {
        scope: SYSTEM_SCOPE,
        adId: ad.id,
        body: { reasonCode: options.reasonCode ?? "merchant_request" },
      },
      h.clock.now(),
    ),
  );
  const body: AdCancelCoreSubmitBody = {
    reasonCode: options.reasonCode ?? "merchant_request",
    note: "商家申请取消广告制作",
    expect: q.expect,
  };
  const d = deps();
  return {
    ad,
    merchant,
    term,
    requester,
    approver,
    executor,
    body,
    q,
    deps: d,
    service: createAdCancel(d),
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function boundItem(f: Fixture) {
  const order = await h.make.dramaOrder({
    entityId: f.ad.entityId,
    storeId: f.ad.storeId,
    subscriptionTermId: f.term.id,
  });
  const drama = await prepareOrderDrama(h, 100);
  const held = await holdDrama(h, {
    entityId: f.ad.entityId,
    storeId: f.ad.storeId,
    dramaId: drama.id,
  });
  const item = await h.make.orderItem({
    id: held.refId,
    dramaOrderId: order.id,
    dramaId: drama.id,
    pointHoldId: held.pointHoldId,
    chargePoints: held.points,
    pricingSnapshot: held.snapshot,
  });
  return { order, item };
}
type Request = Awaited<ReturnType<ReturnType<typeof createAdCancel>["submit"]>>;
const submit = (f: Fixture) => f.service.submit(f.requester, f.ad.id, f.body);
const confirm = (r: Request) => ({
  requestNo: r.approvalRequest.requestNo!,
  totalRefundPoints: r.totalRefundPoints,
});
const approve = (f: Fixture, r: Request) =>
  f.service.approve(f.approver, r.id, {
    lockVersion: r.approvalRequest.lockVersion,
    confirm: confirm(r),
    confirmChecks: ["stage_rule_amount_checked"],
  });
const execute = (f: Fixture, r: Request) =>
  f.service.execute(f.executor, r.id, {
    confirm: confirm(r),
    confirmChecks: ["order_points_checked"],
  });
const req = (id: string) =>
  h.prisma.cancelRequest.findUniqueOrThrow({
    where: { id },
    include: { approvalRequest: true, cancelRequestLines: true },
  });
const adNow = (f: Fixture) => h.prisma.ad.findUniqueOrThrow({ where: { id: f.ad.id } });
const holdNow = (f: Fixture) =>
  h.prisma.pointHold.findUniqueOrThrow({ where: { id: f.ad.pointHoldId } });
async function observe(f: Fixture) {
  return {
    ad: await adNow(f),
    hold: await holdNow(f),
    account: await h.prisma.billingAccount.findUniqueOrThrow({
      where: { entityId: f.ad.entityId },
    }),
    lots: await h.prisma.pointLot.findMany({
      where: { entityId: f.ad.entityId },
      orderBy: { id: "asc" },
    }),
    operations: await h.prisma.ledgerOperation.findMany({
      where: { entityId: f.ad.entityId },
      orderBy: { id: "asc" },
    }),
    requests: await h.prisma.cancelRequest.findMany({
      where: { entityId: f.ad.entityId },
      orderBy: { id: "asc" },
      include: { approvalRequest: true, cancelRequestLines: true },
    }),
    events: await h.prisma.outboxEvent.findMany({
      where: { entityId: f.ad.entityId },
      orderBy: { id: "asc" },
    }),
    timers: await h.prisma.timer.findMany({
      where: { entityId: f.ad.entityId },
      orderBy: { id: "asc" },
    }),
    transitions: await h.prisma.statusTransition.findMany({
      where: { subjectId: f.ad.id },
      orderBy: { id: "asc" },
    }),
  };
}
async function historyRef(f: Fixture, r: Request) {
  const id = uuidv7(),
    now = h.clock.now();
  await h.prisma.serviceTicket.create({
    data: {
      id,
      ticketNo: `KF20260105${String(++sequence).padStart(5, "0")}`,
      entityId: f.ad.entityId,
      storeId: f.ad.storeId,
      source: "weapp",
      submitterUserId: f.merchant.user.id,
      typeCode: "K01",
      priority: "mid",
      description: "取消申请历史关联",
      status: "pending",
      solutionDueAt: new Date(now.getTime() + 86_400_000),
      slaSnapshot: { solution: {} },
      createdAt: now,
      updatedAt: now,
    },
  });
  return h.prisma.serviceTicketRef.create({
    data: {
      serviceTicketId: id,
      refType: "approval_request",
      refId: r.approvalRequestId,
      createdAt: now,
    },
  });
}
async function expectClosed(f: Fixture, r: Request, reason: "rejected" | "withdrawn" | "voided") {
  const row = await req(r.id);
  expect(row).toMatchObject({ status: "not_executed", closeReason: reason, executedAt: null });
  expect(row.closedAt).not.toBeNull();
  expect((await adNow(f)).openCancelRequestId).toBeNull();
  expect((await holdNow(f)).status).toBe(f.ad.capturedAt ? "captured" : "held");
  expect(
    await h.prisma.timer.count({
      where: {
        subjectId: r.approvalRequestId,
        status: { in: ["scheduled", "dispatched"] },
        kind: "sla.breach",
      },
    }),
  ).toBe(0);
  expect(
    await h.prisma.serviceTicketRef.count({
      where: { refType: "approval_request", refId: r.approvalRequestId },
    }),
  ).toBe(1);
}
async function afterExpiry(f: Fixture) {
  h.clock.set(new Date(f.term.endsAt.getTime() + 1));
  f.approver = await fresh(f.approver);
  f.executor = await fresh(f.executor);
}

it.each([
  ["pending_assign", undefined, "release", "09:808"],
  ["returned", "pending_assign", "release", "09:808"],
  ["producing", undefined, "refund", "09:809"],
  ["revising", undefined, "refund", "09:809"],
  ["pending_confirm", undefined, "refund", "09:809"],
  ["returned", "producing", "refund", "09:809"],
] as const)(
  "真实 %s/%s 经批准执行 %s，按正式行 %s 留痕",
  async (status, returnedFrom, mode, ref) => {
    const f = await fixture({ status, ...(returnedFrom ? { returnedFrom } : {}) });
    const selected: string[] = [],
      original = f.deps.flow;
    f.service = createAdCancel({
      ...f.deps,
      flow: {
        ...original,
        transition: async (...args: Parameters<typeof original.transition>) => {
          const result = await original.transition(...args);
          if (args[2].machine === "ad") selected.push(result.ref);
          return result;
        },
      },
    });
    const r = await submit(f);
    expect((await req(r.id)).cancelRequestLines[0]).toMatchObject({
      mode,
      targetType: "ad",
      targetId: f.ad.id,
    });
    const approved = await approve(f, r),
      out = await execute(f, approved),
      row = await req(r.id);
    expect(out.status).toBe("done");
    expect(row).toMatchObject({
      executedByStaffId: f.executor.staff!.staff.id,
      isExecutedBySystem: false,
      execConfirmChecks: ["order_points_checked"],
    });
    expect(row.executedAt).toEqual(row.closedAt);
    expect(row.cancelRequestLines[0]).toMatchObject({
      returnedPoints: r.totalRefundPoints,
      convertedPoints: 0,
      forfeitedPoints: 0,
    });
    expect(await adNow(f)).toMatchObject({
      status: "cancelled",
      openCancelRequestId: null,
      cancelReasonCode: "merchant_request",
      refundRequestedPoints: r.totalRefundPoints,
      returnedPoints: r.totalRefundPoints,
      convertedPoints: 0,
      forfeitedPoints: 0,
    });
    expect(
      await h.prisma.statusTransition.findFirst({
        where: { subjectId: f.ad.id, event: "ad.cancel" },
      }),
    ).toMatchObject({ fromState: status, toState: "cancelled" });
    expect(selected).toEqual([ref]);
    const event = await h.prisma.outboxEvent.findFirstOrThrow({
      where: { eventType: "ad.cancelled", aggregateId: f.ad.id },
    });
    expect(event.payload).toMatchObject({
      returnedPoints: r.totalRefundPoints,
      forfeitedPoints: 0,
      fromState: status,
    });
  },
);

describe("真实广告取消写链", () => {
  it("提交产生真实审批、唯一明细和自有指针，广告状态与账本保持提交前事实", async () => {
    const f = await fixture(),
      before = await holdNow(f),
      r = await submit(f),
      row = await req(r.id);
    expect(row).toMatchObject({
      kind: "ad_cancel",
      status: "pending_approval",
      lineCount: 1,
      execDueAt: null,
      slaSnapshot: null,
    });
    expect(row.approvalRequest).toMatchObject({
      kind: "ad_cancel",
      category: "approval",
      subjectType: "ad",
      subjectId: f.ad.id,
      requesterStaffId: f.requester.staff!.staff.id,
      status: "pending",
      dedupeKey: null,
    });
    expect(row.approvalRequest.summarySnapshot).toMatchObject({
      points: r.totalRefundPoints,
      domain: { type: "cancel_request", id: r.id },
    });
    expect(await holdNow(f)).toEqual(before);
    expect(await adNow(f)).toMatchObject({ status: f.ad.status, openCancelRequestId: r.id });
    expect(await h.prisma.deliveryTicketPause.count()).toBe(0);
    expect(
      await h.prisma.outboxEvent.count({
        where: { eventType: "cancel.submitted", aggregateId: r.id },
      }),
    ).toBe(1);
  });
  it("原核算快照优先于提交之后的新扣除比例", async () => {
    const f = await fixture({ status: "producing" });
    await billingParam("cancelDeductionBp", ratios(10000));
    const r = await submit(f),
      row = await req(r.id);
    expect(row.cancelRequestLines[0]).toMatchObject({
      ratioBp: 3000,
      refundPoints: f.q.totalRefundPoints,
    });
    expect((await execute(f, await approve(f, r))).status).toBe("done");
  });
  it("平台原因生产中扣除为零，使用真实账本全额退款", async () => {
    const f = await fixture({ status: "producing", reasonCode: "platform_fault" }),
      r = await submit(f);
    expect((await req(r.id)).cancelRequestLines[0]).toMatchObject({
      reasonClass: "platform",
      ratioBp: 0,
      deductPoints: 0,
    });
    await execute(f, await approve(f, r));
    expect(await adNow(f)).toMatchObject({
      returnedPoints: f.ad.chargePoints,
      convertedPoints: 0,
      forfeitedPoints: 0,
    });
    const confirmed = await fixture({ status: "confirmed" });
    await expect(submit(confirmed)).rejects.toMatchObject({
      error: "AD_NOT_CANCELLABLE",
      details: { reason: "ad_confirmed" },
    });
  });
  it("100%扣除只终止，不产生虚假的账本退回操作", async () => {
    const f = await fixture({ status: "producing", ratioBp: 10000 }),
      r = await submit(f);
    const before = await h.prisma.ledgerOperation.count({ where: { entityId: f.ad.entityId } });
    await execute(f, await approve(f, r));
    expect((await req(r.id)).cancelRequestLines[0]).toMatchObject({
      mode: "terminate_only",
      returnedPoints: 0,
      convertedPoints: 0,
      forfeitedPoints: 0,
    });
    expect(await h.prisma.ledgerOperation.count({ where: { entityId: f.ad.entityId } })).toBe(
      before,
    );
    expect((await holdNow(f)).status).toBe("captured");
  });
  it("单独付费修改冻结单不进入本次广告取消也不被退回", async () => {
    const f = await fixture({ status: "producing", reasonCode: "platform_fault" });
    const extra = await h.tx.run((tx) =>
      h.ledger.charge(tx, {
        entityId: f.ad.entityId,
        storeId: f.ad.storeId,
        refType: "ad_revision",
        refId: uuidv7(),
        pricing: { kind: "ad_revision" },
        title: {
          code: "ad_revision_charge",
          args: { adNo: f.ad.adNo, unitPoints: 50, discountBp: f.term.discountBp },
        },
        captureTitle: { refType: "ad_revision", refNo: f.ad.adNo, count: 1 },
        ctx: f.requester.ctx,
      }),
    );
    const before = await h.prisma.pointHold.findUniqueOrThrow({ where: { id: extra.pointHoldId } });
    const r = await submit(f);
    await execute(f, await approve(f, r));
    expect(
      await h.prisma.pointHold.findUniqueOrThrow({ where: { id: extra.pointHoldId } }),
    ).toEqual(before);
    expect((await req(r.id)).cancelRequestLines).toHaveLength(1);
  });
  it("原周期结束后的商家原因，实际三数量按账本不予退回结果保存", async () => {
    const f = await fixture({ status: "producing" });
    await afterExpiry(f);
    const r = await submit(f);
    await execute(f, await approve(f, r));
    expect((await req(r.id)).cancelRequestLines[0]).toMatchObject({
      returnedPoints: 0,
      convertedPoints: 0,
      forfeitedPoints: r.totalRefundPoints,
    });
    expect(await adNow(f)).toMatchObject({
      refundRequestedPoints: r.totalRefundPoints,
      returnedPoints: 0,
      convertedPoints: 0,
      forfeitedPoints: r.totalRefundPoints,
    });
    expect((await holdNow(f)).forfeitedQty).toBe(r.totalRefundPoints);
  });
  it("原周期结束后的平台原因转加购，广告事件回传实际到账合计", async () => {
    const f = await fixture({ status: "producing", reasonCode: "platform_fault" });
    await afterExpiry(f);
    const r = await submit(f);
    await execute(f, await approve(f, r));
    expect((await req(r.id)).cancelRequestLines[0]).toMatchObject({
      returnedPoints: 0,
      convertedPoints: r.totalRefundPoints,
      forfeitedPoints: 0,
    });
    expect(await adNow(f)).toMatchObject({
      returnedPoints: 0,
      convertedPoints: r.totalRefundPoints,
      forfeitedPoints: 0,
    });
    expect(
      (
        await h.prisma.outboxEvent.findFirstOrThrow({
          where: { eventType: "ad.cancelled", aggregateId: f.ad.id },
        })
      ).payload,
    ).toMatchObject({ returnedPoints: r.totalRefundPoints, forfeitedPoints: 0 });
  });
  it("本人撤回关闭真实审批与本申请指针，保留历史客服引用", async () => {
    const f = await fixture(),
      r = await submit(f);
    await historyRef(f, r);
    await f.service.withdraw(f.requester, r.id, {});
    await expectClosed(f, r, "withdrawn");
    expect((await req(r.id)).approvalRequest.status).toBe("withdrawn");
    const next = await submit(f);
    await expect(f.service.withdraw(f.requester, r.id, {})).rejects.toMatchObject({
      error: "APPROVAL_NOT_PENDING",
    });
    expect((await adNow(f)).openCancelRequestId).toBe(next.id);
  });
  it("驳回跳过stepup并只解除本申请，保留历史引用", async () => {
    const f = await fixture(),
      r = await submit(f);
    await historyRef(f, r);
    const actor = { ...f.approver, staff: { ...f.approver.staff!, stepUpAt: null } };
    await f.service.reject(actor, r.id, { note: "规则核对不通过" });
    await expectClosed(f, r, "rejected");
    expect((await req(r.id)).approvalRequest).toMatchObject({
      status: "rejected",
      decisionNote: "规则核对不通过",
    });
  });
  it("本人作废保留approved审批，关闭执行timer与自有指针", async () => {
    const f = await fixture(),
      r = await submit(f);
    await historyRef(f, r);
    await approve(f, r);
    await f.service.void(f.requester, r.id, { note: "商家决定继续制作" });
    await expectClosed(f, r, "voided");
    expect((await req(r.id)).approvalRequest.status).toBe("approved");
  });
  it("发起人已停用时真实财务可代撤，审批记录代撤事实", async () => {
    const f = await fixture(),
      r = await submit(f);
    await historyRef(f, r);
    await h.prisma.staff.update({
      where: { id: f.requester.staff!.staff.id },
      data: {
        status: "disabled",
        disabledAt: h.clock.now(),
        disabledReason: "other",
        disabledByStaffId: f.approver.staff!.staff.id,
      },
    });
    await f.service.withdraw(f.approver, r.id, { note: "申请人已停用，代为撤回" });
    await expectClosed(f, r, "withdrawn");
    expect((await req(r.id)).approvalRequest).toMatchObject({
      status: "withdrawn",
      isDecidedBySystem: false,
      decidedByStaffId: null,
    });
  });
  it("真实系统入口不能撤回仍然有效的广告申请", async () => {
    const f = await fixture(),
      r = await submit(f),
      before = await observe(f);
    const system = {
      ctx: createIdentityContext({ actor: { type: "system", job: "entity.close" } }),
    };
    await expect(f.service.withdraw(system, r.id, {})).rejects.toMatchObject({
      error: "APPROVAL_WITHDRAW_FORBIDDEN",
    });
    expect(await observe(f)).toEqual(before);
  });
  it("主体失效后系统实际代撤，全部关闭结果同事务并保存引用", async () => {
    const f = await fixture(),
      r = await submit(f);
    await historyRef(f, r);
    await h.prisma.entity.update({
      where: { id: f.ad.entityId },
      data: { lifecycle: "closed", closedAt: h.clock.now() },
    });
    const system = {
      ctx: createIdentityContext({ actor: { type: "system", job: "entity.close" } }),
    };
    await f.service.withdraw(system, r.id, { note: "主体已关闭" });
    await expectClosed(f, r, "withdrawn");
    expect((await req(r.id)).approvalRequest.isDecidedBySystem).toBe(true);
  });
  it("没有提交权限的真实员工不能创建取消申请", async () => {
    const f = await fixture(),
      publisher = await person("publisher"),
      before = await observe(f);
    await expect(f.service.submit(publisher, f.ad.id, f.body)).rejects.toMatchObject({
      error: "PERMISSION_DENIED",
    });
    expect(await observe(f)).toEqual(before);
  });
  it("范围外和不存在均返回404，不泄露已有申请与广告", async () => {
    const f = await fixture(),
      r = await submit(f);
    const actor = {
      ...f.approver,
      staff: { ...f.approver.staff!, scope: ownTaskScope(f.approver.staff!.staff) },
    };
    for (const id of [f.ad.id, uuidv7()])
      await expect(f.service.submit(actor, id, f.body)).rejects.toMatchObject({
        error: "NOT_FOUND",
      });
    for (const id of [r.id, uuidv7()])
      await expect(
        f.service.approve(actor, id, {
          lockVersion: 0,
          confirm: confirm(r),
          confirmChecks: ["stage_rule_amount_checked"],
        }),
      ).rejects.toMatchObject({ error: "NOT_FOUND" });
  });
  it("审批先拒绝本人和已决定状态，再触达回显与复核", async () => {
    const f = await fixture(),
      r = await submit(f);
    const body = {
      lockVersion: 999,
      confirm: { ...confirm(r), requestNo: "wrong" },
      confirmChecks: ["stage_rule_amount_checked"] as ["stage_rule_amount_checked"],
    };
    await expect(f.service.approve(f.requester, r.id, body)).rejects.toMatchObject({
      error: "APPROVAL_SELF_FORBIDDEN",
    });
    await f.service.reject(f.approver, r.id, { note: "申请说明不充分" });
    await expect(f.service.approve(f.approver, r.id, body)).rejects.toMatchObject({
      error: "APPROVAL_NOT_PENDING",
    });
  });
  it("审批再验证过期先拒绝，未进入任何业务迁移", async () => {
    const f = await fixture(),
      r = await submit(f),
      before = await observe(f);
    const actor = {
      ...f.approver,
      staff: { ...f.approver.staff!, stepUpAt: new Date(h.clock.now().getTime() - 600_001) },
    };
    await expect(
      f.service.approve(actor, r.id, {
        lockVersion: 0,
        confirm: confirm(r),
        confirmChecks: ["stage_rule_amount_checked"],
      }),
    ).rejects.toMatchObject({ error: "STEP_UP_REQUIRED" });
    expect(await observe(f)).toEqual(before);
  });
  it("锁版本冲突不会批准或提前清空广告指针", async () => {
    const f = await fixture(),
      r = await submit(f),
      before = await observe(f);
    await expect(
      f.service.approve(f.approver, r.id, {
        lockVersion: r.approvalRequest.lockVersion + 1,
        confirm: confirm(r),
        confirmChecks: ["stage_rule_amount_checked"],
      }),
    ).rejects.toMatchObject({ error: "VERSION_CONFLICT" });
    expect(await observe(f)).toEqual(before);
  });
  it("审批与执行都要求库中当前单号和预计退回合计的回显", async () => {
    const f = await fixture(),
      r = await submit(f);
    await expect(
      f.service.approve(f.approver, r.id, {
        lockVersion: r.approvalRequest.lockVersion,
        confirm: { ...confirm(r), totalRefundPoints: r.totalRefundPoints + 1 },
        confirmChecks: ["stage_rule_amount_checked"],
      }),
    ).rejects.toMatchObject({ error: "CONFIRM_MISMATCH" });
    const a = await approve(f, r),
      before = await observe(f);
    await expect(
      f.service.execute(f.executor, r.id, {
        confirm: { ...confirm(a), requestNo: "TKwrong" },
        confirmChecks: ["order_points_checked"],
      }),
    ).rejects.toMatchObject({ error: "CONFIRM_MISMATCH" });
    expect(await observe(f)).toEqual(before);
  });
  it("驳回未知或停用的字典原因会回滚并保留pending", async () => {
    const f = await fixture(),
      r = await submit(f);
    await h.prisma.dictItem.create({
      data: {
        id: uuidv7(),
        dictTypeKey: "reject_reason",
        code: "W210DISABLED",
        name: "已停用测试原因",
        isEnabled: false,
        position: 999,
        createdAt: h.clock.now(),
        updatedAt: h.clock.now(),
      },
    });
    const before = await observe(f);
    for (const code of ["W210UNKNOWN", "W210DISABLED"])
      await expect(
        f.service.reject(f.approver, r.id, { note: "真实字典守卫", reasonCodes: [code] }),
      ).rejects.toMatchObject({ error: "VALIDATION_FAILED" });
    expect(await observe(f)).toEqual(before);
  });
  it("执行权限和再验证均真实校验，pending_execution保持不变", async () => {
    const f = await fixture(),
      r = await approve(f, await submit(f)),
      publisher = await person("publisher"),
      before = await observe(f);
    await expect(
      f.service.execute(publisher, r.id, {
        confirm: confirm(r),
        confirmChecks: ["order_points_checked"],
      }),
    ).rejects.toMatchObject({ error: "PERMISSION_DENIED" });
    const actor = { ...f.executor, staff: { ...f.executor.staff!, stepUpAt: null } };
    await expect(
      f.service.execute(actor, r.id, {
        confirm: confirm(r),
        confirmChecks: ["order_points_checked"],
      }),
    ).rejects.toMatchObject({ error: "STEP_UP_REQUIRED" });
    expect(await observe(f)).toEqual(before);
  });
  it("职责分离开启时审批人不能执行，另一名真实员工可以执行", async () => {
    const f = await fixture(),
      r = await approve(f, await submit(f));
    await param("refund.require_distinct_executor", true, f.requester.staff!.staff.id);
    const before = await observe(f);
    await expect(
      f.service.execute(f.approver, r.id, {
        confirm: confirm(r),
        confirmChecks: ["order_points_checked"],
      }),
    ).rejects.toMatchObject({ error: "REFUND_EXECUTOR_CONFLICT" });
    expect(await observe(f)).toEqual(before);
    expect((await execute(f, r)).status).toBe("done");
  });
  it("试算零写入，错误expect返回真实新quote且不产生半申请", async () => {
    const f = await fixture(),
      before = await snapshotTables(h.prisma, tables);
    const q = await h.tx.run((tx) =>
      quoteAdCancel(
        tx,
        { scope: SYSTEM_SCOPE, adId: f.ad.id, body: { reasonCode: f.body.reasonCode } },
        h.clock.now(),
      ),
    );
    expect(q).toEqual(f.q);
    assertSnapshotsEqual(before, await snapshotTables(h.prisma, tables));
    await expect(
      f.service.submit(f.requester, f.ad.id, {
        ...f.body,
        expect: { totalRefundPoints: q.totalRefundPoints + 1 },
      }),
    ).rejects.toMatchObject({
      error: "CANCEL_QUOTE_CHANGED",
      details: { quote: { totalRefundPoints: q.totalRefundPoints } },
    });
    assertSnapshotsEqual(before, await snapshotTables(h.prisma, tables));
  });
  it("活跃广告位绑定阻止取消，关闭订单项的历史绑定原样保留", async () => {
    const f = await fixture();
    const { item } = await boundItem(f);
    const placement = await h.prisma.orderItemPlacement.create({
      data: {
        id: uuidv7(),
        orderItemId: item.id,
        slot: "opening",
        adId: f.ad.id,
        durationSec: f.ad.durationSec,
        createdAt: h.clock.now(),
        updatedAt: h.clock.now(),
      },
    });
    await expect(submit(f)).rejects.toMatchObject({
      error: "AD_NOT_CANCELLABLE",
      details: { reason: "ad_in_use", boundOrderItemIds: [item.id] },
    });
    await h.tx.run(async (tx) => {
      await lockRows(tx, "order_item", [item.id]);
      await h.ledger.release(tx, {
        pointHoldId: item.pointHoldId,
        reasonClass: "merchant",
        title: { refNo: f.ad.adNo, dramaTitles: [] },
        ctx: f.requester.ctx,
      });
      await tx.orderItem.update({
        where: { id: item.id },
        data: {
          phase: "cancelled",
          cancelledAt: h.clock.now(),
          cancelReasonCode: "merchant_request",
        },
      });
    });
    const r = await submit(f);
    await execute(f, await approve(f, r));
    expect(
      await h.prisma.orderItemPlacement.findUniqueOrThrow({ where: { id: placement.id } }),
    ).toEqual(placement);
    await expect(submit(f)).rejects.toMatchObject({
      error: "AD_NOT_CANCELLABLE",
      details: { reason: "ad_cancelled" },
    });
  });
  it("审批复核跨期变化先回滚，再独立保存失败log，状态与积分不变", async () => {
    const f = await fixture({ status: "producing" }),
      r = await submit(f);
    await afterExpiry(f);
    const before = await observe(f);
    await expect(approve(f, r)).rejects.toMatchObject({ error: "PRECONDITION_CHANGED" });
    const row = await req(r.id);
    expect(row).toMatchObject({
      status: "pending_approval",
      approvalRequest: { status: "pending" },
      recheckLog: { approve: { ok: false } },
    });
    expect(
      (row.recheckLog as { approve: { diffs: unknown[] } }).approve.diffs.length,
    ).toBeGreaterThan(0);
    const after = await observe(f);
    expect(after.hold).toEqual(before.hold);
    expect(after.account).toEqual(before.account);
    expect(after.events).toEqual(before.events);
    expect(after.ad).toEqual(before.ad);
  });
  it("执行复核跨期变化保存独立失败log并保留执行timer", async () => {
    const f = await fixture({ status: "producing" }),
      r = await approve(f, await submit(f));
    await afterExpiry(f);
    const before = await observe(f);
    await expect(execute(f, r)).rejects.toMatchObject({ error: "PRECONDITION_CHANGED" });
    expect(await req(r.id)).toMatchObject({
      status: "pending_execution",
      approvalRequest: { status: "approved" },
      recheckLog: { execute: { ok: false } },
      executedAt: null,
    });
    const after = await observe(f);
    expect(after.hold).toEqual(before.hold);
    expect(after.account).toEqual(before.account);
    expect(after.events).toEqual(before.events);
    expect(after.timers).toEqual(before.timers);
  });
  it("原周期全额释放命中自动开关，真实系统审批与执行同事务完成", async () => {
    const f = await fixture();
    await param("refund.points.auto_approve_before_production", true, f.requester.staff!.staff.id);
    const r = await submit(f),
      row = await req(r.id);
    expect(row).toMatchObject({
      status: "done",
      isExecutedBySystem: true,
      executedByStaffId: null,
      approvalRequest: { status: "approved", isDecidedBySystem: true, decidedByStaffId: null },
    });
    expect(row.cancelRequestLines[0]).toMatchObject({
      returnedPoints: r.totalRefundPoints,
      convertedPoints: 0,
      forfeitedPoints: 0,
    });
    expect((await adNow(f)).status).toBe("cancelled");
    expect(
      (
        await h.prisma.outboxEvent.findFirstOrThrow({
          where: { eventType: "cancel.executed", aggregateId: r.id },
        })
      ).payload,
    ).toMatchObject({
      isAutoExecuted: true,
      fromState: "pending_approval",
      transition: "cancel.auto_execute",
    });
    expect(
      await h.prisma.outboxEvent.count({
        where: { eventType: "approval.executed", aggregateId: r.approvalRequestId },
      }),
    ).toBe(1);
  });
  it("生产中即使平台全额退回也不能命中自动释放", async () => {
    const f = await fixture({ status: "producing", reasonCode: "platform_fault" });
    await param("refund.points.auto_approve_before_production", true, f.requester.staff!.staff.id);
    const r = await submit(f);
    expect(r.status).toBe("pending_approval");
    expect((await req(r.id)).approvalRequest.status).toBe("pending");
    expect((await holdNow(f)).status).toBe("captured");
  });
  it.each(["merchant_request", "platform_fault"] as const)(
    "跨期%s释放产生不予退回或转加购时不能自动执行",
    async (reasonCode) => {
      const f = await fixture({ reasonCode });
      await param(
        "refund.points.auto_approve_before_production",
        true,
        f.requester.staff!.staff.id,
      );
      await afterExpiry(f);
      const r = await submit(f),
        row = await req(r.id);
      expect(row).toMatchObject({
        status: "pending_approval",
        approvalRequest: { status: "pending" },
      });
      expect(row.cancelRequestLines[0]!.previewSnapshot).toMatchObject(
        reasonCode === "merchant_request"
          ? { backToOriginal: 0, forfeited: r.totalRefundPoints }
          : { backToOriginal: 0, convertedToAddon: r.totalRefundPoints },
      );
    },
  );
  it("调用方未提交事务中可见完整取消申请，独立连接不可见且外层回滚全部撤销", async () => {
    const f = await fixture(),
      before = await snapshotTables(h.prisma, tables),
      peer = await joinLedger(h, await db.url());
    try {
      await expect(
        h.tx.run(async (tx) => {
          const r = await submitAdCancel(tx, f.deps, f.requester, f.ad.id, f.body);
          expect(await tx.cancelRequest.findUnique({ where: { id: r.id } })).not.toBeNull();
          expect(
            await tx.approvalRequest.findUnique({ where: { id: r.approvalRequestId } }),
          ).not.toBeNull();
          expect(await tx.cancelRequestLine.count({ where: { cancelRequestId: r.id } })).toBe(1);
          expect(await peer.prisma.cancelRequest.findUnique({ where: { id: r.id } })).toBeNull();
          expect(
            await peer.prisma.approvalRequest.findUnique({ where: { id: r.approvalRequestId } }),
          ).toBeNull();
          throw new Error("outer-submit-rollback");
        }),
      ).rejects.toThrow("outer-submit-rollback");
      assertSnapshotsEqual(before, await snapshotTables(h.prisma, tables));
    } finally {
      await peer.close();
    }
  });
  it("执行账本后的外层失败回滚全部状态、数量、账本与事件", async () => {
    const f = await fixture({ status: "producing" }),
      r = await approve(f, await submit(f));
    const before = await snapshotTables(h.prisma, tables),
      peer = await joinLedger(h, await db.url());
    try {
      await expect(
        h.tx.run(async (tx) => {
          await executeCancel(tx, f.deps, f.executor, r.id, {
            confirm: confirm(r),
            confirmChecks: ["order_points_checked"],
          });
          expect((await tx.cancelRequest.findUniqueOrThrow({ where: { id: r.id } })).status).toBe(
            "done",
          );
          expect(
            (await peer.prisma.cancelRequest.findUniqueOrThrow({ where: { id: r.id } })).status,
          ).toBe("pending_execution");
          throw new Error("outer-execute-rollback");
        }),
      ).rejects.toThrow("outer-execute-rollback");
      assertSnapshotsEqual(before, await snapshotTables(h.prisma, tables));
    } finally {
      await peer.close();
    }
  });
  it("真实ledger.release返回后故障回滚广告迁移及所有财务副作用", async () => {
    const f = await fixture(),
      r = await approve(f, await submit(f)),
      before = await snapshotTables(h.prisma, tables);
    const broken = createAdCancel(
      deps({
        ledger: {
          ...h.ledger,
          release: async (...args) => {
            await h.ledger.release(...args);
            throw new Error("after-real-ledger-release");
          },
        },
      }),
    );
    await expect(
      broken.execute(f.executor, r.id, {
        confirm: confirm(r),
        confirmChecks: ["order_points_checked"],
      }),
    ).rejects.toThrow("after-real-ledger-release");
    assertSnapshotsEqual(before, await snapshotTables(h.prisma, tables));
  });
  it("实际ad.cancelled事件插入后故障回滚退款、指针与全部迁移", async () => {
    const f = await fixture({ status: "producing" }),
      r = await approve(f, await submit(f)),
      before = await snapshotTables(h.prisma, tables);
    const broken = createAdCancel(
      deps({
        events: {
          ...h.events,
          emit: async (...args) => {
            const result = await h.events.emit(...args);
            if (args[2].type === "ad.cancelled") throw new Error("after-real-ad-event");
            return result;
          },
        },
      }),
    );
    await expect(
      broken.execute(f.executor, r.id, {
        confirm: confirm(r),
        confirmChecks: ["order_points_checked"],
      }),
    ).rejects.toThrow("after-real-ad-event");
    assertSnapshotsEqual(before, await snapshotTables(h.prisma, tables));
  });
  it("已完成执行串行重放不重复账本、审批执行或广告事件", async () => {
    const f = await fixture(),
      r = await approve(f, await submit(f));
    await execute(f, r);
    const before = await snapshotTables(h.prisma, tables);
    expect((await execute(f, r)).status).toBe("done");
    assertSnapshotsEqual(before, await snapshotTables(h.prisma, tables));
  });
  it("只取消真实广告首版、修改与待补充timer，不影响其他广告", async () => {
    const f = await fixture({ status: "producing" }),
      other = await fixture(),
      ids: string[] = [];
    await h.tx.run(async (tx) => {
      await lockRows(tx, "ad", [f.ad.id, other.ad.id]);
      const timerCases: [string, string][] = [
        ["sla.breach", "first:0"],
        ["sla.breach", "rev:1"],
        ["ad.returned_stale", "0"],
      ];
      for (const [kind, purpose] of timerCases)
        ids.push(
          (
            await f.deps.timers.arm(tx, {
              kind,
              subject: { type: "ad", id: f.ad.id },
              key: timerKey(kind, { type: "ad", id: f.ad.id }, purpose),
              fireAt: new Date(h.clock.now().getTime() + 86_400_000),
            })
          ).id,
        );
      await f.deps.timers.arm(tx, {
        kind: "sla.breach",
        subject: { type: "ad", id: other.ad.id },
        key: timerKey("sla.breach", { type: "ad", id: other.ad.id }, "first:0"),
        fireAt: new Date(h.clock.now().getTime() + 86_400_000),
      });
    });
    const r = await submit(f);
    await execute(f, await approve(f, r));
    expect(
      (await h.prisma.timer.findMany({ where: { id: { in: ids } } })).every(
        (row) => row.status === "cancelled",
      ),
    ).toBe(true);
    expect(
      await h.prisma.timer.count({ where: { subjectId: other.ad.id, status: "scheduled" } }),
    ).toBe(1);
  });
  it("真实worker扫描执行SLA到点并发出唯一approval.sla_breached，重复投递无副作用", async () => {
    const f = await fixture(),
      r = await approve(f, await submit(f)),
      refs: TimerRef[] = [];
    const worker = buildWorkerServices({
      appEnv: "test",
      prisma: h.prisma,
      clock: h.clock,
      assembly: assembleForTest({ entry: "worker" }),
      providers: createFakeProviders({ clock: h.clock }),
      channel: {
        downForMs: () => 0,
        enqueue: async (_queue, _id, raw) => {
          if (
            typeof raw === "object" &&
            raw !== null &&
            "timerId" in raw &&
            "dispatchNo" in raw &&
            "kind" in raw &&
            typeof raw.timerId === "string" &&
            typeof raw.dispatchNo === "number" &&
            typeof raw.kind === "string"
          )
            refs.push({ timerId: raw.timerId, dispatchNo: raw.dispatchNo, kind: raw.kind });
        },
      },
    });
    ownedWorkers.push(worker);
    const timer = await h.prisma.timer.findFirstOrThrow({
      where: {
        subjectId: r.approvalRequestId,
        dedupeKey: timerKey(
          "sla.breach",
          { type: "approval_request", id: r.approvalRequestId },
          "execution",
        ),
      },
    });
    expect(r.execDueAt!.getTime() - h.clock.now().getTime()).toBeGreaterThan(8 * 3_600_000);
    expect(timer.fireAt).toEqual(r.execDueAt);
    expect((await req(r.id)).slaSnapshot).toMatchObject({
      policy: "review.refund_execute",
      amount: 1,
      unit: "work_days",
    });
    h.clock.set(new Date(r.execDueAt!.getTime() + 1));
    await worker.scan({ limit: 200 });
    const ref = refs.find((one) => one.timerId === timer.id);
    expect(ref).toBeDefined();
    expect(await worker.runTimer(ref!)).toBe("fired");
    expect(await worker.runTimer(ref!)).toBe("stale");
    const breached = await h.prisma.outboxEvent.findMany({
      where: { eventType: "approval.sla_breached", aggregateId: r.approvalRequestId },
    });
    expect(breached).toHaveLength(1);
    expect(breached[0]!.payload).toMatchObject({ purpose: "execution", kind: "ad_cancel" });
    expect((await req(r.id)).status).toBe("pending_execution");
    expect((await adNow(f)).status).toBe("pending_assign");
  });
});

describe("广告取消两连接竞态与真实锁图", { timeout: 60000 }, () => {
  it("二十轮同广告并发申请只有一套审批、明细与指针", async () => {
    for (let round = 0; round < 20; round++) {
      const f = await fixture();
      const results = await Promise.allSettled([submit(f), submit(f)]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(results.find((r) => r.status === "rejected")).toMatchObject({
        reason: { error: "AD_CANCEL_IN_PROGRESS" },
      });
      const rows = await h.prisma.cancelRequest.findMany({ where: { adId: f.ad.id } });
      expect(rows).toHaveLength(1);
      expect((await adNow(f)).openCancelRequestId).toBe(rows[0]!.id);
      expect(
        await h.prisma.cancelRequestLine.count({ where: { cancelRequestId: rows[0]!.id } }),
      ).toBe(1);
      expect(await h.prisma.approvalRequest.count({ where: { subjectId: f.ad.id } })).toBe(1);
      expect(
        await h.prisma.outboxEvent.count({
          where: { aggregateId: rows[0]!.id, eventType: "cancel.submitted" },
        }),
      ).toBe(1);
    }
  });
  it("二十轮批准与本人撤回竞争，审批和业务收尾保持同一结果", async () => {
    for (let round = 0; round < 20; round++) {
      const f = await fixture(),
        r = await submit(f);
      const results = await Promise.allSettled([
        approve(f, r),
        f.service.withdraw(f.requester, r.id, { note: "本人撤回" }),
      ]);
      expect(results.filter((value) => value.status === "fulfilled")).toHaveLength(1);
      expect(results.find((value) => value.status === "rejected")).toMatchObject({
        reason: { error: "APPROVAL_NOT_PENDING" },
      });
      const row = await req(r.id);
      if (row.approvalRequest.status === "withdrawn") {
        expect(row).toMatchObject({ status: "not_executed", closeReason: "withdrawn" });
        expect((await adNow(f)).openCancelRequestId).toBeNull();
      } else {
        expect(row).toMatchObject({
          status: "pending_execution",
          closeReason: null,
          approvalRequest: { status: "approved" },
        });
        expect((await adNow(f)).openCancelRequestId).toBe(r.id);
      }
      expect((await holdNow(f)).status).toBe("held");
    }
  });
  it("二十轮执行与作废竞争，只有真实执行能改积分和广告状态", async () => {
    for (let round = 0; round < 20; round++) {
      const f = await fixture(),
        r = await approve(f, await submit(f));
      const results = await Promise.allSettled([
        execute(f, r),
        f.service.void(f.requester, r.id, { note: "本人放弃本次退款" }),
      ]);
      expect(results.filter((value) => value.status === "fulfilled")).toHaveLength(1);
      expect(results.find((value) => value.status === "rejected")).toMatchObject({
        reason: { error: "STATE_NOT_ALLOWED" },
      });
      const row = await req(r.id),
        ad = await adNow(f),
        hold = await holdNow(f);
      expect(row.approvalRequest.status).toBe("approved");
      expect(ad.openCancelRequestId).toBeNull();
      if (row.status === "done") {
        expect(ad.status).toBe("cancelled");
        expect(hold.status).toBe("released");
        expect(ad.refundRequestedPoints).toBe(r.totalRefundPoints);
      } else {
        expect(row).toMatchObject({
          status: "not_executed",
          closeReason: "voided",
          executedAt: null,
        });
        expect(ad.status).toBe("pending_assign");
        expect(hold.status).toBe("held");
        expect(ad.refundRequestedPoints).toBe(0);
      }
    }
  });
  it("二十轮并发执行序列化重放，账本与执行事件都只产生一次", async () => {
    for (let round = 0; round < 20; round++) {
      const f = await fixture(),
        r = await approve(f, await submit(f));
      const result = await Promise.all([execute(f, r), execute(f, r)]);
      expect(result.map((one) => one.status)).toEqual(["done", "done"]);
      const ad = await adNow(f);
      expect(ad.refundRequestedPoints).toBe(r.totalRefundPoints);
      expect(ad.returnedPoints).toBe(r.totalRefundPoints);
      expect(
        await h.prisma.ledgerOperation.count({
          where: { entityId: f.ad.entityId, opType: "release" },
        }),
      ).toBe(1);
      for (const [eventType, aggregateId] of [
        ["cancel.executed", r.id],
        ["ad.cancelled", f.ad.id],
        ["approval.executed", r.approvalRequestId],
      ])
        expect(
          await h.prisma.outboxEvent.count({
            where: { eventType: eventType!, aggregateId: aggregateId! },
          }),
        ).toBe(1);
      expect(
        await h.prisma.statusTransition.count({
          where: { subjectId: r.id, event: "cancel.execute" },
        }),
      ).toBe(1);
    }
  });
  it("实际审批行锁阻塞真实批准调用，管理员observer核实际双方PID与阻塞对象", async () => {
    const f = await fixture(),
      r = await submit(f);
    let writerPid = 0,
      waiterPid = 0,
      locked!: () => void,
      release!: () => void,
      entered!: () => void;
    const held = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const proceed = new Promise<void>((resolve) => {
      release = resolve;
    });
    const connected = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const writer = h.tx.run(async (tx) => {
      const [backend] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      writerPid = backend!.pid;
      await lockRows(tx, "approval_request", [r.approvalRequestId]);
      expect(
        (await tx.approvalRequest.findUniqueOrThrow({ where: { id: r.approvalRequestId } }))
          .subjectId,
      ).toBe(f.ad.id);
      locked();
      await proceed;
    });
    await held;
    const d = deps({
      tx: {
        ...h.tx,
        run: (fn, options) =>
          h.tx.run(async (tx) => {
            const [backend] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
            waiterPid = backend!.pid;
            entered();
            return fn(tx);
          }, options),
      },
    });
    const waiter = createAdCancel(d)
      .approve(f.approver, r.id, {
        lockVersion: r.approvalRequest.lockVersion,
        confirm: confirm(r),
        confirmChecks: ["stage_rule_amount_checked"],
      })
      .then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      );
    const observer = createPrismaClient({
      connectionString: testDatabaseUrl(db.name, { role: null }),
      max: 1,
    });
    try {
      await connected;
      expect(writerPid).toBeGreaterThan(0);
      expect(waiterPid).not.toBe(writerPid);
      let blocked = false;
      for (let attempt = 0; attempt < 200; attempt++) {
        const [backend] = await observer.$queryRaw<
          { waiting: boolean; blockers: number[]; query: string }[]
        >`
          SELECT wait_event_type = 'Lock' AS waiting, pg_blocking_pids(pid) AS blockers, query
          FROM pg_stat_activity WHERE pid = ${waiterPid}`;
        if (backend?.waiting) {
          expect(backend.blockers).toContain(writerPid);
          expect(backend.query).toContain('FROM "approval_request"');
          console.warn("ad cancel approval prelock observed", {
            writerPid,
            waiterPid,
            approvalId: r.approvalRequestId,
            adId: f.ad.id,
            blockers: backend.blockers,
          });
          blocked = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(blocked).toBe(true);
      release();
      await writer;
      expect(await waiter).toMatchObject({ value: { status: "pending_execution" } });
    } finally {
      release();
      await writer;
      await waiter;
      await observer.$disconnect();
    }
  });
  it("读图后真实新增绑定，整体预锁后拒绝旧图并回滚而不补低序锁", async () => {
    const f = await fixture(),
      r = await submit(f);
    const { order, item } = await boundItem(f);
    let read!: () => void, proceed!: () => void;
    const readDone = new Promise<void>((resolve) => {
      read = resolve;
    });
    const changed = new Promise<void>((resolve) => {
      proceed = resolve;
    });
    const waiter = h.tx
      .run(async (tx) => {
        const graph = await readAdCancelTargetGraph(tx, [r.id]);
        expect(graph.itemIds).toEqual([]);
        read();
        await changed;
        await prelockAdCancelTargets(tx, graph);
      })
      .then(
        () => ({ ok: true }),
        (error: unknown) => ({ error }),
      );
    try {
      await readDone;
      // Only the existing M5 binding fixture is inserted; this does not claim an absent M5 producer.
      await h.tx.run(async (tx) => {
        await lockRows(tx, "ad", [f.ad.id]);
        await lockRows(tx, "drama_order", [order.id]);
        await lockRows(tx, "order_item", [item.id]);
        await tx.orderItemPlacement.create({
          data: {
            id: uuidv7(),
            orderItemId: item.id,
            slot: "opening",
            adId: f.ad.id,
            durationSec: f.ad.durationSec,
            createdAt: h.clock.now(),
            updatedAt: h.clock.now(),
          },
        });
      });
      proceed();
      expect(await waiter).toMatchObject({ error: { error: "PRECONDITION_CHANGED" } });
      expect((await req(r.id)).status).toBe("pending_approval");
      expect((await adNow(f)).openCancelRequestId).toBe(r.id);
      expect((await holdNow(f)).status).toBe("held");
      expect(
        await h.prisma.orderItemPlacement.count({ where: { adId: f.ad.id, orderItemId: item.id } }),
      ).toBe(1);
    } finally {
      proceed();
      await waiter;
    }
  });
});

// M5 producer is still absent: these are explicit legal upstream row fixtures, not ad.confirm/ad.cancel implementations.
async function terminalAd(
  f: Fixture,
  status: "confirmed" | "cancelled",
  client: Pick<Tx, "ad"> = h.prisma,
) {
  return client.ad.update({
    where: { id: f.ad.id },
    data: {
      status,
      openCancelRequestId: null,
      ...(status === "confirmed"
        ? { confirmedAt: h.clock.now(), confirmedVersionNo: 1 }
        : { cancelledAt: h.clock.now(), cancelReasonCode: "merchant_request" }),
    },
  });
}
async function invalidProxyFixture(status: "confirmed" | "cancelled" = "confirmed") {
  const f = await fixture({ status: "pending_confirm" }),
    r = await submit(f);
  await terminalAd(f, status);
  return { f, r };
}

describe("活跃发起人对象失效后的真实财务代撤", () => {
  it.each(["confirmed", "cancelled"] as const)(
    "%s终局+合法null指针保真实财务审计与所有积分数量",
    async (status) => {
      const { f, r } = await invalidProxyFixture(status);
      await historyRef(f, r);
      const before = await observe(f);
      const result = await f.service.withdraw(f.approver, r.id, { note: "对象已失效，财务代撤" });
      expect(result.status).toBe("not_executed");
      await expectClosed(f, r, "withdrawn");
      const row = await req(r.id),
        after = await observe(f);
      expect(row.approvalRequest).toMatchObject({
        status: "withdrawn",
        decidedByStaffId: null,
        isDecidedBySystem: false,
        decisionNote: "对象已失效，财务代撤",
      });
      expect(
        (await h.prisma.staff.findUniqueOrThrow({ where: { id: f.requester.staff!.staff.id } }))
          .status,
      ).toBe("active");
      expect(after.ad).toEqual(before.ad);
      for (const key of ["hold", "account", "lots", "operations"] as const)
        expect(after[key]).toEqual(before[key]);
      const audit = await h.prisma.auditLog.findFirstOrThrow({
        where: { targetId: r.approvalRequestId, action: "approval.request.withdraw" },
      });
      expect(audit).toMatchObject({
        actorType: "staff",
        actorId: f.approver.staff!.staff.id,
        client: "admin",
      });
      expect(audit.summary).toContain("代为撤回");
      for (const [eventType, aggregateId] of [
        ["approval.withdrawn", r.approvalRequestId],
        ["cancel.withdrawn", r.id],
      ] as const)
        expect(await h.prisma.outboxEvent.count({ where: { eventType, aggregateId } })).toBe(1);
      expect(
        await h.prisma.statusTransition.count({
          where: { subjectId: r.id, event: "approval.withdrawn" },
        }),
      ).toBe(1);
      await expect(f.service.withdraw(f.approver, r.id, {})).rejects.toMatchObject({
        error: "APPROVAL_NOT_PENDING",
      });
    },
  );
  it("仍有效广告拒绝代撤，行、timer、账本及事件零变化", async () => {
    const f = await fixture({ status: "pending_confirm" }),
      r = await submit(f),
      before = await snapshotTables(h.prisma, tables);
    await expect(f.service.withdraw(f.approver, r.id, {})).rejects.toMatchObject({
      error: "APPROVAL_WITHDRAW_FORBIDDEN",
    });
    await assertSnapshotsEqual(before, await snapshotTables(h.prisma, tables));
  });
  it.each(["entity", "store"] as const)(
    "仅%s生命周期失效不能冒充广告终局财务代撤",
    async (target) => {
      const f = await fixture(),
        r = await submit(f);
      if (target === "entity")
        await h.prisma.entity.update({
          where: { id: f.ad.entityId },
          data: { lifecycle: "closed", closedAt: h.clock.now() },
        });
      else
        await h.prisma.store.update({
          where: { id: f.ad.storeId },
          data: {
            lifecycle: "archived",
            archivedAt: h.clock.now(),
            archiveActorType: "staff",
            archiveActorId: f.approver.staff!.staff.id,
            archiveClient: "admin",
            archiveReason: "by_owner",
          },
        });
      const before = await snapshotTables(h.prisma, tables);
      await expect(f.service.withdraw(f.approver, r.id, {})).rejects.toMatchObject({
        error: "APPROVAL_WITHDRAW_FORBIDDEN",
      });
      await assertSnapshotsEqual(before, await snapshotTables(h.prisma, tables));
    },
  );
  it("没有决定权限的真实员工不能代撤终局对象", async () => {
    const { f, r } = await invalidProxyFixture(),
      manager = await h.make.staff({ staffRoleKey: "delivery_manager" });
    const actor: CancelActor = {
      ctx: createIdentityContext({ actor: { type: "staff", id: manager.id, client: "admin" } }),
      staff: await sampleStaffContext(h.prisma, manager.id, { stepUpAt: h.clock.now() }),
    };
    await h.prisma.store.update({
      where: { id: f.ad.storeId },
      data: { deliveryManagerId: manager.id },
    });
    expect(actor.staff!.permissions.has("finance.refund.approve")).toBe(false);
    expect(await h.prisma.store.findUniqueOrThrow({ where: { id: f.ad.storeId } })).toMatchObject({
      deliveryManagerId: actor.staff!.staff.id,
    });
    const before = await observe(f);
    await expect(f.service.withdraw(actor, r.id, {})).rejects.toMatchObject({
      error: "APPROVAL_WITHDRAW_FORBIDDEN",
    });
    expect(await observe(f)).toEqual(before);
  });
  it("范围外财务仍404且没有任何写入", async () => {
    const { f, r } = await invalidProxyFixture();
    const actor = {
      ...f.approver,
      staff: { ...f.approver.staff!, scope: ownTaskScope(f.approver.staff!.staff) },
    };
    const before = await snapshotTables(h.prisma, tables);
    await expect(f.service.withdraw(actor, r.id, {})).rejects.toMatchObject({ error: "NOT_FOUND" });
    await assertSnapshotsEqual(before, await snapshotTables(h.prisma, tables));
  });
  it("实际已禁用操作员工即使旧上下文有权限也不能代撤", async () => {
    const { f, r } = await invalidProxyFixture();
    await h.prisma.staff.update({
      where: { id: f.approver.staff!.staff.id },
      data: {
        status: "disabled",
        disabledAt: h.clock.now(),
        disabledReason: "other",
        disabledByStaffId: f.requester.staff!.staff.id,
      },
    });
    const before = await observe(f);
    await expect(f.service.withdraw(f.approver, r.id, {})).rejects.toMatchObject({
      error: "PERMISSION_DENIED",
    });
    expect(await observe(f)).toEqual(before);
  });
  it("代撤再验证过期在原owner公口拒绝，不能享用C86驳回豁免", async () => {
    const { f, r } = await invalidProxyFixture();
    const actor = {
      ...f.approver,
      staff: { ...f.approver.staff!, stepUpAt: new Date(h.clock.now().getTime() - 600_001) },
    };
    const before = await observe(f);
    await expect(f.service.withdraw(actor, r.id, {})).rejects.toMatchObject({
      error: "STEP_UP_REQUIRED",
    });
    expect(await observe(f)).toEqual(before);
  });
  it("直接泛approval无真实owner上下文严格拒绝，不接受伪造invalid参数", async () => {
    const { f, r } = await invalidProxyFixture(),
      before = await snapshotTables(h.prisma, tables);
    expect(f.deps.approval.kinds.get("ad_cancel")?.isSubjectInvalidForWithdrawal).toBeTypeOf(
      "function",
    );
    await expect(
      h.tx.run((tx) =>
        f.deps.approval.withdraw(tx, f.approver.ctx, {
          approvalId: r.approvalRequestId,
          staff: f.approver.staff,
          args: { invalid: true },
        }),
      ),
    ).rejects.toMatchObject({ error: "INTERNAL" });
    await assertSnapshotsEqual(before, await snapshotTables(h.prisma, tables));
  });
  it("只有真实预锁而无owner调用上下文仍拒绝", async () => {
    const { f, r } = await invalidProxyFixture(),
      before = await observe(f);
    await expect(
      h.tx.run(async (tx) => {
        await prelockAdCancelTargets(tx, await readAdCancelTargetGraph(tx, [r.id]), [
          f.approver.staff!.staff.id,
        ]);
        return f.deps.approval.withdraw(tx, f.approver.ctx, {
          approvalId: r.approvalRequestId,
          staff: f.approver.staff,
        });
      }),
    ).rejects.toMatchObject({ error: "INTERNAL" });
    expect(await observe(f)).toEqual(before);
  });
  it("已通过申请仍走原非pending拒绝，不因之后对象失效代撤", async () => {
    const f = await fixture({ status: "pending_confirm" }),
      r = await approve(f, await submit(f));
    await terminalAd(f, "confirmed");
    const before = await observe(f);
    await expect(f.service.withdraw(f.approver, r.id, {})).rejects.toMatchObject({
      error: "APPROVAL_NOT_PENDING",
    });
    expect(await observe(f)).toEqual(before);
  });
  it("终局null指针本人路径保持原拒绝，不借财务代撤条件放宽", async () => {
    const { f, r } = await invalidProxyFixture(),
      before = await observe(f);
    await expect(f.service.withdraw(f.requester, r.id, {})).rejects.toMatchObject({
      error: "PRECONDITION_CHANGED",
    });
    expect(await observe(f)).toEqual(before);
  });
  it("合法有效广告外来指针仍拒绝关闭，即使发起人已停用", async () => {
    const f = await fixture(),
      r = await submit(f),
      other = await fixture(),
      otherRequest = await submit(other);
    await h.prisma.ad.update({
      where: { id: f.ad.id },
      data: { openCancelRequestId: otherRequest.id },
    });
    await h.prisma.staff.update({
      where: { id: f.requester.staff!.staff.id },
      data: {
        status: "disabled",
        disabledAt: h.clock.now(),
        disabledReason: "other",
        disabledByStaffId: f.approver.staff!.staff.id,
      },
    });
    f.approver = await fresh(f.approver);
    const before = await snapshotTables(h.prisma, tables);
    await expect(f.service.withdraw(f.approver, r.id, {})).rejects.toMatchObject({
      error: "PRECONDITION_CHANGED",
    });
    await assertSnapshotsEqual(before, await snapshotTables(h.prisma, tables));
  });
  it("同Tx真实代撤未提交对独立连接不可见，外层失败完整回滚", async () => {
    const { f, r } = await invalidProxyFixture(),
      before = await snapshotTables(h.prisma, tables),
      peer = await joinLedger(h, await db.url());
    try {
      await expect(
        h.tx.run(async (tx) => {
          const result = await withdrawAdCancel(tx, f.deps, f.approver, r.id, {
            note: "财务代撤待外层提交",
          });
          expect(result.status).toBe("not_executed");
          expect(
            (await tx.approvalRequest.findUniqueOrThrow({ where: { id: r.approvalRequestId } }))
              .status,
          ).toBe("withdrawn");
          expect(
            (
              await peer.prisma.approvalRequest.findUniqueOrThrow({
                where: { id: r.approvalRequestId },
              })
            ).status,
          ).toBe("pending");
          expect(
            (await peer.prisma.cancelRequest.findUniqueOrThrow({ where: { id: r.id } })).status,
          ).toBe("pending_approval");
          throw new Error("proxy-outer-rollback");
        }),
      ).rejects.toThrow("proxy-outer-rollback");
      await assertSnapshotsEqual(before, await snapshotTables(h.prisma, tables));
    } finally {
      await peer.close();
    }
  });
  it("真实撤回事件插入后故障回滚审批、关闭、timer、审计与outbox", async () => {
    const { f, r } = await invalidProxyFixture(),
      before = await snapshotTables(h.prisma, tables);
    const events = {
      ...f.deps.events,
      emit: async (...args: Parameters<typeof f.deps.events.emit>) => {
        const result = await f.deps.events.emit(...args);
        if (args[2].type === "cancel.withdrawn") throw new Error("after-real-proxy-event");
        return result;
      },
    };
    f.service = createAdCancel(deps({ events }));
    await expect(f.service.withdraw(f.approver, r.id, {})).rejects.toThrow(
      "after-real-proxy-event",
    );
    await assertSnapshotsEqual(before, await snapshotTables(h.prisma, tables));
  });
  it("只取消本审批决定timer，其他审批与广告timer保持原行", async () => {
    const { f, r } = await invalidProxyFixture(),
      other = await fixture(),
      otherRequest = await submit(other);
    f.approver = await fresh(f.approver);
    const before = await h.prisma.timer.findMany({
      where: { subjectId: { in: [f.ad.id, other.ad.id, otherRequest.approvalRequestId] } },
      orderBy: { id: "asc" },
    });
    expect(
      await h.prisma.timer.count({
        where: { subjectId: r.approvalRequestId, status: "scheduled" },
      }),
    ).toBe(1);
    await f.service.withdraw(f.approver, r.id, {});
    expect(
      await h.prisma.timer.findMany({
        where: { subjectId: { in: [f.ad.id, other.ad.id, otherRequest.approvalRequestId] } },
        orderBy: { id: "asc" },
      }),
    ).toEqual(before);
    expect(
      await h.prisma.timer.count({
        where: { subjectId: r.approvalRequestId, status: { in: ["scheduled", "dispatched"] } },
      }),
    ).toBe(0);
  });
  // 同库四批共二十轮，全部真实造数/竞争/断言不减；默认5秒逐批计，不把二十轮当一次操作。
  it.each([1, 2, 3, 4])("二十轮财务代撤与批准竞争，唯一关闭结果且积分不动（第%d批）", async () => {
    for (let round = 0; round < 5; round++) {
      const { f, r } = await invalidProxyFixture(),
        before = await holdNow(f);
      const outcomes = await Promise.allSettled([
        f.service.withdraw(f.approver, r.id, {}),
        approve(f, r),
      ]);
      expect(outcomes[0]).toMatchObject({ status: "fulfilled", value: { status: "not_executed" } });
      expect(outcomes[1].status).toBe("rejected");
      if (outcomes[1].status === "rejected")
        expect(["APPROVAL_NOT_PENDING", "PRECONDITION_CHANGED"]).toContain(
          outcomes[1].reason.error,
        );
      expect(await req(r.id)).toMatchObject({
        status: "not_executed",
        closeReason: "withdrawn",
        approvalRequest: { status: "withdrawn", isDecidedBySystem: false },
      });
      expect(await holdNow(f)).toEqual(before);
      expect(
        await h.prisma.outboxEvent.count({
          where: { eventType: "approval.withdrawn", aggregateId: r.approvalRequestId },
        }),
      ).toBe(1);
      expect(
        await h.prisma.outboxEvent.count({
          where: { eventType: "cancel.withdrawn", aggregateId: r.id },
        }),
      ).toBe(1);
    }
  });
  it("真实广告锁等待后按提交后的终局重读，核精确双方PID阻塞", async () => {
    const f = await fixture({ status: "pending_confirm" }),
      r = await submit(f);
    let writerPid = 0,
      waiterPid = 0,
      locked!: () => void,
      release!: () => void,
      entered!: () => void;
    const held = new Promise<void>((resolve) => {
        locked = resolve;
      }),
      proceed = new Promise<void>((resolve) => {
        release = resolve;
      }),
      connected = new Promise<void>((resolve) => {
        entered = resolve;
      });
    const writer = h.tx.run(async (tx) => {
      writerPid = (await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid;
      await lockRows(tx, "ad", [f.ad.id]);
      locked();
      await proceed;
      await terminalAd(f, "confirmed", tx);
    });
    await held;
    const d = deps({
      tx: {
        ...h.tx,
        run: (fn, options) =>
          h.tx.run(async (tx) => {
            waiterPid = (await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!
              .pid;
            entered();
            return fn(tx);
          }, options),
      },
    });
    const waiter = createAdCancel(d)
      .withdraw(f.approver, r.id, {})
      .then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      );
    const observer = createPrismaClient({
      connectionString: testDatabaseUrl(db.name, { role: null }),
      max: 1,
    });
    try {
      await connected;
      expect(writerPid).toBeGreaterThan(0);
      expect(waiterPid).not.toBe(writerPid);
      let blocked = false;
      for (let attempt = 0; attempt < 200; attempt++) {
        const [backend] = await observer.$queryRaw<
          { waiting: boolean; blockers: number[]; query: string }[]
        >`
          SELECT wait_event_type = 'Lock' AS waiting, pg_blocking_pids(pid) AS blockers, query
          FROM pg_stat_activity WHERE pid = ${waiterPid}`;
        if (backend?.waiting) {
          expect(backend.blockers).toContain(writerPid);
          expect(backend.query).toContain('FROM "ad"');
          blocked = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(blocked).toBe(true);
      release();
      await writer;
      expect(await waiter).toMatchObject({ value: { status: "not_executed" } });
      expect((await req(r.id)).approvalRequest).toMatchObject({
        status: "withdrawn",
        isDecidedBySystem: false,
      });
      expect((await adNow(f)).status).toBe("confirmed");
    } finally {
      release();
      await writer;
      await waiter;
      await observer.$disconnect();
    }
  });
});

// 只验 order 的关闭伴随口；主体行是合法上游 fixture，不冒充尚未实现的 tenant close producer。
async function withEntityCancels<T>(
  f: Fixture,
  fn: (port: EntityAdCancelCloser) => Promise<T>,
  d: CancelDeps = f.deps,
) {
  const assembly = assembleForTest({ entry: "api" });
  const unbind = bindOrder({ assembly, clock: d.clock, flow: d.flow, cancel: d });
  try {
    return await fn(assembly.port(entityAdCancelClosePort));
  } finally {
    unbind();
  }
}
const closedEntityFixture = (tx: Tx, entityId: string) =>
  tx.entity.update({
    where: { id: entityId },
    data: { lifecycle: "closed", closedAt: h.clock.now(), updatedAt: h.clock.now() },
  });
async function entityBatch(f: Fixture, port: EntityAdCancelCloser, tx: Tx) {
  const plan = await port.prepare(tx, f.ad.entityId, [f.requester.staff!.staff.id]);
  await closedEntityFixture(tx, f.ad.entityId);
  return port.withdraw(tx, f.requester.ctx, plan);
}
async function siblingAd(f: Fixture) {
  const store = await h.make.store({ entityId: f.ad.entityId, qualificationStatus: "verified" });
  return fixture({ tenant: { merchant: { ...f.merchant, store }, term: f.term } });
}
const entityTables = [...tables, "entity", "store", "entity_member", "invitation"];
const financialTables = [
  "billing_account",
  "point_hold",
  "point_hold_alloc",
  "point_lot",
  "ledger_operation",
  "point_ledger_entry",
];

describe("主体关闭的 pending ad_cancel 同事务所属伴随", () => {
  it("独立 worker 实际绑定真实 owner 执行非空批次，closeOrder 精确恢复旧实例", async () => {
    const f = await fixture(),
      r = await submit(f);
    await historyRef(f, r);
    await withEntityCancels(f, async () => {
      const previous = boundOrder();
      const worker = buildWorkerServices({
        appEnv: "test",
        prisma: h.prisma,
        clock: h.clock,
        assembly: assembleForTest({ entry: "worker" }),
        providers: createFakeProviders({ clock: h.clock }),
        channel: { downForMs: () => 0, enqueue: async () => {} },
      });
      ownedWorkers.push(worker);
      try {
        const current = boundOrder();
        expect(current).not.toBe(previous);
        expect(current.assembly).toBe(worker.assembly);
        expect(current.cancel?.approval.kinds.get("ad_cancel")).toBe(
          worker.assembly.portEntries(approvalKindPort).get("ad_cancel"),
        );
        expect(
          await h.tx.run((tx) => entityBatch(f, worker.assembly.port(entityAdCancelClosePort), tx)),
        ).toEqual([r.id]);
        await expectClosed(f, r, "withdrawn");
      } finally {
        worker.closeOrder?.();
      }
      expect(boundOrder()).toBe(previous);
      expect(boundOrder().cancel).toBe(f.deps);
    });
  });
  it.each(["api", "worker"] as const)("%s 实际装配只有 order 实现且缺 owner 拒绝启动", (entry) => {
    const assembly = assembleForTest({ entry });
    expect(entityAdCancelClosePort.fallback).toBeUndefined();
    expect(assembly.portImplementations.filter((p) => p.port === entityAdCancelClosePort)).toEqual([
      expect.objectContaining({ module: "order" }),
    ]);
    expect(assembly.port(entityAdCancelClosePort).withdraw).toBeTypeOf("function");
    expect(() => assembleForTest({ entry, withoutRealPorts: [entityAdCancelClosePort] })).toThrow(
      /缺实现/,
    );
  });
  it("旧绑定没有真实取消依赖时明确 INTERNAL，零写", async () => {
    const f = await fixture(),
      assembly = assembleForTest({ entry: "api" });
    const before = await snapshotTables(h.prisma, entityTables);
    const unbind = bindOrder({ assembly, clock: h.clock, flow: f.deps.flow });
    try {
      await expect(
        h.tx.run((tx) => assembly.port(entityAdCancelClosePort).prepare(tx, f.ad.entityId)),
      ).rejects.toMatchObject({ error: "INTERNAL" });
    } finally {
      unbind();
    }
    assertSnapshotsEqual(before, await snapshotTables(h.prisma, entityTables));
  });
  it("没有待审广告取消的真实主体返回空计划，反复准备不产生业务副作用", async () => {
    const f = await fixture();
    const member = await h.make.entityMember({ entityId: f.ad.entityId });
    const invitation = await h.prisma.invitation.create({
      data: {
        id: uuidv7(),
        entityId: f.ad.entityId,
        storeId: f.ad.storeId,
        role: "clerk",
        inviterMemberId: f.merchant.owner.id,
        tokenHash: Buffer.from(uuidv7().replaceAll("-", "").padEnd(64, "0"), "hex"),
        tokenEnc: "lyxtest.invitation",
        status: "pending",
        clientRequestId: uuidv7(),
        expiresAt: new Date(h.clock.now().getTime() + 86_400_000),
        createdAt: h.clock.now(),
        updatedAt: h.clock.now(),
      },
    });
    await withEntityCancels(f, (port) =>
      h.tx.run(async (tx) => {
        const plan = await port.prepare(tx, f.ad.entityId);
        expect(plan.requestIds).toEqual([]);
        expect(plan.storeIds).toEqual([f.ad.storeId]);
        expect(plan.memberIds).toContain(f.merchant.owner.id);
        expect(plan.memberIds).toContain(member.id);
        expect(plan.invitationIds).toEqual([invitation.id]);
        await closedEntityFixture(tx, f.ad.entityId);
        expect(await port.withdraw(tx, f.requester.ctx, plan)).toEqual([]);
        const before = await snapshotTables(tx, tables);
        const next = await port.prepare(tx, f.ad.entityId);
        expect(await port.withdraw(tx, f.requester.ctx, next)).toEqual([]);
        assertSnapshotsEqual(before, await snapshotTables(tx, tables));
      }),
    );
  });
  it.each(["pending_assign", "producing"])(
    "%s 真实系统撤回保留原冻结/扣减和全部账本",
    async (status) => {
      const f = await fixture({ status }),
        r = await submit(f);
      await historyRef(f, r);
      const financial = await snapshotTables(h.prisma, financialTables),
        hold = await holdNow(f);
      const result = await withEntityCancels(f, (port) =>
        h.tx.run((tx) => entityBatch(f, port, tx)),
      );
      expect(result).toEqual([r.id]);
      await expectClosed(f, r, "withdrawn");
      expect(await holdNow(f)).toEqual(hold);
      assertSnapshotsEqual(financial, await snapshotTables(h.prisma, financialTables));
      expect((await req(r.id)).approvalRequest).toMatchObject({
        status: "withdrawn",
        isDecidedBySystem: true,
        decidedByStaffId: null,
      });
      for (const [eventType, aggregateId] of [
        ["approval.withdrawn", r.approvalRequestId],
        ["cancel.withdrawn", r.id],
      ]) {
        const events = await h.prisma.outboxEvent.findMany({ where: { eventType, aggregateId } });
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({ actorType: "system", actorId: null });
      }
      const history = await h.prisma.statusTransition.findMany({
        where: { subjectId: r.id, toState: "not_executed" },
      });
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({ actorType: "system", actorId: null });
    },
  );
  it("同主体跨两店三申请整图预锁，另一主体及历史客服关联不动", async () => {
    const f = await fixture(),
      second = await siblingAd(f);
    const third = await fixture({ tenant: { merchant: f.merchant, term: f.term } });
    const other = await fixture();
    const requests = await Promise.all([submit(f), submit(second), submit(third)]);
    const foreign = await submit(other),
      foreignBefore = await observe(other);
    const ref = await historyRef(f, requests[0]!);
    await historyRef(second, requests[1]!);
    await historyRef(third, requests[2]!);
    const before = await snapshotTables(h.prisma, financialTables);
    const actual = await withEntityCancels(f, (port) => h.tx.run((tx) => entityBatch(f, port, tx)));
    expect(actual).toEqual(requests.map((r) => r.id).sort());
    for (const [index, one] of [f, second, third].entries())
      await expectClosed(one, requests[index]!, "withdrawn");
    expect(await observe(other)).toEqual(foreignBefore);
    expect((await req(foreign.id)).status).toBe("pending_approval");
    expect(
      await h.prisma.serviceTicketRef.findUnique({
        where: {
          serviceTicketId_refType_refId: {
            serviceTicketId: ref.serviceTicketId,
            refType: ref.refType,
            refId: ref.refId,
          },
        },
      }),
    ).toEqual(ref);
    assertSnapshotsEqual(before, await snapshotTables(h.prisma, financialTables));
  });
  it("只取 pending_approval，已批准待执行和已撤回/驳回/执行历史完整保留", async () => {
    const f = await fixture(),
      approved = await siblingAd(f),
      rejected = await siblingAd(f),
      withdrawn = await siblingAd(f),
      done = await siblingAd(f);
    const pending = await submit(f),
      a = await approve(approved, await submit(approved));
    const r = await submit(rejected),
      w = await submit(withdrawn),
      e = await approve(done, await submit(done));
    await rejected.service.reject(rejected.approver, r.id, { note: "保留历史驳回" });
    await withdrawn.service.withdraw(withdrawn.requester, w.id, {});
    await execute(done, e);
    const others = await Promise.all([a.id, r.id, w.id, e.id].map(req));
    await withEntityCancels(f, (port) => h.tx.run((tx) => entityBatch(f, port, tx)));
    expect(await Promise.all([a.id, r.id, w.id, e.id].map(req))).toEqual(others);
    expect((await req(pending.id)).status).toBe("not_executed");
    expect((await adNow(approved)).openCancelRequestId).toBe(a.id);
  });
  it("仅撤销自己的审批决定 timer，保留广告 timer、其他申请及原期限", async () => {
    const f = await fixture({ status: "producing" }),
      other = await fixture(),
      r = await submit(f),
      foreign = await submit(other);
    let adTimerId = "";
    await h.tx.run(async (tx) => {
      await lockRows(tx, "ad", [f.ad.id]);
      adTimerId = (
        await f.deps.timers.arm(tx, {
          kind: "sla.breach",
          subject: { type: "ad", id: f.ad.id },
          key: timerKey("sla.breach", { type: "ad", id: f.ad.id }, "first:0"),
          fireAt: new Date(h.clock.now().getTime() + 86_400_000),
        })
      ).id;
    });
    const before = await h.prisma.timer.findMany({
      where: { OR: [{ id: adTimerId }, { subjectId: foreign.approvalRequestId }] },
      orderBy: { id: "asc" },
    });
    const own = await h.prisma.timer.findMany({ where: { subjectId: r.approvalRequestId } });
    expect(own.length).toBeGreaterThan(0);
    await withEntityCancels(f, (port) => h.tx.run((tx) => entityBatch(f, port, tx)));
    expect(
      await h.prisma.timer.findMany({
        where: { id: { in: before.map((t) => t.id) } },
        orderBy: { id: "asc" },
      }),
    ).toEqual(before);
    expect(
      (await h.prisma.timer.findMany({ where: { id: { in: own.map((t) => t.id) } } })).every(
        (t) => t.status === "cancelled",
      ),
    ).toBe(true);
  });
  it.each(["active", "abandoned"])(
    "主体为%s时拒绝系统撤回，整个事务零副作用",
    async (lifecycle) => {
      const f = await fixture();
      await submit(f);
      const before = await snapshotTables(h.prisma, entityTables);
      await expect(
        withEntityCancels(f, (port) =>
          h.tx.run(async (tx) => {
            const plan = await port.prepare(tx, f.ad.entityId);
            if (lifecycle === "abandoned")
              await tx.entity.update({
                where: { id: f.ad.entityId },
                data: { lifecycle, closedAt: h.clock.now() },
              });
            await port.withdraw(tx, f.requester.ctx, plan);
          }),
        ),
      ).rejects.toMatchObject({ error: "PRECONDITION_CHANGED" });
      assertSnapshotsEqual(before, await snapshotTables(h.prisma, entityTables));
    },
  );
  it("复制的计划或另一个事务的旧计划不能获得系统撤回权限", async () => {
    const f = await fixture();
    await submit(f);
    const before = await snapshotTables(h.prisma, entityTables);
    await withEntityCancels(f, async (port) => {
      let stale: EntityAdCancelClosePlan | undefined;
      await h.tx.run(async (tx) => {
        stale = await port.prepare(tx, f.ad.entityId);
        await expect(port.withdraw(tx, f.requester.ctx, { ...stale })).rejects.toMatchObject({
          error: "INTERNAL",
        });
      });
      if (!stale) throw new Error("missing real plan");
      await expect(
        h.tx.run((tx) => port.withdraw(tx, f.requester.ctx, stale!)),
      ).rejects.toMatchObject({ error: "INTERNAL" });
    });
    assertSnapshotsEqual(before, await snapshotTables(h.prisma, entityTables));
  });
  it("prepare 后候选减少拒绝整笔并回滚真实本人撤回", async () => {
    const f = await fixture(),
      r = await submit(f),
      before = await snapshotTables(h.prisma, entityTables);
    await expect(
      withEntityCancels(f, (port) =>
        h.tx.run(async (tx) => {
          // owner callback 的原低锁均由 prepare 获取；自身撤回仅重入同一图。
          const plan = await port.prepare(tx, f.ad.entityId);
          await withdrawAdCancel(tx, f.deps, f.requester, r.id, {});
          await closedEntityFixture(tx, f.ad.entityId);
          await port.withdraw(tx, f.requester.ctx, plan);
        }),
      ),
    ).rejects.toMatchObject({ error: "PRECONDITION_CHANGED" });
    assertSnapshotsEqual(before, await snapshotTables(h.prisma, entityTables));
  });
  it("prepare 后广告绑定图增加拒绝，合法上游关联插入一起回滚", async () => {
    const f = await fixture(),
      { item } = await boundItem(f);
    await submit(f);
    const before = await snapshotTables(h.prisma, [...entityTables, "order_item_placement"]);
    await expect(
      withEntityCancels(f, (port) =>
        h.tx.run(async (tx) => {
          const plan = await port.prepare(tx, f.ad.entityId);
          await tx.orderItemPlacement.create({
            data: {
              id: uuidv7(),
              orderItemId: item.id,
              slot: "opening",
              adId: f.ad.id,
              durationSec: f.ad.durationSec,
              createdAt: h.clock.now(),
              updatedAt: h.clock.now(),
            },
          });
          await closedEntityFixture(tx, f.ad.entityId);
          await port.withdraw(tx, f.requester.ctx, plan);
        }),
      ),
    ).rejects.toMatchObject({ error: "PRECONDITION_CHANGED" });
    assertSnapshotsEqual(
      before,
      await snapshotTables(h.prisma, [...entityTables, "order_item_placement"]),
    );
  });
  it("prepare 后门店集合增加拒绝而不高锁后补锁，新增门店与关闭一起回滚", async () => {
    const f = await fixture();
    await submit(f);
    const before = await snapshotTables(h.prisma, entityTables);
    await expect(
      withEntityCancels(f, (port) =>
        h.tx.run(async (tx) => {
          const plan = await port.prepare(tx, f.ad.entityId);
          await tx.store.create({
            data: {
              id: uuidv7(),
              entityId: f.ad.entityId,
              name: "新候选门店",
              lifecycle: "active",
              createdAt: h.clock.now(),
              updatedAt: h.clock.now(),
            },
          });
          await closedEntityFixture(tx, f.ad.entityId);
          await port.withdraw(tx, f.requester.ctx, plan);
        }),
      ),
    ).rejects.toMatchObject({ error: "PRECONDITION_CHANGED" });
    assertSnapshotsEqual(before, await snapshotTables(h.prisma, entityTables));
  });
  it("外层失败回滚主体、全部取消、审批、指针、timer与事件", async () => {
    const f = await fixture(),
      second = await siblingAd(f);
    await submit(f);
    await submit(second);
    const before = await snapshotTables(h.prisma, entityTables);
    await expect(
      withEntityCancels(f, (port) =>
        h.tx.run(async (tx) => {
          expect(await entityBatch(f, port, tx)).toHaveLength(2);
          throw new Error("outer-entity-close-rollback");
        }),
      ),
    ).rejects.toThrow("outer-entity-close-rollback");
    assertSnapshotsEqual(before, await snapshotTables(h.prisma, entityTables));
  });
  it("第二张实际撤回事件插入后失败，第一张和主体关闭也原子回滚", async () => {
    const f = await fixture(),
      second = await siblingAd(f);
    await submit(f);
    await submit(second);
    const before = await snapshotTables(h.prisma, entityTables);
    let emitted = 0;
    const broken = deps({
      events: {
        ...h.events,
        emit: async (...args) => {
          const result = await h.events.emit(...args);
          if (args[2].type === "cancel.withdrawn" && ++emitted === 2)
            throw new Error("second-real-cancel-withdrawn");
          return result;
        },
      },
    });
    await expect(
      withEntityCancels(f, (port) => h.tx.run((tx) => entityBatch(f, port, tx)), broken),
    ).rejects.toThrow("second-real-cancel-withdrawn");
    expect(emitted).toBe(2);
    assertSnapshotsEqual(before, await snapshotTables(h.prisma, entityTables));
  });
  it("同Tx可见完整批结果，另一连接提交前仍见pending，提交后才见关闭", async () => {
    const f = await fixture(),
      r = await submit(f),
      peer = await joinLedger(h, await db.url());
    try {
      await withEntityCancels(f, (port) =>
        h.tx.run(async (tx) => {
          await entityBatch(f, port, tx);
          expect((await tx.cancelRequest.findUniqueOrThrow({ where: { id: r.id } })).status).toBe(
            "not_executed",
          );
          expect(
            (await peer.prisma.cancelRequest.findUniqueOrThrow({ where: { id: r.id } })).status,
          ).toBe("pending_approval");
          expect(
            (await peer.prisma.entity.findUniqueOrThrow({ where: { id: f.ad.entityId } }))
              .lifecycle,
          ).toBe("active");
        }),
      );
      expect(
        (await peer.prisma.cancelRequest.findUniqueOrThrow({ where: { id: r.id } })).status,
      ).toBe("not_executed");
      expect(
        (await peer.prisma.entity.findUniqueOrThrow({ where: { id: f.ad.entityId } })).lifecycle,
      ).toBe("closed");
    } finally {
      await peer.close();
    }
  });
  // 仍是同一个文件级库/同一个h，四批合计二十轮，不新增克隆/迁移或清理历史证据。
  it.each([1, 2, 3, 4])(
    "二十轮关闭与本人撤回竞争最终收尾一致且无重复事件或账本（第%d批）",
    async () => {
      for (let round = 0; round < 5; round++) {
        const f = await fixture(),
          r = await submit(f),
          before = await snapshotTables(h.prisma, financialTables);
        await historyRef(f, r);
        const results = await withEntityCancels(f, (port) =>
          Promise.allSettled([
            h.tx.run((tx) => entityBatch(f, port, tx)),
            f.service.withdraw(f.requester, r.id, {}),
          ]),
        );
        expect(results.some((result) => result.status === "fulfilled")).toBe(true);
        for (const result of results)
          if (result.status === "rejected")
            expect(["PRECONDITION_CHANGED", "APPROVAL_NOT_PENDING"]).toContain(result.reason.error);
        await expectClosed(f, r, "withdrawn");
        for (const [eventType, aggregateId] of [
          ["approval.withdrawn", r.approvalRequestId],
          ["cancel.withdrawn", r.id],
        ])
          expect(await h.prisma.outboxEvent.count({ where: { eventType, aggregateId } })).toBe(1);
        assertSnapshotsEqual(before, await snapshotTables(h.prisma, financialTables));
      }
    },
  );
  it("等待主体锁时真实新增取消候选，拒绝整个计划而不补低锁", async () => {
    const f = await fixture(),
      second = await siblingAd(f),
      r = await submit(f);
    let writerPid = 0,
      waiterPid = 0,
      release!: () => void,
      entered!: () => void,
      locked!: () => void;
    const held = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const proceed = new Promise<void>((resolve) => {
      release = resolve;
    });
    const connected = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const writer = h.tx.run(async (tx) => {
      writerPid = (await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid;
      await lockRows(tx, "staff", [second.requester.staff!.staff.id], "share");
      await lockRows(tx, "entity", [f.ad.entityId]);
      locked();
      await proceed;
      return submitAdCancel(tx, second.deps, second.requester, second.ad.id, second.body);
    });
    await held;
    const observer = createPrismaClient({
      connectionString: testDatabaseUrl(db.name, { role: null }),
      max: 1,
    });
    const waiter = withEntityCancels(f, (port) =>
      h.tx.run(async (tx) => {
        waiterPid = (await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid;
        entered();
        return entityBatch(f, port, tx);
      }),
    ).then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
    try {
      await connected;
      expect(waiterPid).not.toBe(writerPid);
      let blocked = false;
      for (let attempt = 0; attempt < 200; attempt++) {
        const [backend] = await observer.$queryRaw<
          { waiting: boolean; blockers: number[]; query: string }[]
        >`
          SELECT wait_event_type = 'Lock' AS waiting, pg_blocking_pids(pid) AS blockers, query
          FROM pg_stat_activity WHERE pid = ${waiterPid}`;
        if (backend?.waiting) {
          expect(backend.blockers).toContain(writerPid);
          expect(backend.query).toContain('FROM "entity"');
          blocked = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(blocked).toBe(true);
      release();
      const added = await writer;
      expect(await waiter).toMatchObject({ error: { error: "PRECONDITION_CHANGED" } });
      expect((await req(r.id)).status).toBe("pending_approval");
      expect((await req(added.id)).status).toBe("pending_approval");
      expect(
        (await h.prisma.entity.findUniqueOrThrow({ where: { id: f.ad.entityId } })).lifecycle,
      ).toBe("active");
    } finally {
      release();
      await writer;
      await waiter;
      await observer.$disconnect();
    }
  });
  it("真实低序审批锁阻塞prepare，observer核双方PID、阻塞对象和原观测期限", async () => {
    const f = await fixture(),
      r = await submit(f);
    await historyRef(f, r);
    let writerPid = 0,
      waiterPid = 0,
      release!: () => void,
      entered!: () => void,
      locked!: () => void;
    const held = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const proceed = new Promise<void>((resolve) => {
      release = resolve;
    });
    const connected = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const writer = h.tx.run(async (tx) => {
      writerPid = (await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid;
      await lockRows(tx, "approval_request", [r.approvalRequestId]);
      locked();
      await proceed;
    });
    await held;
    const observer = createPrismaClient({
      connectionString: testDatabaseUrl(db.name, { role: null }),
      max: 1,
    });
    const waiter = withEntityCancels(f, (port) =>
      h.tx.run(async (tx) => {
        waiterPid = (await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid;
        entered();
        return entityBatch(f, port, tx);
      }),
    ).then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
    try {
      await connected;
      expect(writerPid).toBeGreaterThan(0);
      expect(waiterPid).not.toBe(writerPid);
      let blocked = false;
      for (let attempt = 0; attempt < 200; attempt++) {
        const [backend] = await observer.$queryRaw<
          { waiting: boolean; blockers: number[]; query: string }[]
        >`
          SELECT wait_event_type = 'Lock' AS waiting, pg_blocking_pids(pid) AS blockers, query
          FROM pg_stat_activity WHERE pid = ${waiterPid}`;
        if (backend?.waiting) {
          expect(backend.blockers).toContain(writerPid);
          expect(backend.query).toContain('FROM "approval_request"');
          console.warn("entity ad cancel low prelock observed", {
            writerPid,
            waiterPid,
            approvalId: r.approvalRequestId,
            blockers: backend.blockers,
          });
          blocked = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(blocked).toBe(true);
      release();
      await writer;
      expect(await waiter).toEqual({ value: [r.id] });
      await expectClosed(f, r, "withdrawn");
    } finally {
      release();
      await writer;
      await waiter;
      await observer.$disconnect();
    }
  });
});

describe("客服广告取消审批引用：真实早晚回调", () => {
  type Companion = ReturnType<typeof createAdCancelApprovalRefCompanion>;
  type Target = Parameters<Companion["beforeAccount"]>[1];
  const states = ["pending", "processing", "awaiting_confirm", "resolved", "closed"] as const;
  const refTables = [...tables, "service_ticket", "service_ticket_entry"];
  async function ticket(
    f: Fixture,
    options: {
      status?: (typeof states)[number];
      ownerStaffId?: string | null;
      storeId?: string;
      entityId?: string;
    } = {},
  ) {
    const now = h.clock.now(),
      status = options.status ?? "pending";
    const awaiting = status === "awaiting_confirm",
      resolved = status === "resolved";
    return h.prisma.serviceTicket.create({
      data: {
        id: uuidv7(),
        ticketNo: "KF20260105" + String(++sequence).padStart(5, "0"),
        entityId: options.entityId ?? f.ad.entityId,
        storeId: options.storeId ?? f.ad.storeId,
        source: "weapp",
        submitterUserId: f.merchant.user.id,
        typeCode: "K01",
        priority: "mid",
        description: "客服广告取消关联前置事实",
        ownerStaffId: options.ownerStaffId ?? null,
        status,
        firstResponseAt: status === "pending" ? null : now,
        solutionDueAt: new Date(now.getTime() + 86_400_000),
        solutionAt: awaiting || resolved ? now : null,
        awaitingConfirmAt: awaiting ? now : null,
        autoResolveAt: awaiting ? new Date(now.getTime() + 3 * 86_400_000) : null,
        resolvedAt: resolved ? now : null,
        resolvedVia: resolved ? "merchant" : null,
        closedAt: status === "closed" ? now : null,
        closeReason: status === "closed" ? "invalid" : null,
        closeNote: status === "closed" ? "历史工单已关闭" : null,
        slaSnapshot: awaiting ? { solution: {}, autoResolve: {} } : { solution: {} },
        createdAt: now,
        updatedAt: now,
      },
    });
  }
  type Ticket = Awaited<ReturnType<typeof ticket>>;
  const companion = (t: Ticket) =>
    createAdCancelApprovalRefCompanion({ clock: h.clock, serviceTicketId: t.id });
  const link = (
    f: Fixture,
    t: Ticket,
    actor: CancelActor = f.requester,
    d: CancelDeps = f.deps,
    hooks: Companion = companion(t),
  ) => createAdCancel(d).submit(actor, f.ad.id, f.body, undefined, hooks);
  const linked = (ticketId: string) =>
    h.prisma.serviceTicketRef.findMany({
      where: { serviceTicketId: ticketId },
      orderBy: [{ refType: "asc" }, { refId: "asc" }],
    });
  const refAudits = (ticketId: string) =>
    h.prisma.auditLog.findMany({
      where: { targetId: ticketId, action: "support.service_ticket.ref_add" },
      orderBy: { id: "asc" },
    });
  async function expectLink(f: Fixture, t: Ticket, r: Request, actor = f.requester) {
    const approval = (await req(r.id)).approvalRequest;
    expect(await linked(t.id)).toEqual([
      {
        serviceTicketId: t.id,
        refType: "approval_request",
        refId: r.approvalRequestId,
        createdAt: approval.createdAt,
      },
    ]);
    expect(approval).toMatchObject({
      kind: "ad_cancel",
      subjectType: "ad",
      subjectId: f.ad.id,
      entityId: f.ad.entityId,
      storeId: f.ad.storeId,
      requesterStaffId: actor.staff!.staff.id,
    });
    const audits = await refAudits(t.id);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      stream: "activity",
      category: "service_ticket",
      action: "support.service_ticket.ref_add",
      targetType: "service_ticket",
      targetId: t.id,
      entityId: f.ad.entityId,
      storeId: f.ad.storeId,
      actorType: "staff",
      actorId: actor.staff!.staff.id,
      client: "admin",
    });
    expect(await h.prisma.serviceTicket.findUniqueOrThrow({ where: { id: t.id } })).toEqual(t);
    expect(await h.prisma.serviceTicketEntry.count({ where: { serviceTicketId: t.id } })).toBe(0);
  }
  async function unchanged(fn: () => Promise<unknown>, error: string) {
    const before = await snapshotTables(h.prisma, refTables);
    await expect(fn()).rejects.toMatchObject({ error });
    await assertSnapshotsEqual(before, await snapshotTables(h.prisma, refTables));
  }
  async function ownOrderActor(f: Fixture): Promise<CancelActor> {
    await h.prisma.store.update({
      where: { id: f.ad.storeId },
      data: { deliveryManagerId: f.requester.staff!.staff.id },
    });
    return {
      ...f.requester,
      staff: {
        ...f.requester.staff!,
        permissions: new Set(["order.refund.request"] as const),
        moduleLevels: { ...f.requester.staff!.moduleLevels, service: "n" },
        scope: ownTaskScope(f.requester.staff!.staff),
      },
    };
  }

  it.each(states)("%s历史工单均可关联，引用真实审批且工单与条目零改动", async (status) => {
    const f = await fixture(),
      t = await ticket(f, { status });
    const r = await link(f, t);
    expect(r.status).toBe("pending_approval");
    await expectLink(f, t, r);
    expect((await adNow(f)).openCancelRequestId).toBe(r.id);
    expect((await holdNow(f)).status).toBe("held");
    for (const [eventType, aggregateId] of [
      ["approval.submitted", r.approvalRequestId],
      ["cancel.submitted", r.id],
    ] as const)
      expect(await h.prisma.outboxEvent.count({ where: { eventType, aggregateId } })).toBe(1);
  });

  it("没有companion仍走原取消公口，不创建客服引用或关联审计", async () => {
    const f = await fixture(),
      t = await ticket(f),
      r = await submit(f);
    expect(r.status).toBe("pending_approval");
    expect(await linked(t.id)).toEqual([]);
    expect(await refAudits(t.id)).toEqual([]);
    expect(await h.prisma.serviceTicket.findUniqueOrThrow({ where: { id: t.id } })).toEqual(t);
  });

  it("仅原order权限且工单负责人在本人任务范围外仍允许同店历史关联", async () => {
    const f = await fixture(),
      actor = await ownOrderActor(f);
    const t = await ticket(f, { ownerStaffId: f.approver.staff!.staff.id });
    expect(actor.staff!.permissions.size).toBe(1);
    expect(actor.staff!.moduleLevels.service).toBe("n");
    expect(actor.staff!.scope).toMatchObject({ kind: "staff", staffIds: [actor.staff!.staff.id] });
    const r = await link(f, t, actor);
    await expectLink(f, t, r, actor);
  });

  it("本人order范围不带待分配池，owner为空工单仍可历史关联", async () => {
    const f = await fixture(),
      actor = await ownOrderActor(f),
      t = await ticket(f);
    expect(t.ownerStaffId).toBeNull();
    if (actor.staff!.scope.kind === "staff") expect(actor.staff!.scope.unassigned.size).toBe(0);
    await expectLink(f, t, await link(f, t, actor), actor);
  });

  it.each(["merchant", "system"] as const)("%s不能借companion绕过员工提交身份", async (kind) => {
    const f = await fixture(),
      t = await ticket(f);
    const actor: CancelActor = {
      ctx: createIdentityContext({
        actor:
          kind === "merchant"
            ? { type: "merchant", id: f.merchant.user.id, client: "weapp", role: "owner" }
            : { type: "system", job: "lyxtest.support_ref" },
      }),
    };
    await unchanged(() => link(f, t, actor), "PERMISSION_DENIED");
  });

  it("ctx与StaffContext员工ID不符时关联不能产生半申请", async () => {
    const f = await fixture(),
      t = await ticket(f);
    await unchanged(
      () => link(f, t, { ...f.requester, staff: f.approver.staff }),
      "PERMISSION_DENIED",
    );
  });

  it("缓存上下文仍有权限而库中员工已禁用，原提交守卫拒绝", async () => {
    const f = await fixture(),
      t = await ticket(f);
    await h.prisma.staff.update({
      where: { id: f.requester.staff!.staff.id },
      data: {
        status: "disabled",
        disabledAt: h.clock.now(),
        disabledReason: "other",
        disabledByStaffId: f.approver.staff!.staff.id,
      },
    });
    await unchanged(() => link(f, t), "PERMISSION_DENIED");
  });

  it("没有原order.refund.request权限，客服工单存在也不能提交", async () => {
    const f = await fixture(),
      t = await ticket(f);
    const actor = {
      ...f.requester,
      staff: { ...f.requester.staff!, permissions: new Set<never>() },
    };
    await unchanged(() => link(f, t, actor), "PERMISSION_DENIED");
  });

  it("发起权限未标再验证，过期上下文仍按原注册表允许并关联", async () => {
    const f = await fixture(),
      t = await ticket(f);
    const actor = {
      ...f.requester,
      staff: {
        ...f.requester.staff!,
        stepUpAt: new Date(h.clock.now().getTime() - 600_001),
      },
    };
    expect(requiresStepUp("order.refund.request")).toBe(false);
    const r = await link(f, t, actor);
    expect(r.status).toBe("pending_approval");
    await expectLink(f, t, r, actor);
  });

  it("广告不在原order范围内仍404且不泄露同店工单", async () => {
    const f = await fixture(),
      t = await ticket(f);
    const actor = {
      ...f.requester,
      staff: {
        ...f.requester.staff!,
        scope: ownTaskScope(f.requester.staff!.staff),
      },
    };
    await unchanged(() => link(f, t, actor), "NOT_FOUND");
  });

  it.each(["missing", "same_entity_other_store", "other_entity"] as const)(
    "%s工单均404，原广告、审批、账本和审计全部零写",
    async (kind) => {
      const f = await fixture();
      let t: Ticket;
      if (kind === "missing") t = { ...(await ticket(f)), id: uuidv7() };
      else if (kind === "same_entity_other_store") {
        const store = await h.make.store({ entityId: f.ad.entityId });
        t = await ticket(f, { storeId: store.id });
      } else {
        const other = await h.make.merchant({ verified: true });
        t = await ticket(f, { entityId: other.entity.id, storeId: other.store.id });
      }
      await unchanged(() => link(f, t), "NOT_FOUND");
    },
  );

  it("真实重算expect不符回滚早270后的所有财务推进与关联", async () => {
    const f = await fixture(),
      t = await ticket(f);
    await unchanged(
      () =>
        createAdCancel(f.deps).submit(
          f.requester,
          f.ad.id,
          {
            ...f.body,
            expect: { totalRefundPoints: f.body.expect.totalRefundPoints + 1 },
          },
          undefined,
          companion(t),
        ),
      "CANCEL_QUOTE_CHANGED",
    );
  });

  it("真实在办订单项绑定阻断广告，已预锁工单也不残留引用", async () => {
    const f = await fixture(),
      t = await ticket(f),
      { item } = await boundItem(f);
    // No M5 binding writer exists; this is only the legal upstream placement fixture.
    await h.prisma.orderItemPlacement.create({
      data: {
        id: uuidv7(),
        orderItemId: item.id,
        slot: "opening",
        adId: f.ad.id,
        durationSec: f.ad.durationSec,
        createdAt: h.clock.now(),
        updatedAt: h.clock.now(),
      },
    });
    await unchanged(() => link(f, t), "AD_NOT_CANCELLABLE");
  });

  it("真实早回调锁完270后故障，首次ledger尚未调用且全链回滚", async () => {
    const f = await fixture(),
      t = await ticket(f),
      real = companion(t);
    const before = await snapshotTables(h.prisma, refTables);
    let calls = 0;
    const d = deps({
      ledger: {
        ...h.ledger,
        lockAccount: async (...args) => {
          calls++;
          return h.ledger.lockAccount(...args);
        },
      },
    });
    await expect(
      link(f, t, f.requester, d, {
        ...real,
        beforeAccount: async (tx, target) => {
          await real.beforeAccount(tx, target);
          throw new Error("after-real-support-270");
        },
      }),
    ).rejects.toThrow("after-real-support-270");
    expect(calls).toBe(0);
    await assertSnapshotsEqual(before, await snapshotTables(h.prisma, refTables));
  });

  it("真实晚引用和audit.record已写后故障，审批、取消、积分及审计同事务撤销", async () => {
    const f = await fixture(),
      t = await ticket(f),
      real = companion(t);
    const before = await snapshotTables(h.prisma, refTables);
    await expect(
      link(f, t, f.requester, f.deps, {
        ...real,
        afterCreated: async (tx, target) => {
          await real.afterCreated(tx, target);
          expect(
            await tx.serviceTicketRef.count({
              where: {
                serviceTicketId: t.id,
                refType: "approval_request",
                refId: target.approvalId,
              },
            }),
          ).toBe(1);
          expect(
            await tx.auditLog.count({
              where: {
                targetId: t.id,
                action: "support.service_ticket.ref_add",
              },
            }),
          ).toBe(1);
          throw new Error("after-real-support-ref-and-audit");
        },
      }),
    ).rejects.toThrow("after-real-support-ref-and-audit");
    await assertSnapshotsEqual(before, await snapshotTables(h.prisma, refTables));
  });

  it("自动全额释放实际完成后仍关联真实审批，关联审计保原staff且createdAt取审批提交时刻", async () => {
    const f = await fixture(),
      t = await ticket(f),
      before = await observe(f);
    await param("refund.points.auto_approve_before_production", true, f.requester.staff!.staff.id);
    const r = await link(f, t),
      row = await req(r.id);
    expect(r.status).toBe("done");
    expect(row.approvalRequest).toMatchObject({
      status: "approved",
      isDecidedBySystem: true,
      decidedByStaffId: null,
    });
    expect(row.cancelRequestLines[0]).toMatchObject({
      returnedPoints: r.totalRefundPoints,
      convertedPoints: 0,
      forfeitedPoints: 0,
    });
    await expectLink(f, t, r);
    expect((await holdNow(f)).status).toBe("released");
    expect((await adNow(f)).status).toBe("cancelled");
    expect(
      await h.prisma.ledgerOperation.count({
        where: { entityId: f.ad.entityId, opType: "release" },
      }),
    ).toBe(before.operations.filter((op) => op.opType === "release").length + 1);
    for (const [eventType, aggregateId] of [
      ["approval.executed", r.approvalRequestId],
      ["cancel.executed", r.id],
      ["ad.cancelled", f.ad.id],
    ] as const)
      expect(await h.prisma.outboxEvent.count({ where: { eventType, aggregateId } })).toBe(1);
  });

  it("调用方未提交时自身可见完整引用与审计，独立连接不可见，外层失败全撤销", async () => {
    const f = await fixture(),
      t = await ticket(f),
      before = await snapshotTables(h.prisma, refTables);
    let approvalId = "";
    await expect(
      h.tx.run(async (tx) => {
        const r = await submitAdCancel(tx, f.deps, f.requester, f.ad.id, f.body, companion(t));
        approvalId = r.approvalRequestId;
        expect(await tx.cancelRequest.findUnique({ where: { id: r.id } })).not.toBeNull();
        expect(
          await tx.serviceTicketRef.count({
            where: {
              serviceTicketId: t.id,
              refType: "approval_request",
              refId: approvalId,
            },
          }),
        ).toBe(1);
        expect(
          await tx.auditLog.count({
            where: {
              targetId: t.id,
              action: "support.service_ticket.ref_add",
            },
          }),
        ).toBe(1);
        expect(await h.prisma.approvalRequest.findUnique({ where: { id: approvalId } })).toBeNull();
        expect(await linked(t.id)).toEqual([]);
        expect(await refAudits(t.id)).toEqual([]);
        throw new Error("outer-support-ref-rollback");
      }),
    ).rejects.toThrow("outer-support-ref-rollback");
    expect(approvalId).not.toBe("");
    await assertSnapshotsEqual(before, await snapshotTables(h.prisma, refTables));
  });

  it("伪造缺失早回调或把现有审批ID当新分配ID，真实writer均拒绝", async () => {
    const f = await fixture(),
      t = await ticket(f),
      real = companion(t);
    await unchanged(
      () =>
        link(f, t, f.requester, f.deps, {
          beforeAccount: async () => undefined,
          afterCreated: real.afterCreated,
        }),
      "INTERNAL",
    );
    const r = await submit(f);
    const target: Target = {
      actor: f.requester,
      approvalId: r.approvalRequestId,
      adId: f.ad.id,
      entityId: f.ad.entityId,
      storeId: f.ad.storeId,
    };
    await unchanged(() => h.tx.run((tx) => companion(t).beforeAccount(tx, target)), "INTERNAL");
  });

  it("晚回调clone早回调的target不能继承同事务capability，整份真实申请回滚", async () => {
    const f = await fixture(),
      t = await ticket(f),
      real = companion(t);
    let original: Target | undefined;
    await unchanged(
      () =>
        link(f, t, f.requester, f.deps, {
          beforeAccount: async (tx, target) => {
            original = target;
            await real.beforeAccount(tx, target);
          },
          afterCreated: async (tx, target) => {
            expect(target).toBe(original);
            expect(
              await tx.approvalRequest.findUnique({
                where: { id: target.approvalId },
              }),
            ).not.toBeNull();
            await real.afterCreated(tx, { ...target });
          },
        }),
      "INTERNAL",
    );
  });

  it("已真实提交的原target换事务不可重放，既有引用与审批原样保留", async () => {
    const f = await fixture(),
      t = await ticket(f),
      real = companion(t);
    let captured!: Target;
    const r = await link(f, t, f.requester, f.deps, {
      beforeAccount: async (tx, target) => {
        captured = target;
        await real.beforeAccount(tx, target);
      },
      afterCreated: real.afterCreated,
    });
    await expectLink(f, t, r);
    await unchanged(() => h.tx.run((tx) => real.afterCreated(tx, captured)), "INTERNAL");
    await expectLink(f, t, r);
  });

  it("同Tx同原target在自动approved之后晚回调重入，引用与审计只一行", async () => {
    const f = await fixture(),
      t = await ticket(f),
      real = companion(t);
    await param("refund.points.auto_approve_before_production", true, f.requester.staff!.staff.id);
    let captured!: Target;
    const hooks: Companion = {
      beforeAccount: async (tx, target) => {
        captured = target;
        await real.beforeAccount(tx, target);
      },
      afterCreated: async (tx, target) => {
        expect(target).toBe(captured);
        await real.afterCreated(tx, target);
        await real.afterCreated(tx, target);
      },
    };
    const r = await h.tx.run(async (tx) => {
      const result = await submitAdCancel(tx, f.deps, f.requester, f.ad.id, f.body, hooks);
      expect(result.status).toBe("done");
      expect(
        (
          await tx.approvalRequest.findUniqueOrThrow({
            where: { id: result.approvalRequestId },
          })
        ).status,
      ).toBe("approved");
      await real.afterCreated(tx, captured);
      return result;
    });
    await expectLink(f, t, r);
    expect(
      await h.prisma.ledgerOperation.count({
        where: { entityId: f.ad.entityId, opType: "release" },
      }),
    ).toBe(1);
  });

  it("真实270锁等待由PG双方PID确认，释放前首次ledger锁账户调用为零", async () => {
    const f = await fixture(),
      t = await ticket(f);
    let writerPid = 0,
      waiterPid = 0,
      accountCalls = 0;
    let locked!: () => void, release!: () => void, entered!: () => void;
    const held = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const proceed = new Promise<void>((resolve) => {
      release = resolve;
    });
    const connected = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const writer = h.tx.run(async (tx) => {
      writerPid = (
        await tx.$queryRawUnsafe<{ pid: number }[]>("SELECT pg_backend_pid() AS pid")
      )[0]!.pid;
      await lockRows(tx, "service_ticket", [t.id]);
      locked();
      await proceed;
    });
    await held;
    const d = deps({
      tx: {
        ...h.tx,
        run: (fn, options) =>
          h.tx.run(async (tx) => {
            waiterPid = (
              await tx.$queryRawUnsafe<{ pid: number }[]>("SELECT pg_backend_pid() AS pid")
            )[0]!.pid;
            entered();
            return fn(tx);
          }, options),
      },
      ledger: {
        ...h.ledger,
        lockAccount: async (...args) => {
          accountCalls++;
          return h.ledger.lockAccount(...args);
        },
      },
    });
    const waiter = link(f, t, f.requester, d).then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
    const observer = createPrismaClient({
      connectionString: testDatabaseUrl(db.name, { role: null }),
      max: 1,
    });
    try {
      await connected;
      expect(writerPid).toBeGreaterThan(0);
      expect(waiterPid).not.toBe(writerPid);
      let blocked = false;
      for (let attempt = 0; attempt < 200; attempt++) {
        const [backend] = await observer.$queryRawUnsafe<
          {
            waiting: boolean;
            blockers: number[];
            query: string;
          }[]
        >(
          "SELECT wait_event_type = 'Lock' AS waiting, pg_blocking_pids(pid) AS blockers, query FROM pg_stat_activity WHERE pid = $1",
          waiterPid,
        );
        if (backend?.waiting) {
          expect(backend.blockers).toContain(writerPid);
          expect(backend.query).toContain('FROM "service_ticket"');
          expect(accountCalls).toBe(0);
          expect(await linked(t.id)).toEqual([]);
          console.warn("support ad cancel ticket prelock observed", {
            writerPid,
            waiterPid,
            ticketId: t.id,
            adId: f.ad.id,
            blockers: backend.blockers,
          });
          blocked = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(blocked).toBe(true);
      h.clock.advance(1);
      release();
      await writer;
      const result = await waiter;
      expect(result).toMatchObject({ value: { status: "pending_approval" } });
      if (!("value" in result)) throw new Error("support-ref waiter failed");
      expect(accountCalls).toBeGreaterThan(0);
      await expectLink(f, t, result.value);
    } finally {
      release();
      await Promise.allSettled([writer, waiter]);
      await observer.$disconnect();
    }
  });

  async function twoConnections(first: Fixture, second: Fixture, t: Ticket) {
    let enter = 0,
      open!: () => void;
    const both = new Promise<void>((resolve) => {
      open = resolve;
    });
    const pids: number[] = [];
    const run = (f: Fixture) =>
      h.tx.run(async (tx) => {
        pids.push(
          (await tx.$queryRawUnsafe<{ pid: number }[]>("SELECT pg_backend_pid() AS pid"))[0]!.pid,
        );
        if (++enter === 2) open();
        await both;
        return submitAdCancel(tx, f.deps, f.requester, f.ad.id, f.body, companion(t));
      });
    const outcomes = await Promise.allSettled([run(first), run(second)]);
    expect(new Set(pids).size).toBe(2);
    return outcomes;
  }

  it(
    "二十轮同工单不同广告使用实际双连接，都保真实各一审批引用和审计",
    { timeout: 120_000 },
    async () => {
      for (let round = 0; round < 20; round++) {
        const f = await fixture();
        const g = await fixture({ tenant: { merchant: f.merchant, term: f.term } });
        const t = await ticket(f),
          outcomes = await twoConnections(f, g, t);
        expect(outcomes.every((outcome) => outcome.status === "fulfilled")).toBe(true);
        const ids = outcomes.flatMap((outcome) =>
          outcome.status === "fulfilled" ? [outcome.value.approvalRequestId] : [],
        );
        expect(await linked(t.id)).toHaveLength(2);
        expect((await linked(t.id)).map((ref) => ref.refId).sort()).toEqual(ids.sort());
        expect(await refAudits(t.id)).toHaveLength(2);
        expect(
          await h.prisma.cancelRequest.count({
            where: { entityId: f.ad.entityId, kind: "ad_cancel" },
          }),
        ).toBe(2);
        expect((await holdNow(f)).status).toBe("held");
        expect((await holdNow(g)).status).toBe("held");
        expect(await h.prisma.serviceTicket.findUniqueOrThrow({ where: { id: t.id } })).toEqual(t);
      }
    },
  );

  it("二十轮同广告同工单双连接竞争只有一套真实申请引用审计", { timeout: 120_000 }, async () => {
    for (let round = 0; round < 20; round++) {
      const f = await fixture(),
        t = await ticket(f);
      const outcomes = await twoConnections(f, f, t);
      const ok = outcomes.filter((outcome) => outcome.status === "fulfilled");
      expect(ok).toHaveLength(1);
      expect(outcomes.find((outcome) => outcome.status === "rejected")).toMatchObject({
        reason: { error: "AD_CANCEL_IN_PROGRESS" },
      });
      if (ok[0]?.status !== "fulfilled") throw new Error("missing real support-ref winner");
      const r = ok[0].value;
      await expectLink(f, t, r);
      expect(
        await h.prisma.cancelRequest.count({
          where: { adId: f.ad.id, kind: "ad_cancel" },
        }),
      ).toBe(1);
      expect((await adNow(f)).openCancelRequestId).toBe(r.id);
      expect((await holdNow(f)).status).toBe("held");
      for (const [eventType, aggregateId] of [
        ["approval.submitted", r.approvalRequestId],
        ["cancel.submitted", r.id],
      ] as const)
        expect(await h.prisma.outboxEvent.count({ where: { eventType, aggregateId } })).toBe(1);
    }
  });

  it("真实驳回撤回作废执行均保历史审批引用与旧广告引用，不造客服业务事件条目", async () => {
    for (const action of ["reject", "withdraw", "void", "execute"] as const) {
      const f = await fixture(),
        t = await ticket(f);
      // This is an unrelated historical upstream ref; the tested approval ref only uses the real writer.
      await h.prisma.serviceTicketRef.create({
        data: {
          serviceTicketId: t.id,
          refType: "ad",
          refId: f.ad.id,
          createdAt: h.clock.now(),
        },
      });
      const r = await link(f, t);
      const before = await linked(t.id),
        audits = await refAudits(t.id);
      if (action === "reject")
        await f.service.reject(f.approver, r.id, { note: "真实驳回保留客服历史" });
      else if (action === "withdraw")
        await f.service.withdraw(f.requester, r.id, { note: "本人撤回保留历史" });
      else {
        const approved = await approve(f, r);
        if (action === "void")
          await f.service.void(f.requester, r.id, { note: "本人作废保留历史" });
        else await execute(f, approved);
      }
      expect(await linked(t.id)).toEqual(before);
      expect(await refAudits(t.id)).toEqual(audits);
      expect(before.filter((ref) => ref.refType === "ad")).toHaveLength(1);
      expect(before.find((ref) => ref.refType === "approval_request")?.refId).toBe(
        r.approvalRequestId,
      );
      expect(await h.prisma.serviceTicketEntry.count({ where: { serviceTicketId: t.id } })).toBe(0);
      expect(await h.prisma.serviceTicket.findUniqueOrThrow({ where: { id: t.id } })).toEqual(t);
    }
  });
});
