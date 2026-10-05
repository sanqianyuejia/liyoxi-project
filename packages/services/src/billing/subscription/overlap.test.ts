import type { PrismaClient } from "@liyoxi/db";
import { beforeAll, describe, expect, it } from "vitest";

import {
  assertSnapshotsEqual,
  connectTestDatabase,
  createFulfillHarness,
  fulfillOrder,
  paidPlanOrder,
  snapshotTables,
  useSeededDatabase,
} from "../../testing/index.js";
import type { FulfillHarness } from "../../testing/index.js";
import { subscriptionInvariants } from "./invariants.js";

// 验收 6：周期不重叠。建周期前服务层查同主体预约、生效、已到期的周期区间，相交即按受阻处理（CONSTRAINT_VIOLATION，
// 带相交的两个周期），不等库里的排他约束到提交时才报（那样整个入账事务就回滚了）；把排他约束去掉，结果相同（V5）。
// 手工造的重叠由每日的 billing.I10 查出。

const SLOW = 180_000;
const at = (local: string): Date => new Date(`${local}+08:00`);
const TABLES = [
  "billing_account",
  "subscription_term",
  "subscription_event",
  "grant_schedule",
  "point_lot",
  "ledger_operation",
  "point_ledger_entry",
  "outbox_event",
];

const db = useSeededDatabase("services");
let prisma: PrismaClient;
let h: FulfillHarness;

beforeAll(async () => {
  prisma = await db.prisma();
  h = createFulfillHarness(prisma);
}, SLOW);

const i10 = (entityId: string) =>
  h.tx.run(async (tx) => {
    const check = subscriptionInvariants.find((item) => item.code === "billing.I10");
    return (await check?.run?.(tx, { entityIds: [entityId] }, { now: h.clock.now() })) ?? [];
  });

/** 一个已过期的主体，它已到期的那一期被改成止于 02-20（数据异常：止点落在“现在”之后） */
async function expiredWithLingeringTerm() {
  h.clock.set(at("2026-01-05T12:00:00"));
  const { entity } = await h.make.merchant({ verified: true });
  const opened = await paidPlanOrder(h, { entityId: entity.id });
  await fulfillOrder(h, opened);
  h.clock.set(at("2026-02-10T10:00:00"));
  await h.tx.run((tx) => h.ledger.advance(tx, entity.id));
  const ended = await prisma.subscriptionTerm.findUniqueOrThrow({
    where: { sourceBillingOrderId: opened.id },
  });
  expect(ended.status).toBe("ended");
  const lingering = {
    endDate: new Date("2026-02-20T00:00:00.000Z"),
    endsAt: at("2026-02-21T00:00:00"),
  };
  await prisma.subscriptionTerm.update({ where: { id: ended.id }, data: lingering });
  return { entityId: entity.id, ended, restore: { endDate: ended.endDate, endsAt: ended.endsAt } };
}

/** 在这样的主体上履约一张新付款单：被拦成受阻、不留残留；把数据改回去之后同一张单履约成功 */
async function blockedThenDone(): Promise<void> {
  const { entityId, ended, restore } = await expiredWithLingeringTerm();
  const order = await paidPlanOrder(h, { entityId, type: "plan_renew" });
  const before = await snapshotTables(prisma, TABLES);

  const { result } = await fulfillOrder(h, order);
  expect(result).toEqual({
    status: "blocked",
    reasonCode: "CONSTRAINT_VIOLATION",
    detail: {
      problem: "term_overlap",
      terms: [
        {
          termId: ended.id,
          status: "ended",
          startsAt: ended.startsAt.toISOString(),
          endsAt: "2026-02-20T16:00:00.000Z",
        },
        {
          termId: null,
          status: "active",
          startsAt: "2026-02-10T02:00:00.000Z",
          endsAt: "2026-03-09T16:00:00.000Z",
        },
      ],
    },
  });
  assertSnapshotsEqual(before, await snapshotTables(prisma, TABLES));

  await prisma.subscriptionTerm.update({ where: { id: ended.id }, data: restore });
  expect((await fulfillOrder(h, order)).result).toMatchObject({
    status: "done",
    queuedBehindActive: false,
  });
  expect(await i10(entityId)).toEqual([]);
}

describe("周期不重叠（验收 6）", () => {
  it("排他约束在：相交的周期在建周期时被服务层拦下，转成履约受阻", blockedThenDone, SLOW);

  it(
    "没有生效周期却挂着预约周期（推进接续不到它）：同样拦下，不往上叠新周期",
    async () => {
      h.clock.set(at("2026-01-05T12:00:00"));
      const { entity } = await h.make.merchant({ verified: true });
      const stray = await h.make.subscriptionTerm({
        entityId: entity.id,
        status: "scheduled",
        startDate: new Date("2026-06-01T00:00:00.000Z"),
        endDate: new Date("2026-06-30T00:00:00.000Z"),
        startsAt: at("2026-06-01T00:00:00"),
        endsAt: at("2026-07-01T00:00:00"),
      });
      const order = await paidPlanOrder(h, { entityId: entity.id });
      expect((await fulfillOrder(h, order)).result).toMatchObject({
        status: "blocked",
        reasonCode: "CONSTRAINT_VIOLATION",
        detail: { problem: "scheduled_without_active", terms: [{ termId: stray.id }] },
      });
      expect(await prisma.subscriptionTerm.count({ where: { entityId: entity.id } })).toBe(1);
      // 这条孤立的预约周期每日校验也报得出来（首尾不相接）
      expect(await i10(entity.id)).toMatchObject([
        { subject: { type: "subscription_term", id: stray.id }, detail: { problem: "gap" } },
      ]);
    },
    SLOW,
  );

  it(
    "去掉排他约束：服务层的结果相同；手工造一条重叠，billing.I10 查得出",
    async () => {
      const owner = await connectTestDatabase(db.name, { role: null });
      try {
        await owner.query(
          "ALTER TABLE subscription_term DROP CONSTRAINT ex_subscription_term_no_overlap",
        );
      } finally {
        await owner.end();
      }
      await blockedThenDone();

      // 手工造的重叠：没有约束也没有经过履约，只有每日校验能发现
      h.clock.set(at("2026-03-01T12:00:00"));
      const { entity } = await h.make.merchant({ verified: true });
      const order = await paidPlanOrder(h, { entityId: entity.id });
      await fulfillOrder(h, order);
      const active = await prisma.subscriptionTerm.findUniqueOrThrow({
        where: { sourceBillingOrderId: order.id },
      });
      expect(await i10(entity.id)).toEqual([]);
      const overlapping = await h.make.subscriptionTerm({
        entityId: entity.id,
        termNo: 2,
        status: "ended",
        startDate: new Date("2026-03-20T00:00:00.000Z"),
        endDate: new Date("2026-04-19T00:00:00.000Z"),
        startsAt: at("2026-03-20T00:00:00"),
        endsAt: at("2026-04-20T00:00:00"),
        endedAt: at("2026-04-20T00:00:00"),
      });
      expect(await i10(entity.id)).toMatchObject([
        {
          subject: { type: "subscription_term", id: overlapping.id },
          entityId: entity.id,
          detail: { problem: "overlap", otherTermId: active.id },
        },
      ]);
    },
    SLOW,
  );
});
