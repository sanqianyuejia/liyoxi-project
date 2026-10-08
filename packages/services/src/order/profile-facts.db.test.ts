import { beforeAll, expect, it } from "vitest";
import { createOrderService } from "./index.js";
import { useSeededDatabase } from "../testing/index.js";
import type { Tx } from "../kernel/index.js";
import { uuidv7 } from "../kernel/index.js";
import { profileChecks } from "./checks.js";
import { body, buyer, drama, harness, residual, version } from "./__fixtures__/harness.js";
import type { Harness } from "./__fixtures__/harness.js";

const database = useSeededDatabase("services");
let h: Harness;
beforeAll(async () => {
  h = harness(await database.prisma());
  await version(h);
}, 120000);

/** Decorate only this private read path; each query/side effect uses the original actual Tx. */
function afterFacts(tx: Tx, after: () => Promise<void>) {
  let reads = 0;
  return {
    tx: new Proxy(tx, {
      get(target, key, receiver) {
        if (key !== "$queryRaw") return Reflect.get(target, key, receiver);
        return async (...args: unknown[]) => {
          const result: unknown = await Reflect.apply(target.$queryRaw, target, args);
          reads++;
          await after();
          return result;
        };
      },
    }),
    reads: () => reads,
  };
}

it("多问题拒绝优先级：missing→资格fresh拒绝→schema异常；早关闭仍短路", async () => {
  const b = await buyer(h, { subscribed: false }),
    storeId = b.store.id;
  const profile = await h.prisma.storeProfile.findUniqueOrThrow({ where: { storeId } });
  const category = await h.prisma.dictItem.findUniqueOrThrow({
    where: { dictTypeKey_code: { dictTypeKey: "industry", code: profile.categoryCode! } },
  });
  const industry = await h.prisma.dictItem.findUniqueOrThrow({
    where: { dictTypeKey_code: { dictTypeKey: "industry", code: profile.industryCode! } },
  });
  const run = () => h.tx.run((tx) => profileChecks(tx, b.actor));
  await h.prisma.storeProfile.update({ where: { storeId }, data: { brandName: null } });
  await h.prisma.store.update({
    where: { id: storeId },
    data: { qualificationStatus: "unsubmitted" },
  });
  await h.prisma.dictItem.update({ where: { id: category.id }, data: { ext: {} } });
  try {
    await expect(run()).rejects.toMatchObject({
      error: "STORE_PROFILE_INCOMPLETE",
      details: { missing: [{ step: 1, item: "brand_name", permitType: null }] },
    });
    await h.prisma.storeProfile.update({
      where: { storeId },
      data: { brandName: profile.brandName },
    });
    await expect(run()).rejects.toMatchObject({
      error: "STORE_NOT_QUALIFIED",
      details: { storeId, reason: "not_submitted" },
    });
    await h.prisma.store.update({
      where: { id: storeId },
      data: { qualificationStatus: "verified" },
    });
    await expect(run()).rejects.toMatchObject({ name: "ZodError" });
    await h.prisma.dictItem.update({
      where: { id: industry.id },
      data: { ext: { ...(industry.ext as object), open: false } },
    });
    await expect(run()).rejects.toMatchObject({ error: "INDUSTRY_NOT_OPEN" });
  } finally {
    await h.prisma.dictItem.update({ where: { id: category.id }, data: { ext: category.ext! } });
    await h.prisma.dictItem.update({ where: { id: industry.id }, data: { ext: industry.ext! } });
  }
});

it("资格blocked仍fresh两读：当前store与最新createdAt轮次，不预先解析行业", async () => {
  const b = await buyer(h, { subscribed: false }),
    storeId = b.store.id,
    now = h.clock.now();
  await h.prisma.store.update({
    where: { id: storeId },
    data: { qualificationStatus: "rejected" },
  });
  const roundId = uuidv7(),
    reviewer = await h.make.staff();
  const approval = await h.prisma.approvalRequest.create({
    data: {
      id: uuidv7(),
      kind: "qualification",
      category: "review",
      subjectType: "store",
      subjectId: storeId,
      entityId: b.entity.id,
      storeId,
      status: "rejected",
      summarySnapshot: { title: "资格历史" },
      submitActorType: "merchant",
      submitActorId: b.user.id,
      submitClient: "weapp",
      decidedByStaffId: reviewer.id,
      decidedAt: now,
      decisionNote: "测试资质驳回历史",
      reasonCodes: ["document_invalid"],
      dedupeKey: `qualification:${storeId}`,
      submittedAt: now,
      createdAt: now,
      updatedAt: now,
    },
  });
  await h.prisma.qualificationSubmission.create({
    data: {
      id: roundId,
      entityId: b.entity.id,
      storeId,
      kind: "initial",
      roundNo: 1,
      claimedEntityType: "enterprise",
      approvalRequestId: approval.id,
      submittedByUserId: b.user.id,
      createdByUserId: b.user.id,
      submittedAt: now,
      closedAt: now,
      outcome: "rejected",
      finalRejectedAt: now,
      proposedStoreName: b.store.name!,
      proposedIndustryCode: "W115I",
      proposedCategoryCode: "W115C",
      proposedAddressSnapshot: {},
      declarationConfirmedAt: now,
      declarationVersion: "1",
      createdAt: now,
      updatedAt: now,
    },
  });
  await expect(
    h.tx.run(async (tx) => {
      const observed = afterFacts(tx, async () => {
        await tx.qualificationSubmission.update({
          where: { id: roundId },
          data: { finalRejectedAt: null },
        });
      });
      try {
        await profileChecks(observed.tx, b.actor);
      } finally {
        expect(observed.reads()).toBe(1);
      }
    }),
  ).rejects.toMatchObject({
    error: "STORE_NOT_QUALIFIED",
    details: { storeId, reason: "rejected" },
  });
  await expect(h.tx.run((tx) => profileChecks(tx, b.actor))).rejects.toMatchObject({
    error: "STORE_NOT_QUALIFIED",
    details: { reason: "final_rejected" },
  });
  await expect(
    h.tx.run(async (tx) =>
      profileChecks(
        afterFacts(tx, async () => {
          await tx.store.update({
            where: { id: storeId },
            data: { qualificationStatus: "pending" },
          });
        }).tx,
        b.actor,
      ),
    ),
  ).rejects.toMatchObject({ error: "STORE_NOT_QUALIFIED", details: { reason: "pending_review" } });
});

it("成功同阶段真实只有一次facts查询，两个独立读取观察新字典值", async () => {
  const b = await buyer(h, { subscribed: false });
  await h.tx
    .run(async (tx) => {
      const observed = afterFacts(tx, async () => {});
      expect(await profileChecks(observed.tx, b.actor)).toBe("full");
      expect(observed.reads()).toBe(1);
      await tx.dictItem.update({
        where: { dictTypeKey_code: { dictTypeKey: "industry", code: "W115C" } },
        data: { ext: { open: false, special: false, requiredCerts: [] } },
      });
      await expect(profileChecks(observed.tx, b.actor)).rejects.toMatchObject({
        error: "INDUSTRY_NOT_OPEN",
      });
      expect(observed.reads()).toBe(2);
      throw new Error("rollback_dictionary_probe");
    })
    .catch((e: unknown) => {
      expect(e).toMatchObject({ message: "rollback_dictionary_probe" });
    });
});

it.each(["basic", "industry"] as const)(
  "真实hold后%s变化重新校验，全部资金/同意/业务写回滚",
  async (kind) => {
    const b = await buyer(h),
      d = await drama(h),
      input = await body(h, b, [d.id]);
    const before = await h.prisma.pointLot.aggregate({
      where: { entityId: b.entity.id },
      _sum: { availableQty: true, heldQty: true },
    });
    const operations = await h.prisma.ledgerOperation.count({ where: { entityId: b.entity.id } });
    let holds = 0;
    const order = createOrderService({
      ...h.deps,
      ledger: {
        ...h.ledger,
        hold: async (tx, arg) => {
          const result = await h.ledger.hold(tx, arg);
          holds++;
          if (kind === "basic")
            await tx.storeProfile.update({
              where: { storeId: b.store.id },
              data: { brandName: null },
            });
          else
            await tx.dictItem.update({
              where: { dictTypeKey_code: { dictTypeKey: "industry", code: "W115C" } },
              data: { ext: { open: false, special: false, requiredCerts: [] } },
            });
          return result;
        },
      },
    });
    await expect(order.create(b.actor, input)).rejects.toMatchObject({
      error: kind === "basic" ? "STORE_PROFILE_INCOMPLETE" : "INDUSTRY_NOT_OPEN",
    });
    expect(holds).toBe(1);
    expect(await residual(h, b.entity.id)).toEqual({ orders: 0, items: 0, holds: 0, consents: 0 });
    expect(
      await h.prisma.pointLot.aggregate({
        where: { entityId: b.entity.id },
        _sum: { availableQty: true, heldQty: true },
      }),
    ).toEqual(before);
    expect(await h.prisma.ledgerOperation.count({ where: { entityId: b.entity.id } })).toBe(
      operations,
    );
    expect(await h.tx.run((tx) => profileChecks(tx, b.actor))).toBe("full");
  },
);

it("facts真实SQL异常透传，事务中先前资料写入回滚", async () => {
  const b = await buyer(h, { subscribed: false });
  await expect(
    h.tx.run(async (tx) => {
      await tx.storeProfile.update({ where: { storeId: b.store.id }, data: { brandName: null } });
      const bad = new Proxy(tx, {
        get(target, key, receiver) {
          if (key !== "$queryRaw") return Reflect.get(target, key, receiver);
          return () => target.$queryRaw`SELECT 1 / 0`;
        },
      });
      await profileChecks(bad, b.actor);
    }),
  ).rejects.toMatchObject({
    code: "P2010",
    meta: { driverAdapterError: { cause: { originalCode: "22012" } } },
  });
  expect(await h.tx.run((tx) => profileChecks(tx, b.actor))).toBe("full");
});
