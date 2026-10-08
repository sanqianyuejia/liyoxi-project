import { expect, it } from "vitest";
import { PlanContentSchema } from "@liyoxi/contract";
import { createIdentityContext } from "../kernel/index.js";
import { runInvariants } from "../ops/index.js";
import { createTenant } from "../tenant/index.js";
import { createFactories } from "./data/factories/index.js";
import { createP95Fixture } from "./p95-fixture.js";
import type { P95Dataset } from "./p95-fixture.js";
import { openSealed, testSealer } from "./data/seal.js";

it("真实 prototype 和两个 UUID 克隆保留完整开工方案/工单图、归属与全部实际 full 检查", async () => {
  const fixture = await createP95Fixture({ scale: 0.006, seed: 42 });
  const { runtime, clock } = fixture.support;
  try {
    await fixture.loginAgreements();
    const user = await runtime.tx.run((tx) =>
      createFactories({ db: tx, clock }).merchantUser({ phone: "13610000000" }),
    );
    const scope = await createTenant({
      tx: runtime.tx,
      clock,
      flow: runtime.flow,
      assembly: runtime.assembly,
    }).createEntity(
      createIdentityContext({ actor: { type: "merchant", id: user.id, client: "weapp" } }),
    );
    const seeded = await fixture.seed({ ...scope, merchantUserId: user.id, phone: "13610000000" });
    expect(seeded.scopes).toHaveLength(3);
    expect(seeded.counts).toMatchObject({
      drama_order: 12,
      order_item: 12,
      delivery_plan: 12,
      delivery_plan_version: 0,
      delivery_ticket: 12,
      delivery_ticket_stage: 12,
      point_ledger_entry: 588,
      qualification_submission: 3,
      qualification_doc: 3,
      drama: 6,
      drama_copyright_revision: 6,
      drama_episode: 18,
    });
    expect(seeded.generation?.mode).toBe("prototype_uuid_graph_copy");
    expect(seeded.generation?.prototypeRelay.expanded).toBeGreaterThan(0);
    expect(seeded.generation?.prototypeEventTypes.length).toBeGreaterThan(0);
    await runtime.tx.run(async (tx) => {
      const sourceEvents = await tx.outboxEvent.groupBy({
        by: ["eventType"],
        where: { entityId: seeded.scopes[0]!.entityId },
        _count: true,
      });
      expect(seeded.generation?.prototypeEventTypes).toEqual(
        sourceEvents
          .sort((a, b) => a.eventType.localeCompare(b.eventType))
          .map((row) => ({
            type: row.eventType,
            events: row._count,
            implementedSubscribers: runtime.events.subscribers
              .forEvent(row.eventType)
              .map((subscriber) => subscriber.name),
          })),
      );
      const matchedDeliveryCount = sourceEvents.reduce(
        (sum, row) => sum + row._count * runtime.events.subscribers.forEvent(row.eventType).length,
        0,
      );
      expect(
        await tx.outboxDelivery.count({
          where: { outboxEvent: { entityId: seeded.scopes[0]!.entityId } },
        }),
      ).toBe(matchedDeliveryCount);
      const plans = await tx.deliveryPlan.findMany({
        include: { dramaOrder: { include: { orderItems: true } }, deliveryPlanVersions: true },
      });
      const tickets = await tx.deliveryTicket.findMany();
      const prototype = seeded.scopes[0]!;
      let expectedEvents: number | undefined, expectedDeliveries: number | undefined;
      for (const owned of seeded.scopes) {
        const entity = await tx.entity.findUniqueOrThrow({ where: { id: owned.entityId } });
        const profile = await tx.storeProfile.findUniqueOrThrow({
          where: { storeId: owned.storeId },
        });
        const round = await tx.qualificationSubmission.findUniqueOrThrow({
          where: { id: profile.effectiveQualificationSubmissionId! },
        });
        const doc = await tx.qualificationDoc.findFirstOrThrow({
          where: { qualificationSubmissionId: round.id },
          include: { file: true },
        });
        expect(round).toMatchObject({
          entityId: owned.entityId,
          storeId: owned.storeId,
          outcome: "approved",
          submittedByUserId: owned.merchantUserId,
        });
        expect(round.contactSnapshot).toMatchObject({
          phoneMask: testSealer.phone("merchant_user.phone_enc", owned.phone).mask,
        });
        expect(doc).toMatchObject({
          entityId: owned.entityId,
          storeId: owned.storeId,
          verdict: "accepted",
          holderName: entity.name,
        });
        const uscc = openSealed("entity.uscc_enc", entity.usccEnc!);
        expect(openSealed("qualification_doc.cert_no_enc", doc.certNoEnc!)).toBe(uscc);
        expect(Buffer.from(doc.certNoBidx!).equals(Buffer.from(entity.usccBidx!))).toBe(true);
        expect(
          JSON.parse(openSealed("qualification_doc.submitted_fields_enc", doc.submittedFieldsEnc!)),
        ).toMatchObject({ name: entity.name, uscc });
        expect(doc.file.sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(
          await tx.fileRef.count({
            where: {
              refType: "qualification_doc",
              refId: doc.id,
              fileId: doc.fileId,
              state: "live",
            },
          }),
        ).toBe(1);
        const events = await tx.outboxEvent.findMany({
          where: { entityId: owned.entityId },
          include: { outboxDeliveries: true },
        });
        expect(
          events.every(
            (event) =>
              event.publishedAt !== null &&
              (event.storeId === null || event.storeId === owned.storeId),
          ),
        ).toBe(true);
        const deliveries = events.flatMap((event) => event.outboxDeliveries);
        expect(
          deliveries.every(
            (delivery) => delivery.status === "done" && delivery.consumedAt !== null,
          ),
        ).toBe(true);
        expectedEvents ??= events.length;
        expectedDeliveries ??= deliveries.length;
        expect(events).toHaveLength(expectedEvents);
        expect(deliveries).toHaveLength(expectedDeliveries);
        if (owned.entityId !== prototype.entityId)
          expect(
            JSON.stringify(events, (_key, value: unknown) =>
              typeof value === "bigint" ? value.toString() : value,
            ),
          ).not.toContain(prototype.entityId);
        const ownedPlans = plans.filter((p) => owned.orderIds.includes(p.dramaOrderId));
        expect(ownedPlans).toHaveLength(4);
        for (const plan of ownedPlans) {
          expect(plan.entityId).toBe(owned.entityId);
          expect(plan.storeId).toBe(owned.storeId);
          expect(plan.status).toBe("drafting");
          expect(plan.deliveryPlanVersions).toHaveLength(0);
          const draft = PlanContentSchema.parse(plan.draft);
          expect(draft.items.map((item) => item.orderItemId).sort()).toEqual(
            plan.dramaOrder.orderItems.map((item) => item.id).sort(),
          );
          expect(draft.items[0]!.accounts[0]!.channelAccountId).toBe(owned.channelAccountId);
          const ticket = tickets.filter((t) => t.dramaOrderId === plan.dramaOrderId);
          expect(ticket).toHaveLength(1);
          expect(ticket[0]).toMatchObject({
            entityId: owned.entityId,
            storeId: owned.storeId,
            orderItemId: draft.items[0]!.orderItemId,
            step: "assigning",
          });
        }
      }
      expect(await tx.outboxEvent.count({ where: { publishedAt: null } })).toBe(0);
      expect(await tx.outboxDelivery.count({ where: { status: { not: "done" } } })).toBe(0);
    });
    const checked = await runInvariants(
      { tx: runtime.tx, assembly: runtime.assembly, clock },
      { mode: "full", trigger: "manual" },
    );
    expect(checked.errors).toEqual([]);
    const found = await runtime.tx.run(
      (tx) => tx.$queryRaw<{ code: string; count: bigint; detail: unknown }[]>`
      SELECT code, count(*) AS count, (array_agg(detail))[1] AS detail
      FROM invariant_violation WHERE invariant_run_id=${checked.runId}::uuid GROUP BY code ORDER BY code`,
    );
    expect(
      found.map(({ code, count, detail }) => ({ code, count: Number(count), detail })),
    ).toEqual([]);
    expect(checked).toMatchObject({ status: "succeeded", checksRun: 91, violationsFound: 0 });
  } finally {
    await fixture.close();
  }
}, 60_000);

async function seedReportFixture(fixture: Awaited<ReturnType<typeof createP95Fixture>>) {
  const { runtime, clock } = fixture.support;
  await fixture.loginAgreements();
  const user = await runtime.tx.run((tx) =>
    createFactories({ db: tx, clock }).merchantUser({ phone: "13610000000" }),
  );
  const scope = await createTenant({ ...runtime }).createEntity(
    createIdentityContext({ actor: { type: "merchant", id: user.id, client: "weapp" } }),
  );
  return fixture.seed({ ...scope, merchantUserId: user.id, phone: "13610000000" });
}

it("P95报告：seed回调保存真实invariantRun ID，未查询历史未解决记录为null", async () => {
  const seen: P95Dataset[] = [];
  const fixture = await createP95Fixture({
    scale: 0.002,
    seed: 42,
    runId: "w224rptseed",
    dataset: (dataset) => seen.push(dataset),
  });
  try {
    const seeded = await seedReportFixture(fixture);
    expect(seen).toHaveLength(1);
    const run = await fixture.support.runtime.tx.run((tx) =>
      tx.invariantRun.findUniqueOrThrow({
        where: { id: seeded.invariants.runId },
        select: { id: true, status: true, checksRun: true, violationsFound: true },
      }),
    );
    expect(run).toMatchObject({ status: "succeeded", checksRun: 91, violationsFound: 0 });
    expect(seen[0]!.invariants).toMatchObject({
      runId: run.id,
      persistedUnresolved: null,
      status: run.status,
      checksRun: run.checksRun,
      violations: run.violationsFound,
    });
  } finally {
    await fixture.close();
  }
}, 60_000);

it("P95报告：真实缓存漂移按持久化未解决code计数，重复run仍保留firstRun，恢复后未查为null", async () => {
  const seen: P95Dataset[] = [];
  const fixture = await createP95Fixture({
    scale: 0.002,
    seed: 42,
    runId: "w224rptfail",
    dataset: (dataset) => seen.push(dataset),
  });
  const { runtime } = fixture.support;
  try {
    const seeded = await seedReportFixture(fixture);
    const entityId = seeded.scopes[0]!.entityId;
    const original = await runtime.tx.run((tx) =>
      tx.billingAccount.findUniqueOrThrow({
        where: { entityId },
        select: { planAvailableQty: true },
      }),
    );
    await runtime.tx.run((tx) =>
      tx.billingAccount.update({
        where: { entityId },
        data: { planAvailableQty: { increment: 1 } },
      }),
    );
    const runIds = () => runtime.tx.run((tx) => tx.invariantRun.findMany({ select: { id: true } }));
    const persisted = () =>
      runtime.tx.run((tx) =>
        tx.invariantViolation.groupBy({
          by: ["code"],
          where: { resolvedAt: null },
          _count: { _all: true },
          orderBy: { code: "asc" },
        }),
      );
    const firstRuns = () =>
      runtime.tx.run((tx) =>
        tx.invariantViolation.findMany({
          where: { code: "billing.I3", resolvedAt: null },
          select: { invariantRunId: true },
        }),
      );
    const before = new Set((await runIds()).map((row) => row.id));
    await expect(fixture.validatePrepared()).rejects.toThrow("P95数据不变量未通过");
    const foundA = (await runIds()).filter((row) => !before.has(row.id));
    expect(foundA).toHaveLength(1);
    const runA = foundA[0]!.id;
    const failedA = seen.at(-1)!;
    const countsA = await persisted();
    expect(countsA.find((row) => row.code === "billing.I3")?._count._all).toBe(1);
    expect(await firstRuns()).toEqual([{ invariantRunId: runA }]);
    const beforeRepeat = new Set((await runIds()).map((row) => row.id));
    await expect(fixture.validatePrepared()).rejects.toThrow("P95数据不变量未通过");
    const foundB = (await runIds()).filter((row) => !beforeRepeat.has(row.id));
    expect(foundB).toHaveLength(1);
    const runB = foundB[0]!.id;
    const failedB = seen.at(-1)!;
    const countsB = await persisted();
    expect(runB).not.toBe(runA);
    expect(countsB).toEqual(countsA);
    expect(await firstRuns()).toEqual([{ invariantRunId: runA }]);
    await runtime.tx.run((tx) =>
      tx.billingAccount.update({
        where: { entityId },
        data: { planAvailableQty: original.planAvailableQty },
      }),
    );
    const restored = await fixture.validatePrepared();
    expect(restored.invariants).toMatchObject({
      status: "succeeded",
      checksRun: 91,
      violations: 0,
    });
    expect(await persisted()).toEqual(countsB);
    for (const [dataset, runId, counts] of [
      [failedA, runA, countsA],
      [failedB, runB, countsB],
    ] as const) {
      expect(dataset.invariants.violations).toBeGreaterThan(0);
      expect(dataset.invariants).toMatchObject({
        runId,
        persistedUnresolved: {
          scope: "owned_database_unresolved_records",
          perRun: false,
          status: "queried",
          byCode: counts.map((row) => ({ code: row.code, records: row._count._all })),
          unregisteredCodeRecords: 0,
        },
      });
      expect(JSON.stringify(dataset)).not.toMatch(
        /"(?:subject|subjectId|subjectKey|detail|phone|token)":/,
      );
    }
    expect(restored.invariants).toMatchObject({ persistedUnresolved: null });
  } finally {
    await fixture.close();
  }
}, 60_000);

it("额外新付款 buyer 有真实完整资格图且没有伪套餐/积分，采样前全91检查覆盖新增输入", async () => {
  const fixture = await createP95Fixture({ scale: 0.002, seed: 42 });
  const { runtime, clock } = fixture.support;
  const tenant = createTenant({ ...runtime });
  const merchant = async (phone: string) => {
    const user = await runtime.tx.run((tx) =>
      createFactories({ db: tx, clock }).merchantUser({ phone }),
    );
    const scope = await tenant.createEntity(
      createIdentityContext({ actor: { type: "merchant", id: user.id, client: "weapp" } }),
    );
    return { ...scope, merchantUserId: user.id, phone };
  };
  try {
    await fixture.loginAgreements();
    const base = await fixture.seed(await merchant("13610000000"));
    const buyer = await merchant("13620000000");
    await fixture.prepareBuyer(buyer);
    const actual = await fixture.validatePrepared();
    expect(actual.invariants).toMatchObject({
      status: "succeeded",
      checksRun: 91,
      violations: 0,
      errors: [],
    });
    expect(actual.counts).toMatchObject({
      entity: 2,
      store: 2,
      qualification_submission: 2,
      qualification_doc: 2,
      point_ledger_entry: 196,
    });
    expect(actual.entryKinds).toEqual(base.entryKinds);
    await runtime.tx.run(async (tx) => {
      const account = await tx.billingAccount.findUniqueOrThrow({
        where: { entityId: buyer.entityId },
      });
      expect(account).toMatchObject({
        subStatus: "none",
        currentSubscriptionTermId: null,
        planAvailableQty: 0,
        addonAvailableQty: 0,
      });
      expect(await tx.subscriptionTerm.count({ where: { entityId: buyer.entityId } })).toBe(0);
      expect(await tx.pointLot.count({ where: { entityId: buyer.entityId } })).toBe(0);
      expect(await tx.outboxEvent.count({ where: { publishedAt: null } })).toBe(0);
    });
  } finally {
    await fixture.close();
  }
}, 60_000);
