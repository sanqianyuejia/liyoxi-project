import { PricingSnapshotSchema } from "@liyoxi/contract";
import type { OrderItem } from "@liyoxi/db";
import type { OrderCreateBody } from "@liyoxi/contract";
import { AppError, lockRows, uuidv7, notifyReadOf } from "../kernel/index.js";
import type { Tx } from "../kernel/index.js";
import { getEntitlements, getWalletView, quoteHold } from "../billing/index.js";
import type { HoldResult } from "../billing/index.js";
import { paramsAt } from "../config/index.js";
import { createFlow } from "../flow/index.js";
import { maskName } from "@liyoxi/shared/mask";
import type { OrderActor, OrderDeps } from "./context.js";
import { owner, submitChecks, currentLicense } from "./checks.js";
import { detailFromCreated } from "./read.js";
const date = (value: string | null | undefined) => (value ? new Date(`${value}T00:00:00Z`) : null);
async function repriceError(
  tx: Tx,
  deps: OrderDeps,
  actor: OrderActor,
  input: OrderCreateBody,
  error: AppError,
  held: readonly HoldResult[],
): Promise<never> {
  // hold 已取得账户锁；此处仅重入，既不预锁，也不写账本。应用拒绝未中断 SQL，可读取整单报价后抛给外层回滚。
  const clock = await deps.ledger.lockAccount(tx, actor.membership.entityId),
    entitlement = await getEntitlements(tx, actor.membership.entityId, clock.now);
  if (!entitlement.term) throw error;
  const snapshots = await Promise.all(
    input.dramaIds.map((dramaId) =>
      quoteHold(
        tx,
        { ...entitlement.term!, id: entitlement.term!.termId },
        { kind: "drama", dramaId, topModel: input.isTopModel },
        clock.now,
      ),
    ),
  );
  const items = snapshots.map((s, index) => ({
      dramaId: input.dramaIds[index]!,
      chargePoints: s.S,
    })),
    total = items.reduce((n, i) => n + i.chargePoints, 0);
  if (error.error === "QUOTE_CHANGED")
    throw new AppError("QUOTE_CHANGED", {
      details: { kind: "points", totalChargePoints: total, items },
      cause: error,
    });
  const wallet = await getWalletView(tx, actor.membership.entityId, clock.now),
    spendable = wallet.points.spendablePoints + held.reduce((n, h) => n + h.points, 0);
  throw new AppError("POINTS_INSUFFICIENT", {
    details: {
      requiredPoints: total,
      spendablePoints: spendable,
      shortfallPoints: Math.max(0, total - spendable),
    },
    cause: error,
  });
}
export async function submit(tx: Tx, deps: OrderDeps, actor: OrderActor, input: OrderCreateBody) {
  owner(actor);
  const { entityId, storeId } = actor.membership;
  await lockRows(tx, "entity", [entityId]);
  await lockRows(tx, "entity_member", [actor.membership.memberId]);
  await lockRows(tx, "store", [storeId]);
  const membership = await tx.entityMember.findFirst({
    where: {
      id: actor.membership.memberId,
      entityId,
      merchantUserId: actor.ctx.actor.id!,
      role: "owner",
      status: "active",
    },
  });
  if (!membership) throw new AppError("NOT_A_MEMBER");
  const before = deps.clock.now(),
    checked = await submitChecks(tx, deps, actor, input, before),
    term = (await getEntitlements(tx, entityId, before)).term!;
  const initialPricing = await Promise.all(
    input.dramaIds.map((dramaId) =>
      quoteHold(
        tx,
        { ...term, id: term.termId },
        { kind: "drama", dramaId, topModel: input.isTopModel },
        before,
      ),
    ),
  );
  const orderId = uuidv7(),
    itemIds = input.dramaIds.map(() => uuidv7());
  await currentLicense(tx, deps, input.agreementVersionId);
  const store = await tx.store.findUniqueOrThrow({
    where: { id: storeId },
    include: { entity: true },
  });
  const orderNo = await deps.bizNo.next(tx, "LYX"),
    user = await tx.merchantUser.findUniqueOrThrow({ where: { id: actor.ctx.actor.id! } });
  const consent = await deps.docs.recordTransactionConsents(tx, actor.ctx, {
    scene: "order_submit",
    method: "checkbox",
    consents: [{ agreementVersionId: input.agreementVersionId }],
    signer: {
      merchantUserId: user.id,
      phoneEnc: user.phoneEnc!,
      phoneMask: user.phoneMask!,
      operatorNameMask:
        membership.displayName || user.displayName
          ? maskName(membership.displayName || user.displayName!)
          : null,
      role: "owner",
      appid: null,
      openidHmac: null,
    },
    entity: {
      entityId,
      entityName: store.entity.name,
      usccEnc: store.entity.usccEnc,
      usccMask: store.entity.usccMask,
      storeId,
    },
    biz: { type: "drama_order", id: orderId, no: orderNo },
  });
  const title = {
    code: "order_hold" as const,
    args: {
      dramaTitles: input.dramaIds.map((id) => checked.snapshots.get(id)!.title),
      count: input.dramaIds.length,
      pricePoints: initialPricing.map((s) => (s.kind === "drama" ? s.P : 0)),
      discountBp: term.discountBp,
      surchargeBp: initialPricing[0]!.kind === "drama" ? initialPricing[0]!.surchargeBp : 0,
    },
  };
  const held: HoldResult[] = [];
  try {
    for (let i = 0; i < input.dramaIds.length; i++)
      held.push(
        await deps.ledger.hold(tx, {
          entityId,
          storeId,
          refType: "order_item",
          refId: itemIds[i]!,
          groupRef: orderNo,
          pricing: { kind: "drama", dramaId: input.dramaIds[i]!, topModel: input.isTopModel },
          expectS: input.expect.items.find((e) => e.dramaId === input.dramaIds[i])!.chargePoints,
          title,
          ctx: actor.ctx,
        }),
      );
  } catch (error) {
    if (
      error instanceof AppError &&
      (error.error === "QUOTE_CHANGED" || error.error === "POINTS_INSUFFICIENT")
    )
      return repriceError(tx, deps, actor, input, error, held);
    throw error;
  }
  // immutable 整单标题已随第一笔冻结写入；P/R/T 变化即便抵消为同一 S，也不能提交不一致标题。
  if (
    held.some((h, index) => {
      const actual = h.snapshot,
        quoted = initialPricing[index]!;
      return (
        actual.kind !== "drama" ||
        quoted.kind !== "drama" ||
        actual.P !== quoted.P ||
        actual.discountBp !== quoted.discountBp ||
        actual.surchargeBp !== quoted.surchargeBp
      );
    })
  )
    return repriceError(tx, deps, actor, input, new AppError("QUOTE_CHANGED"), held);
  const now = new Date(held[0]!.now); // Tf：第一次真实 hold 成功取得的账本时刻。
  const late = await submitChecks(tx, deps, actor, input, now);
  await currentLicense(tx, deps, input.agreementVersionId); // Tv：公共 Docs 再取实际时刻，变版整笔回滚。
  const first = PricingSnapshotSchema.parse(held[0]!.snapshot);
  if (first.kind !== "drama") throw new TypeError("订剧冻结必须返回 drama 计价快照");
  const plan = await tx.plan.findUniqueOrThrow({ where: { id: first.planId } }),
    total = held.reduce((n, h) => n + h.points, 0);
  const createdOrder = await tx.dramaOrder.create({
    data: {
      id: orderId,
      orderNo,
      entityId,
      storeId,
      placedByUserId: user.id,
      status: "pending_start",
      subStatus: late.gate === "full" ? "starting" : "qualification_reviewing",
      statusChangedAt: now,
      itemCount: itemIds.length,
      totalChargePoints: total,
      subscriptionTermId: first.termId,
      planCode: plan.code,
      discountBp: first.discountBp,
      isTopModel: input.isTopModel,
      surchargeBp: first.surchargeBp,
      focusCodes: input.focusCodes,
      note: input.note ?? null,
      expectedLaunchDate: date(input.expectedLaunchDate),
      agreementConsentId: consent[0]!.agreementConsentId,
      deliveryManagerId: store.deliveryManagerId,
      submittedAt: now,
      createdAt: now,
      updatedAt: now,
    },
  });
  const createdItems: OrderItem[] = [];
  for (let i = 0; i < itemIds.length; i++) {
    const snapshot = late.snapshots.get(input.dramaIds[i]!)!,
      pricing = PricingSnapshotSchema.parse(held[i]!.snapshot);
    if (pricing.kind !== "drama") throw new TypeError("订剧冻结必须返回 drama 计价快照");
    const createdItem = await tx.orderItem.create({
      data: {
        id: itemIds[i]!,
        dramaOrderId: orderId,
        itemNo: i + 1,
        entityId,
        storeId,
        dramaId: snapshot.dramaId,
        dramaSnapshot: snapshot,
        episodeCount: snapshot.totalEpisodes,
        listPricePoints: pricing.P,
        discountBp: pricing.discountBp,
        surchargeBp: pricing.surchargeBp,
        chargePoints: pricing.S,
        pricingSnapshot: pricing,
        productionModel:
          pricing.topModelSelected || pricing.planModel === "top" ? "top" : pricing.planModel,
        pointHoldId: held[i]!.pointHoldId,
        phase: "pending_start",
        phaseChangedAt: now,
        usageEndDate: date(snapshot.licenseEndDate)!,
        usageEndSource: "license",
        createdAt: now,
        updatedAt: now,
      },
    });
    createdItems.push(createdItem);
    await tx.orderItemAccount.createMany({
      data: late.accounts.map((a) => ({
        orderItemId: itemIds[i]!,
        channelAccountId: a.id,
        platform: a.platform,
        createdAt: now,
      })),
    });
  }
  // 仅新建 order.submit 初始迁移适配 Tf；内核、全局 Flow、Docs Tc/Tv 和真实 events 依赖保持原行为。
  const initialFlow = createFlow({
    assembly: deps.assembly,
    events: deps.events,
    clock: { now: () => new Date(now) },
  });
  for (const id of itemIds)
    await initialFlow.transition(tx, actor.ctx, {
      machine: "order_item",
      stateField: "phase",
      id,
      event: "order.submit",
      ref: "09:351",
      created: true,
      entityId,
      storeId,
      emit: { none: true, primary: "order.submitted" },
    });
  await tx.cartItem.deleteMany({ where: { storeId, dramaId: { in: input.dramaIds } } });
  if (late.gate === "full") {
    const params = await paramsAt(tx, ["order.start_delay_minutes"], now);
    await deps.timers.arm(tx, {
      kind: "order.start",
      subject: { type: "drama_order", id: orderId },
      key: `order.start:drama_order:${orderId}`,
      fireAt: new Date(now.getTime() + params["order.start_delay_minutes"] * 60_000),
      entityId,
      storeId,
    });
  }
  await initialFlow.transition(tx, actor.ctx, {
    machine: "drama_order",
    stateField: "status",
    id: orderId,
    event: "order.submit",
    ref: "09:196",
    created: true,
    entityId,
    storeId,
    emit: {
      type: "order.submitted",
      payload: {
        v: 1,
        dramaOrderId: orderId,
        entityId,
        storeId,
        orderItemIds: itemIds,
        totalPoints: total,
        placedByUserId: user.id,
      },
    },
  });
  await notifyReadOf(deps.assembly).read(tx, "orderForNotify", orderId);
  // order_submit 为 outbox 来源；M7 analytics.fromOutbox 从唯一 order.submitted 派生，不额外直记同名埋点。
  return {
    ...(await detailFromCreated(tx, {
      order: createdOrder,
      items: createdItems,
      store,
      receipt: consent[0]!,
    })),
    replayed: false,
  };
}
