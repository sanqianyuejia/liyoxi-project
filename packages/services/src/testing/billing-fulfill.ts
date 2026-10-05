// 履约用例的夹具（W1-11a）：账本夹具之上再建履约；造“已支付、还没履约”的套餐付款单。只给测试用。
// 付款单是直接插的行（创建、凭证、确认到账在 W1-11b；入账函数在本包的付款侧）：样子与入账函数置为已支付、
// 调 fulfill 之前的那一刻一致——已支付、实收已写、履约状态还是 none。内容快照照报价函数会给的样子拼，价目取种子。
import { createPrismaClient } from "@liyoxi/db";
import type { BillingOrder, PrismaClient } from "@liyoxi/db";

import { createFulfillment } from "../billing/index.js";
import type { FulfillDeps, Fulfillment, FulfillOutcome } from "../billing/index.js";
import { createIdentityContext } from "../kernel/index.js";
import type { IdentityContext } from "../kernel/index.js";
import { createLedgerHarness } from "./billing.js";
import type { LedgerHarness } from "./billing.js";
import type { AdjustableClock } from "./clock.js";

export interface FulfillHarness extends LedgerHarness {
  readonly fulfillment: Fulfillment;
}

export interface FulfillHarnessOptions {
  readonly clock?: AdjustableClock;
  /** 故障注入：履约与账本每写完一步调一次（步骤名见 FULFILL_STEPS） */
  readonly onStep?: FulfillDeps["onStep"];
}

/** 账本夹具加履约：同一个时钟、同一份事件目录 */
export function createFulfillHarness(
  prisma: PrismaClient,
  options: FulfillHarnessOptions = {},
): FulfillHarness {
  const ledger = createLedgerHarness(prisma, options);
  const fulfillment = createFulfillment({
    clock: ledger.clock,
    events: ledger.events,
    ...(options.onStep ? { onStep: options.onStep } : {}),
  });
  return { ...ledger, fulfillment };
}

/** 另开一条独立的连接（连接数上限 1）再建一套：并发用例里一条连接算一方。时钟与第一套共用，用完自己 close() */
export async function joinFulfillment(
  harness: FulfillHarness,
  databaseUrl: string,
  options: Pick<FulfillHarnessOptions, "onStep"> = {},
): Promise<FulfillHarness & { close(): Promise<void> }> {
  const prisma = createPrismaClient({ connectionString: databaseUrl, max: 1 });
  const joined = createFulfillHarness(prisma, { ...options, clock: harness.clock });
  return { ...joined, close: () => prisma.$disconnect() };
}

export interface PaidPlanOrderInput {
  readonly entityId: string;
  /** 套餐的版本码（种子：basic、pro、flagship），缺省 pro（月费 6,000 元、每月 6,600 积分） */
  readonly planCode?: string;
  /** 购买周期（月），缺省 1 */
  readonly months?: number;
  /** 应付（分）：缺省 = 月费 × 月数。给一个除不尽月数的值可以看尾差 */
  readonly payFen?: number;
  /** 实收（分）：缺省 = 应付。给不同的值即“实收与应付不符” */
  readonly paidAmountFen?: number;
  /** 付款类型，缺省 plan_new */
  readonly type?: "plan_new" | "plan_renew";
  /** 首期优惠占的是哪一版价目；不给即快照不带优惠 */
  readonly promoClaimRevisionId?: string;
}

/** 造一张已支付、还没履约的套餐付款单。内容快照指向种子里该套餐最新的一版价目 */
export async function paidPlanOrder(
  harness: Pick<LedgerHarness, "prisma" | "make" | "clock">,
  input: PaidPlanOrderInput,
): Promise<BillingOrder> {
  const { entityId, planCode = "pro", months = 1 } = input;
  const plan = await harness.prisma.plan.findUniqueOrThrow({ where: { code: planCode } });
  const revision = await harness.prisma.planRevision.findFirstOrThrow({
    where: { planId: plan.id, cancelledAt: null },
    orderBy: { revisionNo: "desc" },
  });
  const cyclePriceFen = revision.monthlyFeeFen * months;
  const payFen = input.payFen ?? cyclePriceFen;
  const paidAmountFen = input.paidAmountFen ?? payFen;
  return harness.make.billingOrder({
    entityId,
    type: input.type ?? "plan_new",
    status: "paid",
    amountFen: payFen,
    paidAmountFen,
    fulfillmentStatus: "none",
    fulfilledAt: null,
    contentSnapshot: {
      v: 1,
      kind: "plan",
      planId: plan.id,
      planRevisionId: revision.id,
      months,
      cyclePriceFen,
      payFen,
      monthlyPoints: revision.monthlyPoints,
      discountBp: revision.discountBp,
      promo:
        input.promoClaimRevisionId === undefined
          ? null
          : {
              claimRevisionId: input.promoClaimRevisionId,
              type: "previous_revision",
              appliedRevisionId: revision.id,
            },
      quotedAt: harness.clock.now().toISOString(),
    },
  });
}

/** 财务在后台确认到账的身份上下文（入账的操作人） */
export const financeContext = (entityId: string, staffId: string): IdentityContext =>
  createIdentityContext({ actor: { type: "staff", id: staffId, client: "admin" }, entityId });

/** 履约一张付款单：自己开一个事务。ctx 不给即系统动作（微信回调、补单） */
export function fulfillOrder(
  harness: FulfillHarness,
  order: Pick<BillingOrder, "id" | "entityId">,
  ctx?: IdentityContext,
): Promise<FulfillOutcome> {
  const actor =
    ctx ??
    createIdentityContext({
      actor: { type: "system", job: "lyxtest.fulfill" },
      entityId: order.entityId,
    });
  return harness.tx.run((tx) =>
    harness.fulfillment.fulfill(tx, { billingOrderId: order.id, ctx: actor }),
  );
}
