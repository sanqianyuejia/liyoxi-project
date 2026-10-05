// 账本用例的夹具（W1-10）：一步建好账本，造周期与发放计划，加购入账，账本现状的可比快照。只给测试用。
// 建周期、发放计划是履约的事（W1-11a）；它合并之前，账本与下游的用例用这里造：
// 行是直接插的（周期经 W0-25 的工厂，发放计划在这里），积分一律经账本函数入账，所以批次、流水、账户缓存是自洽的。
// 配带种子的库用（useSeededDatabase）：套餐与价目是种子。
import { createPrismaClient } from "@liyoxi/db";
import type { GrantSchedule, PrismaClient, SubscriptionTerm } from "@liyoxi/db";
import { grantSchedule, renewTerm, termDates } from "@liyoxi/shared/period";
import { calendarDate, endOfDay, startOfDay } from "@liyoxi/shared/time";
import type { LocalDate } from "@liyoxi/shared/time";

import { createLedger } from "../billing/index.js";
import type {
  CaptureResult,
  HoldResult,
  Ledger,
  LedgerDeps,
  PurchaseResult,
  ReturnReasonClass,
  ReturnResult,
} from "../billing/index.js";
import { createEvents } from "../events/index.js";
import type { Events } from "../events/index.js";
import { createIdentityContext, createTxRunner, uuidv7 } from "../kernel/index.js";
import type { IdentityContext, Tx, TxRunner } from "../kernel/index.js";
import { assembleForTest } from "./assembly.js";
import { createClock } from "./clock.js";
import type { AdjustableClock } from "./clock.js";
import { createFactories } from "./data/factories/index.js";
import type { Factories } from "./data/factories/index.js";

/** 库里的 date 列与“哪一天”互转：Prisma 把 date 读成 UTC 零点的 Date */
const toDateColumn = (date: LocalDate): Date => new Date(`${date}T00:00:00.000Z`);
const fromDateColumn = (value: Date): LocalDate => value.toISOString().slice(0, 10);

export interface LedgerHarness {
  readonly prisma: PrismaClient;
  readonly tx: TxRunner;
  /** 可拨时钟：账本时钟、事件的发生时间、工厂的时间列都取它 */
  readonly clock: AdjustableClock;
  readonly events: Events;
  readonly ledger: Ledger;
  readonly make: Factories;
}

export interface LedgerHarnessOptions {
  readonly clock?: AdjustableClock;
  /** 故障注入：账本每写完一步调一次 */
  readonly onStep?: LedgerDeps["onStep"];
}

/** 测试装配之上的账本：真实的事件目录与载荷校验，连传进来的测试库 */
export function createLedgerHarness(
  prisma: PrismaClient,
  options: LedgerHarnessOptions = {},
): LedgerHarness {
  const clock = options.clock ?? createClock();
  const tx = createTxRunner({ prisma, appEnv: "test" });
  const events = createEvents({ assembly: assembleForTest({ entry: "worker" }), clock, tx });
  const ledger = createLedger({
    clock,
    events,
    ...(options.onStep ? { onStep: options.onStep } : {}),
  });
  return { prisma, tx, clock, events, ledger, make: createFactories({ db: prisma, clock }) };
}

/**
 * 另开一条独立的连接（连接数上限 1），在它上面再建一套账本：并发用例里一条连接算一方。
 * 时钟与第一套共用。用完自己 close()。
 */
export async function joinLedger(
  harness: LedgerHarness,
  databaseUrl: string,
  options: Pick<LedgerHarnessOptions, "onStep"> = {},
): Promise<LedgerHarness & { close(): Promise<void> }> {
  const prisma = createPrismaClient({ connectionString: databaseUrl, max: 1 });
  const joined = createLedgerHarness(prisma, { ...options, clock: harness.clock });
  return { ...joined, close: () => prisma.$disconnect() };
}

export interface TermFixtureInput {
  readonly entityId: string;
  /** 购买周期（月），缺省 1 */
  readonly months?: number;
  /** 套餐的版本码（种子：basic、pro、flagship），缺省 pro（每月 6,600 积分） */
  readonly planCode?: string;
  /** 给了即建一个预约周期，接在它后面（它得是这个主体链尾的那一期）；不给即从现在起生效的一期，并发首月 */
  readonly after?: SubscriptionTerm;
  /** 首月发放记在谁名下；不给即系统动作 */
  readonly ctx?: IdentityContext;
}

export interface TermFixture {
  readonly term: SubscriptionTerm;
  /** 发放计划，按月序 */
  readonly schedules: readonly GrantSchedule[];
}

/**
 * 造一个周期与它的发放计划，样子与履约建出来的一致（D1 第 6.4 节）：
 * 不给 after：从账本时钟的现在起生效，锚定日取当天，首月当场发放，账户置为生效；
 *   这个主体此前过期过的话就是“过期后重新开通”（origin = resume），发完首月再记一行加购积分恢复；
 * 给 after：预约周期，起点 = 上一期的止点，锚定日沿用，等 advance 到点接续。
 * 自己开一个事务，在账户锁内做。
 */
export async function openTerm(
  harness: LedgerHarness,
  input: TermFixtureInput,
): Promise<TermFixture> {
  const { entityId, months = 1, planCode = "pro", after } = input;
  return harness.tx.run(async (tx: Tx) => {
    const { now } = await harness.ledger.lockAccount(tx, entityId);
    const account = await tx.billingAccount.findUniqueOrThrow({ where: { entityId } });
    if (!after && account.subStatus === "active") {
      throw new Error("openTerm：这个主体还有生效的周期，要接在后面请给 after");
    }
    const resumed = !after && account.subStatus === "expired";
    const plan = await tx.plan.findUniqueOrThrow({ where: { code: planCode } });
    const revision = await tx.planRevision.findFirstOrThrow({
      where: { planId: plan.id, cancelledAt: null },
      orderBy: { revisionNo: "desc" },
    });
    const dates = after
      ? renewTerm(
          {
            startDate: fromDateColumn(after.startDate),
            endDate: fromDateColumn(after.endDate),
            anchorDay: after.anchorDay,
            months: after.months,
          },
          months,
        )
      : termDates(calendarDate(now), months);
    const startsAt = after ? after.endsAt : now;
    const priceTotalFen = revision.monthlyFeeFen * months;
    const make = createFactories({ db: tx, clock: harness.clock });
    const term = await make.subscriptionTerm({
      entityId,
      planRevisionId: revision.id,
      months,
      priceTotalFen,
      termNo: (await tx.subscriptionTerm.count({ where: { entityId } })) + 1,
      origin: after ? "renew" : resumed ? "resume" : "new",
      status: after ? "scheduled" : "active",
      anchorDay: dates.anchorDay,
      startDate: toDateColumn(dates.startDate),
      endDate: toDateColumn(dates.endDate),
      startsAt,
      endsAt: endOfDay(dates.endDate),
      ...(after ? {} : { activatedAt: now }),
    });
    const rows = grantSchedule(dates, {
      monthlyPoints: revision.monthlyPoints,
      payFen: priceTotalFen,
    });
    await tx.grantSchedule.createMany({
      data: rows.map((row) => ({
        id: uuidv7(),
        subscriptionTermId: term.id,
        entityId,
        monthNo: row.monthNo,
        // 第 0 个月 = 周期起点；其余 = 当月发放日 00:00（北京时间）
        dueAt: row.monthNo === 0 ? startsAt : startOfDay(row.dueDate),
        dueDate: toDateColumn(row.dueDate),
        points: row.points,
        valueFen: row.valueFen,
        planId: plan.id,
        planRevisionId: revision.id,
        createdAt: now,
        updatedAt: now,
      })),
    });
    if (!after) {
      await tx.billingAccount.update({
        where: { entityId },
        data: { subStatus: "active", currentSubscriptionTermId: term.id, updatedAt: now },
      });
      // 首月当场发放（履约也是这样调），顺带算好 next_due_at
      const first = await tx.grantSchedule.findFirstOrThrow({
        where: { subscriptionTermId: term.id, monthNo: 0 },
      });
      await harness.ledger.grant(tx, {
        grantScheduleId: first.id,
        ...(input.ctx ? { ctx: input.ctx } : {}),
      });
      if (resumed) {
        await harness.ledger.resumeAddon(tx, {
          subscriptionTermId: term.id,
          ...(input.ctx ? { ctx: input.ctx } : {}),
        });
      }
    } else {
      await harness.ledger.refreshNextDue(tx, entityId);
    }
    const schedules = await tx.grantSchedule.findMany({
      where: { subscriptionTermId: term.id },
      orderBy: { monthNo: "asc" },
    });
    return { term, schedules };
  });
}

/** 老板在小程序里操作的身份上下文 */
export const ownerContext = (entityId: string, userId: string): IdentityContext =>
  createIdentityContext({
    actor: { type: "merchant", id: userId, client: "weapp", role: "owner" },
    entityId,
  });

/** 加购入账一笔：造一张已支付的加购付款单（1 积分 1 元），经账本的 purchase 入账。自己开一个事务 */
export async function topUp(
  harness: LedgerHarness,
  input: { entityId: string; points: number; ctx?: IdentityContext },
): Promise<PurchaseResult & { billingOrderId: string }> {
  const payFen = input.points * 100;
  const order = await harness.make.billingOrder({
    entityId: input.entityId,
    type: "topup",
    amountFen: payFen,
  });
  const ctx =
    input.ctx ??
    createIdentityContext({
      actor: { type: "system", job: "lyxtest.topup" },
      entityId: input.entityId,
    });
  const result = await harness.tx.run((tx) =>
    harness.ledger.purchase(tx, {
      entityId: input.entityId,
      billingOrderId: order.id,
      points: input.points,
      payFen,
      ctx,
    }),
  );
  return { ...result, billingOrderId: order.id };
}

/** 给一部剧定单剧积分价（custom 修订，自账本时钟的现在起生效）。等级模板价是种子：S 3,000、A 2,000、B 1,600、C 1,000 */
export async function priceDrama(
  harness: LedgerHarness,
  input: { dramaId: string; points: number; staffId: string },
): Promise<void> {
  const now = harness.clock.now();
  await harness.prisma.dramaPriceRevision.create({
    data: {
      id: uuidv7(),
      dramaId: input.dramaId,
      mode: "custom",
      customPoints: input.points,
      // 调价前后不能相同（库里有 CHECK）：调价前的价只是展示用，随便给一个不同的
      prevPoints: input.points + 1,
      newPoints: input.points,
      effectiveAt: now,
      reasonCode: "quality",
      createdByStaffId: input.staffId,
      createdAt: now,
    },
  });
}

export interface DramaHoldFixtureInput {
  readonly entityId: string;
  readonly storeId: string;
  readonly dramaId: string;
  readonly topModel?: boolean;
  readonly expectS?: number;
  /** 订单项 id：订购侧预先生成；不给即现生成一个 */
  readonly refId?: string;
  readonly ctx?: IdentityContext;
}

const fixtureContext = (entityId: string, job: string): IdentityContext =>
  createIdentityContext({ actor: { type: "system", job }, entityId });

/** 订一部剧的冻结入参：文案取“这一单只有这一部”的值 */
export function dramaHoldInput(input: DramaHoldFixtureInput & { refId: string }) {
  return {
    entityId: input.entityId,
    storeId: input.storeId,
    refType: "order_item" as const,
    refId: input.refId,
    groupRef: "LYX-TEST",
    pricing: { kind: "drama" as const, dramaId: input.dramaId, topModel: input.topModel ?? false },
    ...(input.expectS === undefined ? {} : { expectS: input.expectS }),
    title: {
      code: "order_hold" as const,
      args: {
        dramaTitles: ["测试短剧"],
        count: 1,
        pricePoints: [1],
        discountBp: 10_000,
        surchargeBp: 0,
      },
    },
    ctx: input.ctx ?? fixtureContext(input.entityId, "lyxtest.hold"),
  };
}

/** 冻结一部剧（一张订单项一张冻结单）。自己开一个事务 */
export async function holdDrama(
  harness: LedgerHarness,
  input: DramaHoldFixtureInput,
): Promise<HoldResult & { refId: string }> {
  const refId = input.refId ?? uuidv7();
  const held = await harness.tx.run((tx) =>
    harness.ledger.hold(tx, dramaHoldInput({ ...input, refId })),
  );
  return { ...held, refId };
}

/** 扣减一张冻结单（开始制作）。自己开一个事务 */
export const captureHold = (harness: LedgerHarness, pointHoldId: string): Promise<CaptureResult> =>
  harness.tx.run(async (tx) => {
    const found = await tx.pointHold.findUniqueOrThrow({ where: { id: pointHoldId } });
    return harness.ledger.capture(tx, {
      pointHoldId,
      title: { refType: "order_item", refNo: "LYX-TEST", count: 1 },
      ctx: fixtureContext(found.entityId, "lyxtest.capture"),
    });
  });

/** 释放一张冻结单（开工前取消）。自己开一个事务 */
export const releaseHold = (
  harness: LedgerHarness,
  pointHoldId: string,
  reasonClass: ReturnReasonClass = "merchant",
): Promise<ReturnResult> =>
  harness.tx.run(async (tx) => {
    const found = await tx.pointHold.findUniqueOrThrow({ where: { id: pointHoldId } });
    return harness.ledger.release(tx, {
      pointHoldId,
      reasonClass,
      title: { refNo: "LYX-TEST", dramaTitles: ["测试短剧"] },
      ctx: fixtureContext(found.entityId, "lyxtest.release"),
    });
  });

/** 退回一张已扣减的冻结单的一部分或全部。取消明细的 id 不给即现生成（每次是一次新的退回）。自己开一个事务 */
export const refundHold = (
  harness: LedgerHarness,
  input: {
    pointHoldId: string;
    qty: number;
    reasonClass?: ReturnReasonClass;
    cancelRequestLineId?: string;
  },
): Promise<ReturnResult> =>
  harness.tx.run(async (tx) => {
    const found = await tx.pointHold.findUniqueOrThrow({ where: { id: input.pointHoldId } });
    return harness.ledger.refund(tx, {
      pointHoldId: input.pointHoldId,
      qty: input.qty,
      reasonClass: input.reasonClass ?? "merchant",
      source: { type: "cancel_request_line", id: input.cancelRequestLineId ?? uuidv7() },
      refNo: "LYX-TEST",
      ctx: fixtureContext(found.entityId, "lyxtest.refund"),
    });
  });

const iso = (at: Date | null): string | null => at?.toISOString() ?? null;

/**
 * 一个主体的账本现状，去掉 id 与真实写入时刻：两个主体走不同的路（一次追赶、逐日推进）之后可以直接比。
 * 操作、流水、订阅事件按写入先后（seq）；批次按入账先后；周期用它的序号指代。
 */
export async function dumpLedger(db: PrismaClient | Tx, entityId: string) {
  const terms = await db.subscriptionTerm.findMany({
    where: { entityId },
    orderBy: { termNo: "asc" },
  });
  const termNo = new Map(terms.map((term) => [term.id, term.termNo]));
  const no = (id: string | null): number | null => (id === null ? null : (termNo.get(id) ?? null));
  const account = await db.billingAccount.findUniqueOrThrow({ where: { entityId } });
  const schedules = await db.grantSchedule.findMany({
    where: { entityId },
    orderBy: [{ dueAt: "asc" }, { monthNo: "asc" }],
  });
  const lots = await db.pointLot.findMany({
    where: { entityId },
    orderBy: [{ grantedAt: "asc" }, { kind: "desc" }, { originalQty: "asc" }],
  });
  const operations = await db.ledgerOperation.findMany({
    where: { entityId },
    orderBy: { seq: "asc" },
  });
  const entries = await db.pointLedgerEntry.findMany({
    where: { entityId },
    orderBy: { seq: "asc" },
  });
  const subscriptionEvents = await db.subscriptionEvent.findMany({
    where: { entityId },
    orderBy: { seq: "asc" },
  });
  const holds = await db.pointHold.findMany({
    where: { entityId },
    orderBy: [{ heldAt: "asc" }, { id: "asc" }],
    include: { pointHoldAllocs: { orderBy: { allocNo: "asc" } } },
  });
  return {
    account: {
      subStatus: account.subStatus,
      currentTermNo: no(account.currentSubscriptionTermId),
      planAvailableQty: account.planAvailableQty,
      addonAvailableQty: account.addonAvailableQty,
      heldTotalQty: account.heldTotalQty,
      nextDueAt: iso(account.nextDueAt),
      lastExpiredQty: account.lastExpiredQty,
      lastExpiredAt: iso(account.lastExpiredAt),
    },
    terms: terms.map((term) => ({
      termNo: term.termNo,
      status: term.status,
      startsAt: iso(term.startsAt),
      endsAt: iso(term.endsAt),
      activatedAt: iso(term.activatedAt),
      endedAt: iso(term.endedAt),
    })),
    schedules: schedules.map((row) => ({
      termNo: no(row.subscriptionTermId),
      monthNo: row.monthNo,
      status: row.status,
      points: row.points,
      grantedAt: iso(row.grantedAt),
    })),
    lots: lots.map((lot) => ({
      kind: lot.kind,
      sourceType: lot.sourceType,
      termNo: no(lot.subscriptionTermId),
      grantedAt: iso(lot.grantedAt),
      bizDate: fromDateColumn(lot.bizDate),
      expiresAt: iso(lot.expiresAt),
      originalQty: lot.originalQty,
      availableQty: lot.availableQty,
      heldQty: lot.heldQty,
      expiredQty: lot.expiredQty,
      costBasisFen: lot.costBasisFen,
    })),
    // 冻结单一族用到的另外几个桶，与 lots 同序
    lotBuckets: lots.map((lot) => ({
      consumedQty: lot.consumedQty,
      convertedOutQty: lot.convertedOutQty,
      adjustedOutQty: lot.adjustedOutQty,
    })),
    holds: holds.map((hold) => ({
      refType: hold.refType,
      qty: hold.qty,
      status: hold.status,
      returnedQty: hold.returnedQty,
      forfeitedQty: hold.forfeitedQty,
      termNo: no(hold.subscriptionTermId),
      heldAt: iso(hold.heldAt),
      capturedAt: iso(hold.capturedAt),
      closedAt: iso(hold.closedAt),
      allocs: hold.pointHoldAllocs.map((alloc) => ({
        allocNo: alloc.allocNo,
        lotKind: alloc.lotKind,
        qty: alloc.qty,
        returnedQty: alloc.returnedQty,
        forfeitedQty: alloc.forfeitedQty,
      })),
    })),
    operations: operations.map((op) => ({
      opType: op.opType,
      refType: op.refType,
      occurredAt: iso(op.occurredAt),
      bizDate: fromDateColumn(op.bizDate),
      planDeltaQty: op.planDeltaQty,
      addonDeltaQty: op.addonDeltaQty,
      spendableAfterQty: op.spendableAfterQty,
      heldAfterQty: op.heldAfterQty,
      titleCode: op.titleCode,
      actorType: op.actorType,
    })),
    entries: entries.map((entry) => ({
      lotKind: entry.lotKind,
      fromBucket: entry.fromBucket,
      toBucket: entry.toBucket,
      qty: entry.qty,
      occurredAt: iso(entry.occurredAt),
      bizDate: fromDateColumn(entry.bizDate),
    })),
    subscriptionEvents: subscriptionEvents.map((event) => ({
      type: event.type,
      termNo: no(event.subscriptionTermId),
      occurredAt: iso(event.occurredAt),
      bizDate: fromDateColumn(event.bizDate),
    })),
  };
}

export type LedgerDump = Awaited<ReturnType<typeof dumpLedger>>;
