import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lockRows } from "../kernel/index.js";
import { useSeededDatabase } from "../testing/index.js";
import { getTicketStateBriefsByOrderItems } from "../delivery/index.js";
import { findDerivedViolations } from "./derived-invariants.js";
import { harness } from "./__fixtures__/harness.js";
import { derivedHarness } from "./__fixtures__/derived-harness.js";
import type { DerivedHarness } from "./__fixtures__/derived-harness.js";

const db = useSeededDatabase("services");
let h: DerivedHarness;
beforeEach(async () => {
  await db.reset();
  h = derivedHarness(harness(await db.prisma()));
}, 60_000);
afterEach(() => h?.clear());
describe("全库不变量批量真实事实与原自愈语义", { timeout: 60_000 }, () => {
  it("多单/多项状态公口不做上线投影；缺票仍报I1，不合法回退I3不伪造自愈", async () => {
    const first = await h.orderFixture(2),
      second = await h.orderFixture();
    const ids = [...first.items, ...second.items].map((i) => i.id);
    expect(await h.tx.run((tx) => getTicketStateBriefsByOrderItems(tx, []))).toEqual([]);
    const briefs = await h.tx.run((tx) => getTicketStateBriefsByOrderItems(tx, ids));
    expect(briefs).toHaveLength(3);
    for (const brief of briefs) expect(Object.keys(brief).sort()).toEqual(["orderItemId", "step"]);
    for (const code of ["I1", "I2", "I3"] as const)
      expect(await h.tx.run((tx) => findDerivedViolations(tx, code))).toEqual([]);
    await h.prisma.orderItem.update({
      where: { id: first.items[0]!.id },
      data: { phase: "to_launch" },
    });
    const invalid = await h.tx.run((tx) => findDerivedViolations(tx, "I3"));
    expect(invalid).toHaveLength(1);
    expect(invalid[0]).toMatchObject({
      subject: { id: first.items[0]!.id },
      detail: { expected: "producing" },
    });
    expect(invalid[0]!.healed).toBeUndefined();
    // 已有工单不删FK；只造缺票污染事实，I1必须仍逐项发现而不能被map漏掉。
    const missing = await h.make.orderItem({ phase: "producing" });
    expect(await h.tx.run((tx) => findDerivedViolations(tx, "I1"))).toMatchObject([
      { subject: { id: missing.id }, detail: { actualTicketCount: 0, expectedTicketCount: 1 } },
    ]);
  });
  it("不同单I3合法前向和I2父推导仍经过真实flow/savepoint，重跑不重复历史", async () => {
    const first = await h.orderFixture(),
      second = await h.orderFixture();
    await h.prisma.deliveryTicket.updateMany({
      where: { id: { in: [...first.deliveryTicketIds, ...second.deliveryTicketIds] } },
      data: { step: "awaiting_launch" },
    });
    const changed = await h.tx.run((tx) => findDerivedViolations(tx, "I3"));
    expect(changed).toHaveLength(2);
    for (const result of changed)
      expect(result.healed).toMatchObject({ action: "按真实状态机重新推导" });
    expect(await h.prisma.orderItem.count({ where: { phase: "to_launch" } })).toBe(2);
    expect(await h.prisma.dramaOrder.count({ where: { status: "to_launch" } })).toBe(2);
    const before = await h.prisma.statusTransition.count();
    expect(await h.tx.run((tx) => findDerivedViolations(tx, "I3"))).toEqual([]);
    expect(await h.tx.run((tx) => findDerivedViolations(tx, "I2"))).toEqual([]);
    expect(await h.prisma.statusTransition.count()).toBe(before);
  });
  it("父锁等待期间另一事务已修正，锁后复读真实新状态，无旧快照误报/自愈", async () => {
    const order = await h.orderFixture();
    await h.prisma.orderItem.update({
      where: { id: order.items[0]!.id },
      data: { phase: "to_launch" },
    });
    await h.prisma.deliveryTicket.update({
      where: { id: order.deliveryTicketIds[0]! },
      data: { step: "awaiting_launch" },
    });
    let locked!: () => void, firstRead!: () => void;
    const writerLocked = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const snapshotRead = new Promise<void>((resolve) => {
      firstRead = resolve;
    });
    const writer = h.tx.run(async (tx) => {
      await lockRows(tx, "drama_order", [order.o.id]);
      locked();
      await snapshotRead;
      await tx.dramaOrder.update({
        where: { id: order.o.id },
        data: { status: "to_launch", subStatus: "awaiting_links" },
      });
    });
    await writerLocked;
    const before = await h.prisma.statusTransition.count();
    const results = await h.tx.run(async (tx) => {
      const original = tx.dramaOrder.findMany.bind(tx.dramaOrder);
      const spy = vi.spyOn(tx.dramaOrder, "findMany").mockImplementationOnce((args) =>
        Object.assign(
          (async () => {
            const snapshot = await original(args);
            firstRead();
            await writer;
            return snapshot;
          })(),
          { [Symbol.toStringTag]: "PrismaPromise" as const },
        ),
      );
      try {
        return await findDerivedViolations(tx, "I2", { entityIds: [order.b.entity.id] });
      } finally {
        spy.mockRestore();
      }
    });
    expect(results).toEqual([]);
    expect(await h.prisma.statusTransition.count()).toBe(before);
  });
});
