import { afterAll, beforeAll, expect, it } from "vitest";
import { useSeededDatabase } from "../testing/index.js";
import { uuidv7 } from "../kernel/index.js";
import { Prisma } from "@liyoxi/db";
import { harness } from "./__fixtures__/harness.js";
import type { Harness } from "./__fixtures__/harness.js";
import { findDeliveryViolations } from "./invariants.js";
const db = useSeededDatabase("services");
let h: Harness;
beforeAll(async () => {
  h = harness(await db.prisma());
});
afterAll(() => h?.unbind());
it("I5 批量只取同票集正确链的最早初史；多票/缺史/异链污染保留原初始环节判断", async () => {
  const managed = await h.order(true, 2),
    unmanaged = await h.order(false);
  const original = await h.prisma.statusTransition.findFirstOrThrow({
    where: { subjectId: managed.deliveryTicketIds[0]!, fromState: null },
  });
  const { seq, payload, ...columns } = original;
  expect(seq).toBeGreaterThan(0n);
  const history = { ...columns, payload: payload ?? Prisma.DbNull };
  // 同一时刻相同初始事实，不要求旧查询未定义的异内容 tie。
  await h.prisma.statusTransition.create({
    data: {
      ...history,
      id: uuidv7(),
      event: "ticket.created",
      toState: "plan_confirm",
    },
  });
  await h.prisma.statusTransition.createMany({
    data: [
      {
        ...history,
        id: uuidv7(),
        occurredAt: new Date(original.occurredAt.getTime() + 1),
        toState: "assigning",
      },
      {
        ...history,
        id: uuidv7(),
        occurredAt: new Date(original.occurredAt.getTime() - 1),
        machine: "drama_order",
        stateField: "status",
        toState: "pending_start",
      },
      {
        ...history,
        id: uuidv7(),
        occurredAt: new Date(original.occurredAt.getTime() - 1),
        stateField: "waiting_on",
        toState: "merchant",
      },
      {
        ...history,
        id: uuidv7(),
        occurredAt: new Date(original.occurredAt.getTime() - 1),
        fromState: "assigning",
      },
    ],
  });
  const item = await h.make.orderItem({ dramaOrderId: unmanaged.order.id, itemNo: 2 });
  const absent = await h.make.deliveryTicket({ orderItemId: item.id, step: "assigning" });
  await h.prisma.deliveryTicketStage.create({
    data: {
      id: uuidv7(),
      deliveryTicketId: absent.id,
      step: "assigning",
      visitNo: 1,
      enteredAt: h.clock.now(),
      createdAt: h.clock.now(),
      updatedAt: h.clock.now(),
    },
  });
  expect(await h.tx.run((tx) => findDeliveryViolations(tx, "I5"))).toEqual([]);
  // 删除可变环节中的首 assigning 事实，仍必须逐票报告原条件。
  await h.prisma.deliveryTicketStage.deleteMany({
    where: {
      deliveryTicketId: managed.deliveryTicketIds[0]!,
      step: "assigning",
    },
  });
  expect(await h.tx.run((tx) => findDeliveryViolations(tx, "I5"))).toMatchObject([
    { subject: { id: managed.deliveryTicketIds[0]! }, detail: { missingInitialAssigning: true } },
  ]);
}, 60_000);
