import { beforeAll, expect, it } from "vitest";
import type { Prisma } from "@liyoxi/db";
import { AppError, uuidv7 } from "../kernel/index.js";
import { machinePort, chainKey, rowKey } from "../flow/index.js";
import { useSeededDatabase } from "../testing/index.js";
import { body, buyer, drama, harness, version } from "./__fixtures__/harness.js";
import type { Harness } from "./__fixtures__/harness.js";
import { dramaSnapshots } from "./checks.js";

const database = useSeededDatabase("services");
let h: Harness;
beforeAll(async () => {
  h = harness(await database.prisma());
  await version(h);
}, 120000);

it("真实初始守卫关联读：正常/缺项、缺账号、阶段、冻结状态、引用、数量和归属污染", async () => {
  const b = await buyer(h),
    d = await drama(h);
  const out = await h.order.create(b.actor, await body(h, b, [d.id]));
  const item = await h.prisma.orderItem.findUniqueOrThrow({
    where: { id: out.items[0]!.orderItemId },
  });
  const hold = await h.prisma.pointHold.findUniqueOrThrow({ where: { id: item.pointHoldId } });
  const other = await h.make.merchant({ verified: true });
  const sameEntityStore = await h.make.store({ entityId: b.entity.id });
  const guard = h.assembly.portEntries(machinePort).get(chainKey("order_item", "phase"))!.guards![
    rowKey("09:351", "order.submit")
  ]!;
  let itemNo = 1;
  await expect(
    h.tx.run(async (tx) => {
      const run = (id: string) =>
        guard(tx, {
          machine: "order_item",
          stateField: "phase",
          subjectId: id,
          from: null,
          to: "pending_start",
          event: "order.submit",
          ref: "09:351",
          now: h.clock.now(),
          ctx: b.actor.ctx,
          entityId: b.entity.id,
          storeId: b.store.id,
          reasonCode: null,
          note: null,
          payload: null,
          args: undefined,
        });
      expect(await run(item.id)).toBe(true);
      expect(await run(uuidv7())).toBe(false);
      const variants = [
        { item: {}, hold: {}, account: false },
        {
          item: {
            phase: "cancelled",
            cancelledAt: h.clock.now(),
            cancelReasonCode: "merchant_request",
          },
          hold: {},
          account: true,
        },
        {
          item: {},
          hold: { status: "released", returnedQty: hold.qty, closedAt: h.clock.now() },
          account: true,
        },
        { item: {}, hold: { refType: "ad", purpose: "ad" }, account: true },
        { item: {}, hold: { refId: uuidv7() }, account: true },
        { item: {}, hold: { qty: hold.qty + 1 }, account: true },
        { item: { storeId: sameEntityStore.id }, hold: {}, account: true },
        // 复合store/entity FK阻止只有entity错而store不变；真实另一主体/门店一起污染仍拒绝。
        { item: { entityId: other.entity.id, storeId: other.store.id }, hold: {}, account: true },
      ];
      for (const variant of variants) {
        const id = uuidv7(),
          pointHoldId = uuidv7();
        await tx.pointHold.create({
          data: {
            ...hold,
            id: pointHoldId,
            refId: id,
            pricingSnapshot: hold.pricingSnapshot as Prisma.InputJsonValue,
            ...variant.hold,
          },
        });
        await tx.orderItem.create({
          data: {
            ...item,
            id,
            itemNo: ++itemNo,
            pointHoldId,
            dramaSnapshot: item.dramaSnapshot as Prisma.InputJsonValue,
            pricingSnapshot: item.pricingSnapshot as Prisma.InputJsonValue,
            ...variant.item,
          },
        });
        if (variant.account)
          await tx.orderItemAccount.create({
            data: {
              orderItemId: id,
              channelAccountId: b.accountId,
              platform: "douyin",
              createdAt: h.clock.now(),
            },
          });
        expect(await run(id)).toBe(false);
      }
      throw new Error("rollback_guard_pollution");
    }),
  ).rejects.toThrow("rollback_guard_pollution");
  expect(await h.prisma.orderItem.count({ where: { dramaOrderId: out.orderId } })).toBe(1);
}, 60000);

it("可订窄读取保留真实快照/日期/许可/平台错误，缺剧精准映射且其他异常透传", async () => {
  const d = await drama(h);
  const read = () =>
    h.tx.run((tx) => h.deps.content.assertOrderable(tx, d.id, ["douyin"], "2026-01-05"));
  const original = await read();
  await h.prisma.fileObject.update({
    where: { id: d.posterFileId! },
    data: { moderationState: "block" },
  });
  expect(await read()).toEqual(original); // 可订判断从来没有消费海报状态或剧集数。
  expect(original).toMatchObject({
    dramaId: d.id,
    title: d.title,
    genreCodes: d.genreCodes,
    posterFileId: d.posterFileId,
  });
  await h.prisma.dramaCopyright.update({
    where: { dramaId: d.id },
    data: { platforms: ["wechat_channels"] },
  });
  await expect(read()).rejects.toMatchObject({
    error: "DRAMA_NOT_ORDERABLE",
    details: { dramaId: d.id, reason: "platform_not_licensed" },
  });
  await h.prisma.dramaCopyright.update({
    where: { dramaId: d.id },
    data: { platforms: ["douyin"], licenseEndDate: new Date("2020-01-01") },
  });
  await expect(read()).rejects.toMatchObject({
    error: "DRAMA_NOT_ORDERABLE",
    details: { reason: "stopped" },
  });
  await h.prisma.dramaCopyright.update({
    where: { dramaId: d.id },
    data: { licenseEndDate: new Date("2035-12-31") },
  });
  await h.prisma.dramaPermit.updateMany({
    where: { dramaId: d.id },
    data: { status: "retired", retiredAt: h.clock.now(), retireReason: "测试停用许可" },
  });
  await expect(read()).rejects.toMatchObject({
    error: "DRAMA_NOT_ORDERABLE",
    details: { reason: "permit_missing" },
  });
  const missing = uuidv7();
  await expect(
    h.tx.run((tx) => dramaSnapshots(tx, h.deps, [missing], ["douyin"], h.clock.now())),
  ).rejects.toMatchObject({
    error: "DRAMA_NOT_ORDERABLE",
    details: { dramaId: missing, reason: "not_listed" },
  });
  const failure = new AppError("PROVIDER_UNAVAILABLE");
  await expect(
    h.tx.run((tx) =>
      dramaSnapshots(
        tx,
        {
          ...h.deps,
          content: {
            ...h.deps.content,
            assertOrderable: async () => {
              throw failure;
            },
          },
        },
        [d.id],
        ["douyin"],
        h.clock.now(),
      ),
    ),
  ).rejects.toBe(failure);
}, 60000);
