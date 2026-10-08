import { beforeAll, expect, it } from "vitest";
import { useSeededDatabase } from "../testing/index.js";
import { uuidv7 } from "../kernel/index.js";
import { complete, harness } from "./__fixtures__/harness.js";
import type { Harness } from "./__fixtures__/harness.js";
import {
  getOrderProfileFacts,
  industryOpenFromOrderFacts,
  storeGate,
  industryOpen,
} from "./index.js";
import { snapshot } from "./repo.js";

const database = useSeededDatabase("services");
let h: Harness;
beforeAll(async () => {
  h = harness(await database.prisma());
}, 120000);

it("复合事实前三步与完整快照同源：JSON/零金额/当前媒体/服务/removed，不消费联系人", async () => {
  const { viewer } = await h.owner();
  await complete(h, viewer);
  const storeId = viewer.membership.storeId;
  const compare = () =>
    h.tx.run(async (tx) => {
      const expected = (await snapshot(tx, storeId)).completeness.steps
        .slice(0, 3)
        .flatMap((step) => step.missing.map((item) => ({ step: step.step, ...item })));
      const facts = await getOrderProfileFacts(tx, storeId);
      expect(facts.missing).toEqual(expected);
      expect(facts.gate).toBe(await storeGate(tx, storeId));
      expect(industryOpenFromOrderFacts(facts)).toBe(await industryOpen(tx, storeId));
      return facts.missing;
    });
  await h.prisma.storeProfile.update({
    where: { storeId },
    data: { avgSpendFen: 0, contactName: null },
  });
  expect(await compare()).toEqual([]);
  const door = await h.prisma.storeProfileMedia.findFirstOrThrow({
    where: { storeId, mediaGroup: "door" },
  });
  for (const data of [{ status: "pending" }, { status: "stored", moderationState: "block" }]) {
    await h.prisma.fileObject.update({ where: { id: door.fileId }, data });
    expect(await compare()).toEqual([{ step: 2, item: "door_photos", permitType: null }]);
  }
  await h.prisma.fileObject.update({
    where: { id: door.fileId },
    data: { moderationState: "pass" },
  });
  await h.prisma.storeProfileMedia.update({
    where: { id: door.id },
    data: { removedAt: h.clock.now() },
  });
  await h.prisma.storeServiceItem.updateMany({
    where: { storeId },
    data: { removedAt: h.clock.now() },
  });
  await h.prisma.storeProfile.update({
    where: { storeId },
    data: { brandName: null, avgSpendFen: null, businessHours: [], sellingPointCodes: [] },
  });
  expect(await compare()).toEqual([
    { step: 1, item: "brand_name", permitType: null },
    { step: 1, item: "business_hours", permitType: null },
    { step: 1, item: "avg_spend", permitType: null },
    { step: 2, item: "door_photos", permitType: null },
    { step: 3, item: "service_items", permitType: null },
    { step: 3, item: "selling_points", permitType: null },
  ]);
}, 60000);

it("缺profile真实null/空媒体服务，缺门店NOT_FOUND，不读缓存第四步", async () => {
  const { viewer } = await h.owner(),
    storeId = viewer.membership.storeId;
  await h.tx.run(async (tx) => {
    const facts = await getOrderProfileFacts(tx, storeId);
    expect(facts.industry).toBeNull();
    expect(industryOpenFromOrderFacts(facts)).toBe(false);
    expect(facts.missing).toEqual(
      (await snapshot(tx, storeId)).completeness.steps
        .slice(0, 3)
        .flatMap((step) => step.missing.map((item) => ({ step: step.step, ...item }))),
    );
  });
  await expect(h.tx.run((tx) => getOrderProfileFacts(tx, uuidv7()))).rejects.toMatchObject({
    error: "NOT_FOUND",
  });
});

it.each([
  ["unsubmitted", true, "active", "active", "blocked"],
  ["pending", true, "active", "active", "parallel"],
  ["verified", true, "active", "active", "full"],
  ["rejected", true, "active", "active", "blocked"],
  ["pending", false, "active", "active", "blocked"],
  ["verified", true, "archived", "active", "blocked"],
  ["verified", true, "active", "closed", "blocked"],
] as const)(
  "同statement资格门 %s primary=%s store=%s entity=%s → %s",
  async (qualificationStatus, isPrimary, lifecycle, entityLifecycle, expected) => {
    const store = await h.make.store({ qualificationStatus, isPrimary });
    if (lifecycle === "archived")
      await h.prisma.store.update({
        where: { id: store.id },
        data: {
          lifecycle,
          archivedAt: h.clock.now(),
          archiveReason: "entity_closed",
          archiveActorType: "system",
        },
      });
    if (entityLifecycle === "closed")
      await h.prisma.entity.update({
        where: { id: store.entityId },
        data: { lifecycle: "closed", closedAt: h.clock.now() },
      });
    expect((await h.tx.run((tx) => getOrderProfileFacts(tx, store.id))).gate).toBe(expected);
  },
);

it("行业事实延后解析，保持type+code/disabled/缺项/早关闭短路与功能区最后", async () => {
  const { viewer } = await h.owner();
  await complete(h, viewer);
  const storeId = viewer.membership.storeId;
  const read = () => h.tx.run((tx) => getOrderProfileFacts(tx, storeId));
  const industry = await h.prisma.dictItem.findUniqueOrThrow({
    where: { dictTypeKey_code: { dictTypeKey: "industry", code: "C900" } },
  });
  const category = await h.prisma.dictItem.findUniqueOrThrow({
    where: { dictTypeKey_code: { dictTypeKey: "industry", code: "C901" } },
  });
  const zone = await h.prisma.dictItem.create({
    data: {
      id: uuidv7(),
      dictTypeKey: "region",
      code: "C900",
      name: "同码坏功能区",
      ext: {},
      isEnabled: false,
      position: 998,
      createdAt: h.clock.now(),
      updatedAt: h.clock.now(),
    },
  });
  await h.prisma.storeProfile.update({ where: { storeId }, data: { zoneCode: zone.code } });
  await h.prisma.dictItem.update({ where: { id: category.id }, data: { ext: {} } });
  await h.prisma.dictItem.update({
    where: { id: industry.id },
    data: { ext: { ...(industry.ext as object), open: false } },
  });
  try {
    const closed = await read(); // raw read must not parse either later invalid ext.
    expect(industryOpenFromOrderFacts(closed)).toBe(false);
    await h.prisma.dictItem.update({ where: { id: industry.id }, data: { ext: industry.ext! } });
    const awaited = await read();
    expect(() => industryOpenFromOrderFacts(awaited)).toThrow();
    await h.prisma.dictItem.update({
      where: { id: category.id },
      data: { ext: category.ext!, isEnabled: false },
    });
    const badZone = await read();
    expect(() => industryOpenFromOrderFacts(badZone)).toThrow();
    await h.prisma.dictItem.update({
      where: { id: zone.id },
      data: { ext: { level: 3, functionalZone: true, opened: true } },
    });
    expect(industryOpenFromOrderFacts(await read())).toBe(true);
    await h.prisma.storeProfile.update({
      where: { storeId },
      data: { categoryCode: "missing_order_fact" },
    });
    expect(industryOpenFromOrderFacts(await read())).toBe(false);
  } finally {
    await h.prisma.dictItem.update({ where: { id: industry.id }, data: { ext: industry.ext! } });
    await h.prisma.dictItem.update({
      where: { id: category.id },
      data: { ext: category.ext!, isEnabled: category.isEnabled },
    });
  }
});
