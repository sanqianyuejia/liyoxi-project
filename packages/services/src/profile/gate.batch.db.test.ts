import { beforeAll, expect, it } from "vitest";
import { uuidv7 } from "../kernel/index.js";
import { useSeededDatabase } from "../testing/index.js";
import { complete, harness } from "./__fixtures__/harness.js";
import type { Harness } from "./__fixtures__/harness.js";
import { snapshot } from "./repo.js";

const database = useSeededDatabase("services");
let h: Harness;
beforeAll(async () => {
  h = harness(await database.prisma());
}, 120000);

it("前三步守卫和完整快照同源，实际媒体/服务变化立即影响两次读取", async () => {
  const { viewer } = await h.owner();
  await complete(h, viewer);
  const storeId = viewer.membership.storeId;
  const assertSame = async () => {
    const missing = await h.tx.run(async (tx) =>
      (await snapshot(tx, storeId)).completeness.steps
        .slice(0, 3)
        .flatMap((step) => step.missing.map((item) => ({ step: step.step, ...item }))),
    );
    if (missing.length)
      await expect(h.profile.assertProfileComplete(storeId)).rejects.toMatchObject({
        error: "STORE_PROFILE_INCOMPLETE",
        details: { missing },
      });
    else await expect(h.profile.assertProfileComplete(storeId)).resolves.toBeUndefined();
    return missing;
  };
  expect(await assertSame()).toEqual([]);
  const door = await h.prisma.storeProfileMedia.findFirstOrThrow({
    where: { storeId, mediaGroup: "door" },
  });
  await h.prisma.fileObject.update({
    where: { id: door.fileId },
    data: { moderationState: "block" },
  });
  expect(await assertSame()).toEqual([{ step: 2, item: "door_photos", permitType: null }]);
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
    data: { avgSpendFen: 0, brandName: null, sellingPointCodes: [] },
  });
  expect(await assertSame()).toEqual([
    { step: 1, item: "brand_name", permitType: null },
    { step: 2, item: "door_photos", permitType: null },
    { step: 3, item: "service_items", permitType: null },
    { step: 3, item: "selling_points", permitType: null },
  ]);
  await expect(h.profile.assertProfileComplete(uuidv7())).rejects.toMatchObject({
    error: "NOT_FOUND",
  });
});

it("行业批读保留当前值/顺序短路及type+code边界", async () => {
  const { viewer } = await h.owner();
  await complete(h, viewer);
  const storeId = viewer.membership.storeId;
  const industry = await h.prisma.dictItem.findUniqueOrThrow({
    where: { dictTypeKey_code: { dictTypeKey: "industry", code: "C900" } },
  });
  const category = await h.prisma.dictItem.findUniqueOrThrow({
    where: { dictTypeKey_code: { dictTypeKey: "industry", code: "C901" } },
  });
  await expect(h.profile.industryOpen(storeId)).resolves.toBe(true);
  await h.prisma.dictItem.update({ where: { id: category.id }, data: { ext: {} } });
  await h.prisma.dictItem.update({
    where: { id: industry.id },
    data: { ext: { ...(industry.ext as object), open: false } },
  });
  await expect(h.profile.industryOpen(storeId)).resolves.toBe(false);
  await h.prisma.dictItem.update({ where: { id: industry.id }, data: { ext: industry.ext! } });
  await expect(h.profile.industryOpen(storeId)).rejects.toThrow();
  await h.prisma.dictItem.update({ where: { id: category.id }, data: { ext: category.ext! } });
  await h.prisma.dictItem.create({
    data: {
      id: uuidv7(),
      dictTypeKey: "region",
      code: "C900",
      name: "同码区域",
      ext: { level: 1, functionalZone: false, opened: true },
      isEnabled: true,
      position: 999,
      createdAt: h.clock.now(),
      updatedAt: h.clock.now(),
    },
  });
  await h.prisma.storeProfile.update({ where: { storeId }, data: { provinceCode: "C900" } });
  await expect(h.profile.industryOpen(storeId)).resolves.toBe(true);
  await h.prisma.dictItem.update({
    where: { dictTypeKey_code: { dictTypeKey: "region", code: "C900" } },
    data: { ext: { level: 1, functionalZone: false, opened: false } },
  });
  await expect(h.profile.industryOpen(storeId)).resolves.toBe(false);
});

it("基础批读缺profile/空媒体和服务仍与完整快照前三步相同，JSON nullable原样", async () => {
  const { viewer } = await h.owner();
  const storeId = viewer.membership.storeId;
  const expected = await h.tx.run(async (tx) =>
    (await snapshot(tx, storeId)).completeness.steps
      .slice(0, 3)
      .flatMap((step) => step.missing.map((item) => ({ step: step.step, ...item }))),
  );
  expect(expected.length).toBeGreaterThan(0);
  await expect(h.profile.assertProfileComplete(storeId)).rejects.toMatchObject({
    error: "STORE_PROFILE_INCOMPLETE",
    details: { missing: expected },
  });
});

it("门店闸门批读真实母主体与门店当前生命周期，缺门店仍NOT_FOUND", async () => {
  const store = await h.make.store({ qualificationStatus: "verified", isPrimary: true });
  await expect(h.profile.storeGate(store.id)).resolves.toBe("full");
  await h.prisma.entity.update({
    where: { id: store.entityId },
    data: { lifecycle: "closed", closedAt: h.clock.now() },
  });
  await expect(h.profile.storeGate(store.id)).resolves.toBe("blocked");
  await h.prisma.entity.update({
    where: { id: store.entityId },
    data: { lifecycle: "active", closedAt: null },
  });
  await h.prisma.store.update({
    where: { id: store.id },
    data: {
      lifecycle: "archived",
      archivedAt: h.clock.now(),
      archiveReason: "entity_closed",
      archiveActorType: "system",
    },
  });
  await expect(h.profile.storeGate(store.id)).resolves.toBe("blocked");
  await h.prisma.store.update({
    where: { id: store.id },
    data: {
      lifecycle: "active",
      qualificationStatus: "pending",
      archivedAt: null,
      archiveReason: null,
      archiveActorType: null,
    },
  });
  await expect(h.profile.storeGate(store.id)).resolves.toBe("parallel");
  const secondary = await h.make.store({ qualificationStatus: "pending", isPrimary: false });
  await expect(h.profile.storeGate(secondary.id)).resolves.toBe("blocked");
  await expect(h.profile.storeGate(uuidv7())).rejects.toMatchObject({ error: "NOT_FOUND" });
});

it("行业批读缺profile/缺字典返回false，功能区在省市区之后解析且不新增启用过滤", async () => {
  const { viewer } = await h.owner();
  const storeId = viewer.membership.storeId;
  await expect(h.profile.industryOpen(storeId)).resolves.toBe(false);
  await expect(h.profile.industryOpen(uuidv7())).resolves.toBe(false);
  await complete(h, viewer);
  const p = await h.prisma.storeProfile.findUniqueOrThrow({ where: { storeId } });
  const province = await h.prisma.dictItem.findUniqueOrThrow({
    where: { dictTypeKey_code: { dictTypeKey: "region", code: p.provinceCode! } },
  });
  const zone = await h.prisma.dictItem.create({
    data: {
      id: uuidv7(),
      dictTypeKey: "region",
      code: "BATCH_BAD_ZONE",
      name: "坏扩展功能区",
      ext: {},
      isEnabled: false,
      position: 998,
      createdAt: h.clock.now(),
      updatedAt: h.clock.now(),
    },
  });
  await h.prisma.storeProfile.update({ where: { storeId }, data: { zoneCode: zone.code } });
  try {
    await h.prisma.dictItem.update({
      where: { id: province.id },
      data: {
        ext: { ...(province.ext as object), opened: false },
      },
    });
    await expect(h.profile.industryOpen(storeId)).resolves.toBe(false);
    await h.prisma.dictItem.update({ where: { id: province.id }, data: { ext: province.ext! } });
    await expect(h.profile.industryOpen(storeId)).rejects.toThrow();
    await h.prisma.dictItem.update({
      where: { id: zone.id },
      data: {
        ext: { level: 3, functionalZone: true, opened: true },
      },
    });
    await expect(h.profile.industryOpen(storeId)).resolves.toBe(true);
    await h.prisma.storeProfile.update({
      where: { storeId },
      data: { categoryCode: "MISSING_BATCH" },
    });
    await expect(h.profile.industryOpen(storeId)).resolves.toBe(false);
  } finally {
    await h.prisma.dictItem.update({ where: { id: province.id }, data: { ext: province.ext! } });
  }
});
