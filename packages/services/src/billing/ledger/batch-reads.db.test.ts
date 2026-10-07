import { beforeAll, expect, it } from "vitest";
import { calendarDate } from "@liyoxi/shared/time";
import { uuidv7 } from "../../kernel/index.js";
import {
  createLedgerHarness,
  holdDrama,
  openTerm,
  priceDrama,
  topUp,
  useSeededDatabase,
} from "../../testing/index.js";
import type { LedgerHarness } from "../../testing/index.js";
import { refreshNextDue } from "./advance.js";
import { loadAccount } from "./operation.js";
import { selfCheck } from "./self-check.js";

const database = useSeededDatabase("services");
let h: LedgerHarness;
beforeAll(async () => {
  h = createLedgerHarness(await database.prisma());
}, 120_000);

it("下次处理批读保持月序优先/周期止点最小值/真实Date，更新仍同TX且异常回滚", async () => {
  const merchant = await h.make.merchant({ verified: true });
  const { term, schedules } = await openTerm(h, { entityId: merchant.entity.id, months: 3 });
  const before = await h.prisma.billingAccount.findUniqueOrThrow({
    where: { entityId: merchant.entity.id },
  });
  await expect(
    h.tx.run(async (tx) => {
      const clock = await h.ledger.lockAccount(tx, merchant.entity.id);
      const account = await loadAccount(tx, merchant.entity.id);
      const first = schedules.find((schedule) => schedule.monthNo === 1)!;
      const second = schedules.find((schedule) => schedule.monthNo === 2)!;
      // 第二个月的日期更早，也不能改变原monthNo优先规则。
      const due = new Date("2026-03-10T16:00:00.000Z");
      await tx.grantSchedule.update({
        where: { id: first.id },
        data: {
          dueAt: due,
          dueDate: new Date("2026-03-11T00:00:00.000Z"),
        },
      });
      await tx.grantSchedule.update({
        where: { id: second.id },
        data: {
          dueAt: new Date("2026-02-09T16:00:00.000Z"),
          dueDate: new Date("2026-02-10T00:00:00.000Z"),
        },
      });
      expect(await refreshNextDue(tx, clock, account)).toEqual(due);
      expect(account.nextDueAt).toBeInstanceOf(Date);
      expect(
        (await tx.billingAccount.findUniqueOrThrow({ where: { entityId: merchant.entity.id } }))
          .nextDueAt,
      ).toEqual(due);
      await tx.grantSchedule.update({
        where: { id: first.id },
        data: {
          dueAt: new Date("2026-05-01T16:00:00.000Z"),
          dueDate: new Date("2026-05-02T00:00:00.000Z"),
        },
      });
      expect(await refreshNextDue(tx, clock, account)).toEqual(term.endsAt);
      await tx.grantSchedule.update({
        where: { id: first.id },
        data: {
          dueAt: term.endsAt,
          dueDate: new Date(`${calendarDate(term.endsAt)}T00:00:00.000Z`),
        },
      });
      expect(await refreshNextDue(tx, clock, account)).toEqual(term.endsAt);
      await tx.grantSchedule.updateMany({
        where: { subscriptionTermId: term.id, status: "pending" },
        data: { status: "cancelled" },
      });
      expect(await refreshNextDue(tx, clock, account)).toEqual(term.endsAt);
      throw new Error("batch_due_rollback");
    }),
  ).rejects.toThrow("batch_due_rollback");
  expect(
    await h.prisma.billingAccount.findUniqueOrThrow({ where: { entityId: merchant.entity.id } }),
  ).toEqual(before);
});

it("下次处理缺周期仍由原findUniqueOrThrow拒绝，无当前周期仍真实清空", async () => {
  const merchant = await h.make.merchant();
  await h.tx.run(async (tx) => {
    const clock = await h.ledger.lockAccount(tx, merchant.entity.id);
    const account = await loadAccount(tx, merchant.entity.id);
    expect(await refreshNextDue(tx, clock, account)).toBeNull();
  });
  await expect(
    h.tx.run(async (tx) => {
      const clock = await h.ledger.lockAccount(tx, merchant.entity.id);
      const account = await loadAccount(tx, merchant.entity.id);
      // 不写非法FK；仅把原内部参数指向实际不存在的周期，核缺行fallback。
      await refreshNextDue(tx, clock, { ...account, currentSubscriptionTermId: uuidv7() });
    }),
  ).rejects.toMatchObject({ code: "P2025" });
});

async function allocatedHold() {
  const merchant = await h.make.merchant({ verified: true });
  await openTerm(h, { entityId: merchant.entity.id });
  await topUp(h, { entityId: merchant.entity.id, points: 1000 });
  await topUp(h, { entityId: merchant.entity.id, points: 1000 });
  const drama = await h.make.drama({ heatTier: "A" });
  const staff = await h.make.staff();
  await priceDrama(h, { dramaId: drama.id, points: 9000, staffId: staff.id });
  const held = await holdDrama(h, {
    entityId: merchant.entity.id,
    storeId: merchant.store.id,
    dramaId: drama.id,
    expectS: 8100,
  });
  expect(held.allocations).toHaveLength(3);
  const operation = await h.prisma.ledgerOperation.findUniqueOrThrow({
    where: { id: held.operationId },
  });
  return {
    merchant,
    held,
    last: {
      pointHoldId: held.pointHoldId,
      spendableAfterQty: operation.spendableAfterQty,
      heldAfterQty: operation.heldAfterQty,
    },
  };
}

it("自检分别聚合真实三批次/三分摊，JOIN不乘大余额；无last与有last的输出均通过", async () => {
  const { merchant, last } = await allocatedHold();
  const other = await h.make.merchant({ verified: true });
  await openTerm(h, { entityId: other.entity.id });
  await h.tx.run(async (tx) => {
    const clock = await h.ledger.lockAccount(tx, merchant.entity.id);
    await selfCheck(tx, clock);
    await selfCheck(tx, clock, last);
  });
  expect(last).toMatchObject({ spendableAfterQty: 500, heldAfterQty: 8100 });
});

it("自检缺冻结单/错误操作后余额/缓存污染仍拒绝且回滚，错误详情不混入内部JOIN字段", async () => {
  const { merchant, last } = await allocatedHold();
  const account = await h.prisma.billingAccount.findUniqueOrThrow({
    where: { entityId: merchant.entity.id },
  });
  const run = (change: typeof last) =>
    h.tx.run(async (tx) => {
      const clock = await h.ledger.lockAccount(tx, merchant.entity.id);
      await selfCheck(tx, clock, change);
    });
  for (const change of [
    { ...last, pointHoldId: uuidv7() },
    { ...last, heldAfterQty: last.heldAfterQty + 1 },
    { ...last, spendableAfterQty: last.spendableAfterQty + 1 },
  ]) {
    await expect(run(change)).rejects.toMatchObject({ reason: "self_check" });
  }
  for (const field of ["planAvailableQty", "addonAvailableQty", "heldTotalQty"] as const) {
    await expect(
      h.tx.run(async (tx) => {
        const clock = await h.ledger.lockAccount(tx, merchant.entity.id);
        await tx.billingAccount.update({
          where: { entityId: merchant.entity.id },
          data: { [field]: { increment: 1 } },
        });
        try {
          await selfCheck(tx, clock, last);
        } catch (error) {
          expect(error).toMatchObject({
            reason: "self_check",
            details: {
              plan_cached: field === "planAvailableQty" ? 1 : 0,
              addon_cached: field === "addonAvailableQty" ? 501 : 500,
              held_cached: field === "heldTotalQty" ? 8101 : 8100,
            },
          });
          expect((error as { details: object }).details).not.toHaveProperty("alloc_qty");
          throw error;
        }
      }),
    ).rejects.toMatchObject({ reason: "self_check" });
    expect(
      await h.prisma.billingAccount.findUniqueOrThrow({ where: { entityId: merchant.entity.id } }),
    ).toEqual(account);
  }
});

it("自检缺账户与到期可用批次仍拒绝；不跳advance前提，也不绕七桶库约束", async () => {
  const merchant = await h.make.merchant({ verified: true });
  await openTerm(h, { entityId: merchant.entity.id });
  const lot = await h.prisma.pointLot.findFirstOrThrow({ where: { entityId: merchant.entity.id } });
  await expect(
    h.tx.run(async (tx) => {
      const clock = await h.ledger.lockAccount(tx, merchant.entity.id);
      await tx.pointLot.update({ where: { id: lot.id }, data: { expiresAt: clock.now } });
      await selfCheck(tx, clock);
    }),
  ).rejects.toMatchObject({ reason: "self_check", details: { stale_lots: 1 } });
  expect(await h.prisma.pointLot.findUniqueOrThrow({ where: { id: lot.id } })).toEqual(lot);
  for (const data of [{ availableQty: -1 }, { availableQty: lot.availableQty + 1 }]) {
    await expect(h.prisma.pointLot.update({ where: { id: lot.id }, data })).rejects.toThrow(
      /ck_point_lot_buckets_(nonneg|sum)/,
    );
  }
  const missing = uuidv7();
  const now = h.clock.now();
  await expect(
    h.tx.run((tx) => selfCheck(tx, { entityId: missing, now, today: calendarDate(now) })),
  ).rejects.toMatchObject({
    reason: "self_check",
    message: "账本操作没有执行：计费账户不存在",
    details: { entityId: missing },
  });
});

it("自检三种分摊汇总污染分别拒绝，DB自身合法的污染也不能落库", async () => {
  const { merchant, held, last } = await allocatedHold();
  const allocation = await h.prisma.pointHoldAlloc.findFirstOrThrow({
    where: { pointHoldId: held.pointHoldId },
  });
  for (const column of ["qty", "returnedQty", "forfeitedQty"] as const) {
    await expect(
      h.tx.run(async (tx) => {
        const clock = await h.ledger.lockAccount(tx, merchant.entity.id);
        await tx.pointHoldAlloc.update({
          where: {
            pointHoldId_allocNo: {
              pointHoldId: allocation.pointHoldId,
              allocNo: allocation.allocNo,
            },
          },
          data: { [column]: { increment: 1 } },
        });
        await selfCheck(tx, clock, last);
      }),
    ).rejects.toMatchObject({
      reason: "self_check",
      details: {
        hold: {
          qty: 8100,
          alloc_qty: column === "qty" ? 8101 : 8100,
          alloc_returned: column === "returnedQty" ? 1 : 0,
          alloc_forfeited: column === "forfeitedQty" ? 1 : 0,
        },
      },
    });
    expect(
      await h.prisma.pointHoldAlloc.findUniqueOrThrow({
        where: {
          pointHoldId_allocNo: {
            pointHoldId: allocation.pointHoldId,
            allocNo: allocation.allocNo,
          },
        },
      }),
    ).toEqual(allocation);
  }
});
