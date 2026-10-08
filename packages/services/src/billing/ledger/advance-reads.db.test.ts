import { calendarDate } from "@liyoxi/shared/time";
import { beforeAll, expect, it } from "vitest";

import { savepoint, uuidv7 } from "../../kernel/index.js";
import { createLedgerHarness, openTerm, useSeededDatabase } from "../../testing/index.js";
import type { LedgerHarness } from "../../testing/index.js";
import { advanceAccount } from "./advance.js";
import { acquireAccount } from "./context.js";
import { loadAccount } from "./operation.js";

const database = useSeededDatabase("services");
let h: LedgerHarness;
beforeAll(async () => {
  h = createLedgerHarness(await database.prisma());
}, 120_000);

const at = (local: string) => new Date(`${local}+08:00`);
const empty = { granted: 0, expired: 0, rolledOver: 0, suspended: false };
const advance = (entityId: string) => h.tx.run((tx) => h.ledger.advance(tx, entityId));

it("无当前周期/无到点行仍不推进；dueAt 与时钟相等才发放，Date 和成本保持真实值", async () => {
  h.clock.set(at("2026-01-05T12:00:00"));
  const merchant = await h.make.merchant({ verified: true });
  expect(await advance(merchant.entity.id)).toEqual(empty);
  const { term, schedules } = await openTerm(h, { entityId: merchant.entity.id, months: 3 });
  const due = schedules.find((schedule) => schedule.monthNo === 1)!;
  expect(due.pointLotId).toBeNull();
  expect(due.grantedAt).toBeNull();
  h.clock.set(new Date(due.dueAt.getTime() - 1));
  expect(await advance(merchant.entity.id)).toEqual(empty);
  h.clock.set(due.dueAt);
  expect(await advance(merchant.entity.id)).toEqual({ ...empty, granted: 1 });
  expect(await advance(merchant.entity.id)).toEqual(empty);
  const granted = await h.prisma.grantSchedule.findUniqueOrThrow({ where: { id: due.id } });
  expect(granted).toMatchObject({ status: "granted", grantedAt: due.dueAt });
  expect(granted.grantedAt).toBeInstanceOf(Date);
  const lot = await h.prisma.pointLot.findUniqueOrThrow({ where: { id: granted.pointLotId! } });
  expect(lot).toMatchObject({
    sourceId: due.id,
    planId: due.planId,
    planRevisionId: due.planRevisionId,
    expiresAt: term.endsAt,
    grantedAt: due.dueAt,
    bizDate: due.dueDate,
    originalQty: due.points,
    costBasisFen: due.valueFen,
  });
  const op = await h.prisma.ledgerOperation.findFirstOrThrow({
    where: { entityId: merchant.entity.id, opKey: `grant:grant_schedule:${due.id}` },
  });
  expect(op).toMatchObject({ occurredAt: due.dueAt, bizDate: due.dueDate });
});

it("多个已到点计划仍按 monthNo 而非 dueAt；每轮重新读取，不重复首行或漏掉下一行", async () => {
  h.clock.set(at("2026-01-05T12:00:00"));
  const merchant = await h.make.merchant({ verified: true });
  const { schedules } = await openTerm(h, { entityId: merchant.entity.id, months: 3 });
  const first = schedules.find((schedule) => schedule.monthNo === 1)!;
  const second = schedules.find((schedule) => schedule.monthNo === 2)!;
  const firstAt = at("2026-03-11T00:00:00");
  const secondAt = at("2026-02-10T00:00:00");
  for (const [schedule, dueAt] of [
    [first, firstAt],
    [second, secondAt],
  ] as const) {
    await h.prisma.grantSchedule.update({
      where: { id: schedule.id },
      data: { dueAt, dueDate: new Date(`${calendarDate(dueAt)}T00:00:00.000Z`) },
    });
  }
  h.clock.set(at("2026-03-12T00:00:00"));
  expect(await advance(merchant.entity.id)).toEqual({ ...empty, granted: 2 });
  const events = await h.prisma.outboxEvent.findMany({
    where: { entityId: merchant.entity.id, eventType: "billing.points.granted" },
    orderBy: { seq: "asc" },
  });
  expect(events.map((event) => event.payload)).toMatchObject([
    { grantScheduleId: schedules[0]!.id, monthIndex: 0 },
    { grantScheduleId: first.id, monthIndex: 1 },
    { grantScheduleId: second.id, monthIndex: 2 },
  ]);
  expect(await advance(merchant.entity.id)).toEqual(empty);
});

it("dueAt 等于周期止点仍排除：不发放而按原顺序到期；异常回滚完整周期和计划", async () => {
  h.clock.set(at("2026-01-05T12:00:00"));
  const merchant = await h.make.merchant({ verified: true });
  const { term, schedules } = await openTerm(h, { entityId: merchant.entity.id, months: 3 });
  const pending = schedules.filter((schedule) => schedule.status === "pending");
  const before = await h.prisma.billingAccount.findUniqueOrThrow({
    where: { entityId: merchant.entity.id },
  });
  h.clock.set(term.endsAt);
  await expect(
    h.tx.run(async (tx) => {
      await acquireAccount(tx, h.clock, merchant.entity.id);
      for (const schedule of pending) {
        await tx.grantSchedule.update({
          where: { id: schedule.id },
          data: {
            dueAt: term.endsAt,
            dueDate: new Date(`${calendarDate(term.endsAt)}T00:00:00.000Z`),
          },
        });
      }
      expect(await h.ledger.advance(tx, merchant.entity.id)).toEqual({
        granted: 0,
        expired: 1,
        rolledOver: 0,
        suspended: true,
      });
      expect(
        await tx.grantSchedule.count({ where: { subscriptionTermId: term.id, status: "pending" } }),
      ).toBe(2);
      throw new Error("advance_bound_rollback");
    }),
  ).rejects.toThrow("advance_bound_rollback");
  expect(await h.prisma.subscriptionTerm.findUniqueOrThrow({ where: { id: term.id } })).toEqual(
    term,
  );
  expect(
    await h.prisma.grantSchedule.findMany({
      where: { subscriptionTermId: term.id },
      orderBy: { monthNo: "asc" },
    }),
  ).toEqual(schedules);
  expect(
    await h.prisma.billingAccount.findUniqueOrThrow({ where: { entityId: merchant.entity.id } }),
  ).toEqual(before);
});

it("只有非 pending 的到点行时仍为空；缺周期保留真实 P2025，不写非法 FK", async () => {
  h.clock.set(at("2026-01-05T12:00:00"));
  const merchant = await h.make.merchant({ verified: true });
  const { term } = await openTerm(h, { entityId: merchant.entity.id, months: 3 });
  await h.prisma.grantSchedule.updateMany({
    where: { subscriptionTermId: term.id, status: "pending" },
    data: { status: "cancelled" },
  });
  h.clock.set(at("2026-03-12T00:00:00"));
  expect(await advance(merchant.entity.id)).toEqual(empty);
  await expect(
    h.tx.run(async (tx) => {
      const clock = await h.ledger.lockAccount(tx, merchant.entity.id);
      const account = await loadAccount(tx, merchant.entity.id);
      await advanceAccount(tx, h, clock, { ...account, currentSubscriptionTermId: uuidv7() });
    }),
  ).rejects.toMatchObject({ code: "P2025" });
});

it("发放故障保存点回滚后同 TX 重入重新读计划，原 key 只发一次且事件无残留", async () => {
  h.clock.set(at("2026-01-05T12:00:00"));
  const merchant = await h.make.merchant({ verified: true });
  const { schedules } = await openTerm(h, { entityId: merchant.entity.id, months: 3 });
  const due = schedules.find((schedule) => schedule.monthNo === 1)!;
  h.clock.set(due.dueAt);
  let fail = true;
  const injected = createLedgerHarness(h.prisma, {
    clock: h.clock,
    onStep: (step) => {
      if (fail && step === "schedule.grant") throw new Error("advance_read_failure");
    },
  });
  await h.tx.run(async (tx) => {
    await expect(
      savepoint(tx, () => injected.ledger.advance(tx, merchant.entity.id)),
    ).rejects.toThrow("advance_read_failure");
    expect(await tx.grantSchedule.findUniqueOrThrow({ where: { id: due.id } })).toEqual(due);
    expect(
      await tx.ledgerOperation.count({ where: { entityId: merchant.entity.id, refId: due.id } }),
    ).toBe(0);
    expect(
      await tx.outboxEvent.count({ where: { dedupeKey: `billing.points.granted:${due.id}` } }),
    ).toBe(0);
    fail = false;
    expect(await injected.ledger.advance(tx, merchant.entity.id)).toEqual({ ...empty, granted: 1 });
    expect(await injected.ledger.advance(tx, merchant.entity.id)).toEqual(empty);
  });
  expect(
    await h.prisma.outboxEvent.count({ where: { dedupeKey: `billing.points.granted:${due.id}` } }),
  ).toBe(1);
});
