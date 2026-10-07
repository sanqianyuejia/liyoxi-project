import { OrderQuoteSchema } from "@liyoxi/contract";
import type { OrderQuoteBody } from "@liyoxi/contract";
import { orderLotsForDeduction, planAllocation } from "@liyoxi/shared/alloc";
import { quoteDramaItem } from "@liyoxi/shared/pricing";
import { calendarDate, diffDays } from "@liyoxi/shared/time";
import { AppError } from "../kernel/index.js";
import type { Tx } from "../kernel/index.js";
import { getWalletView, paramsAt, getEntitlements } from "../billing/index.js";
import { paramsAt as configParamsAt } from "../config/index.js";
import { assertProfileComplete } from "../profile/index.js";
import type { OrderActor, OrderDeps } from "./context.js";
import { qualification, openIndustry, earliestLaunch, currentLicense } from "./checks.js";
import { orderAccounts } from "./accounts.js";
/** 本请求内的真实字典名，按type+code隔离；映射保留输入次序、重复与缺码回落。 */
export async function dictRefsFor(
  tx: Tx,
  groups: readonly { type: string; codes: readonly string[] }[],
) {
  const rows = await tx.dictItem.findMany({
    where: {
      OR: groups.map(({ type, codes }) => ({ dictTypeKey: type, code: { in: [...codes] } })),
    },
    select: { dictTypeKey: true, code: true, name: true },
  });
  const names = new Map<string, Map<string, string>>();
  for (const row of rows) {
    const type = names.get(row.dictTypeKey) ?? new Map<string, string>();
    type.set(row.code, row.name);
    names.set(row.dictTypeKey, type);
  }
  return (type: string, codes: readonly string[]) =>
    codes.map((code) => ({ code, name: names.get(type)?.get(code) ?? code }));
}
export async function dictRefs(tx: Tx, type: string, codes: readonly string[]) {
  return (await dictRefsFor(tx, [{ type, codes }]))(type, codes);
}
// 只读批次筛选与账本扣减口径一致；分配算法复用 shared，报价不锁账户、不推进周期。
export async function previewAllocation(
  tx: Tx,
  entityId: string,
  termId: string,
  at: Date,
  amount: number,
) {
  const rows = await tx.pointLot.findMany({
    where: {
      entityId,
      availableQty: { gt: 0 },
      OR: [{ kind: "addon" }, { kind: "plan", subscriptionTermId: termId, expiresAt: { gt: at } }],
    },
  });
  const lots = orderLotsForDeduction(
      rows.map((r) => ({ ...r, kind: r.kind === "plan" ? ("plan" as const) : ("addon" as const) })),
    ),
    plan = planAllocation(amount, lots);
  const allocated = new Map(plan.allocations.map((a) => [a.lotId, a.qty]));
  return {
    plan,
    lots,
    allocation: {
      planLots: lots
        .filter((l) => l.kind === "plan" && allocated.has(l.id))
        .map((l) => ({ expiresAt: l.expiresAt!.toISOString(), points: allocated.get(l.id)! })),
      addonPoints: lots
        .filter((l) => l.kind === "addon")
        .reduce((n, l) => n + (allocated.get(l.id) ?? 0), 0),
    },
    balanceAfter: {
      planPoints: lots
        .filter((l) => l.kind === "plan")
        .reduce((n, l) => n + l.availableQty - (allocated.get(l.id) ?? 0), 0),
      addonPoints: lots
        .filter((l) => l.kind === "addon")
        .reduce((n, l) => n + l.availableQty - (allocated.get(l.id) ?? 0), 0),
    },
  };
}
export async function quote(
  tx: Tx,
  deps: OrderDeps,
  actor: OrderActor,
  input: OrderQuoteBody,
  at: Date,
  newDays: number | null,
) {
  const { storeId, entityId } = actor.membership;
  const blockers: { code: string; message: string; dramaId?: string }[] = [];
  async function collect(action: () => Promise<unknown>, dramaId?: string) {
    try {
      await action();
    } catch (e) {
      if (!(e instanceof AppError) || e.error === "VALIDATION_FAILED") throw e;
      blockers.push({ code: e.error, message: e.message, ...(dramaId ? { dramaId } : {}) });
    }
  }
  await collect(() => assertProfileComplete(tx, storeId));
  await collect(() => qualification(tx, storeId));
  await collect(() => openIndustry(tx, storeId));
  // 没有生效周期不能计算折扣；按 m04 的明确错误直接拒绝。
  const entitlement = await getEntitlements(tx, entityId, at);
  if (!entitlement.term) throw new AppError("SUBSCRIPTION_INACTIVE");
  const term = entitlement.term;
  if (entitlement.refundPending)
    blockers.push({ code: "PLAN_REFUND_IN_PROGRESS", message: "套餐退款处理中" });
  const wallet = await getWalletView(tx, entityId, at),
    params = await paramsAt(tx, at);
  const accounts = await orderAccounts(tx, storeId);
  let selected = accounts.available.filter((a) => (input.channelAccountIds ?? []).includes(a.id));
  await collect(async () => {
    selected = (await orderAccounts(tx, storeId, input.channelAccountIds ?? [])).selected;
  });
  const rows = await deps.content.getDramaCards(tx, input.dramaIds, at),
    byId = new Map(rows.map((r) => [r.id, r]));
  const openSlots = (await configParamsAt(tx, ["content.placement.open_slots"], at))[
    "content.placement.open_slots"
  ];
  const items = [];
  for (const id of input.dramaIds) {
    const row = byId.get(id);
    if (!row) {
      await collect(async () => {
        throw new AppError("DRAMA_NOT_ORDERABLE", {
          details: { dramaId: id, reason: "not_listed" },
        });
      }, id);
      continue;
    }
    let reason: string | null = null;
    try {
      await deps.content.assertOrderable(
        tx,
        id,
        selected.map((a) => a.platform),
        calendarDate(at),
      );
    } catch (e) {
      if (!(e instanceof AppError)) throw e;
      reason =
        e.details && typeof e.details === "object" && "reason" in e.details
          ? String(e.details.reason)
          : "not_listed";
      blockers.push({ code: e.error, message: e.message, dramaId: id });
    }
    const calculated = quoteDramaItem({
      listPricePoints: row.listPricePoints ?? 0,
      discountBp: term.discountBp,
      topModelSurchargeBp: params.topModelSurchargeBp,
      isTopModelIncluded: term.productionModel === "top",
      isTopModelSelected: input.isTopModel,
    });
    const base = quoteDramaItem({
      listPricePoints: row.listPricePoints ?? 0,
      discountBp: term.discountBp,
      topModelSurchargeBp: params.topModelSurchargeBp,
      isTopModelIncluded: term.productionModel === "top",
      isTopModelSelected: false,
    });
    items.push({
      drama: {
        dramaId: id,
        title: row.title,
        posterUrl: null,
        genres: await dictRefs(tx, "genre", row.genreCodes),
        totalEpisodes: row.totalEpisodes ?? 1,
        heatTier: row.heatTier,
        badge:
          row.firstListedAt &&
          newDays !== null &&
          diffDays(calendarDate(at), calendarDate(row.firstListedAt)) < newDays
            ? "new"
            : row.heatTier === "S"
              ? "hot"
              : null,
        listPricePoints: row.listPricePoints,
        discountedPoints: base.chargePoints,
        usableUntilDate: row.licenseEndDate,
      },
      ...calculated,
      listPricePoints: row.listPricePoints ?? 0,
      discountBp: term.discountBp,
      allowedPlacements: row.allowedPlacements.filter((p) => new Set<string>(openSlots).has(p)),
      platforms: row.dramaCopyrights[0]?.platforms ?? [],
      orderable: reason === null,
      unorderableReason: reason,
    });
  }
  const total = items.reduce((n, i) => n + i.chargePoints, 0),
    preview = await previewAllocation(tx, entityId, term.termId, at, total);
  if (preview.plan.shortfall)
    blockers.push({ code: "POINTS_INSUFFICIENT", message: "可用积分不足" });
  const store = await tx.store.findUniqueOrThrow({
      where: { id: storeId },
      include: { entity: true, storeProfileStore: true },
    }),
    agreement = await currentLicense(tx, deps);
  const available = accounts.available.filter((a) =>
    rows.every((r) => r.dramaCopyrights[0]?.platforms.includes(a.platform)),
  );
  return OrderQuoteSchema.parse({
    quotedAt: at.toISOString(),
    store: {
      storeId,
      storeName: store.name,
      entityName: store.entity.name,
      isEntityVerified: store.entity.verificationStatus === "verified",
      contactName: store.storeProfileStore?.contactName ?? null,
      contactPhoneMask: store.storeProfileStore?.contactPhoneMask ?? null,
    },
    plan: {
      planCode: wallet.subscription.plan!.code,
      planName: wallet.subscription.plan!.name,
      productionModel: term.productionModel,
      discountBp: term.discountBp,
      topModelSurchargeBp: params.topModelSurchargeBp,
      isTopModelIncluded: term.productionModel === "top",
    },
    items,
    totalChargePoints: total,
    spendablePoints: wallet.points.spendablePoints,
    pointsShortfall: entitlement.refundPending ? total : preview.plan.shortfall,
    allocation: entitlement.refundPending ? { planLots: [], addonPoints: 0 } : preview.allocation,
    balanceAfter: entitlement.refundPending
      ? {
          planPoints: preview.lots
            .filter((l) => l.kind === "plan")
            .reduce((n, l) => n + l.availableQty, 0),
          addonPoints: preview.lots
            .filter((l) => l.kind === "addon")
            .reduce((n, l) => n + l.availableQty, 0),
        }
      : preview.balanceAfter,
    channelAccounts: await Promise.all(
      available.map(async (a) => ({
        channelAccountId: a.id,
        platform: a.platform,
        accountName: a.accountName,
        accountUid: a.accountUid,
        accountType: a.accountType,
        status: a.status,
        abnormalReason: a.abnormalReasonCode
          ? (await dictRefs(tx, "reject_reason", [a.abnormalReasonCode]))[0]
          : null,
        isSelectable: a.status === "available",
      })),
    ),
    ads: [],
    earliestLaunchDate: await earliestLaunch(tx, at),
    agreement: {
      agreementKey: "custom_license",
      name: (await tx.agreement.findUniqueOrThrow({ where: { key: "custom_license" } })).name,
      agreementVersionId: agreement.id,
      versionLabel: `v${agreement.major}.${agreement.minor}`,
    },
    blockers,
    expect: {
      totalChargePoints: total,
      items: items.map((i) => ({ dramaId: i.drama.dramaId, chargePoints: i.chargePoints })),
    },
  });
}
