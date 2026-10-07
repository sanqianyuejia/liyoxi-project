import { expect, it } from "vitest";
import { PlanContentSchema } from "@liyoxi/contract";
import { createIdentityContext } from "../kernel/index.js";
import { runInvariants } from "../ops/index.js";
import { createTenant } from "../tenant/index.js";
import { createFactories } from "./data/factories/index.js";
import { createP95Fixture } from "./p95-fixture.js";
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
    expect(checked).toMatchObject({ status: "succeeded", checksRun: 89, violationsFound: 0 });
  } finally {
    await fixture.close();
  }
}, 60_000);

it("额外新付款 buyer 有真实完整资格图且没有伪套餐/积分，采样前全89检查覆盖新增输入", async () => {
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
      checksRun: 89,
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
