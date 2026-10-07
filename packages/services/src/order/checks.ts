// 报价与提交共用判定；报价收集业务拒绝，提交按同一顺序拒绝。
import { DramaSnapshotSchema } from "@liyoxi/contract";
import type { OrderCreateBody, DramaSnapshot } from "@liyoxi/contract";
import { calendarDate, addDays } from "@liyoxi/shared/time";
import { nthWorkdayAfter } from "@liyoxi/shared/workcal";
import { AppError } from "../kernel/index.js";
import type { Tx } from "../kernel/index.js";
import { assertProfileComplete, storeGate, industryOpen } from "../profile/index.js";
import { getEntitlements } from "../billing/index.js";
import { loadWorkCalendar, workHoursAt } from "../sla/index.js";
import type { OrderActor, OrderDeps } from "./context.js";
import { orderAccounts } from "./accounts.js";
export function owner(actor: OrderActor) {
  if (actor.membership.role !== "owner") throw new AppError("ROLE_FORBIDDEN");
}
export function invalid(path: string, message: string): never {
  throw new AppError("VALIDATION_FAILED", { details: { fieldErrors: [{ path, message }] } });
}
export async function earliestLaunch(tx: Tx, at: Date) {
  const today = calendarDate(at);
  return nthWorkdayAfter(
    await loadWorkCalendar(tx, { from: today, to: addDays(today, 180) }, await workHoursAt(tx, at)),
    today,
    7,
  ).date;
}
export async function qualification(tx: Tx, storeId: string) {
  const gate = await storeGate(tx, storeId);
  if (gate === "blocked") {
    const store = await tx.store.findUniqueOrThrow({ where: { id: storeId } });
    const last = await tx.qualificationSubmission.findFirst({
      where: { storeId },
      orderBy: { createdAt: "desc" },
      select: { finalRejectedAt: true },
    });
    throw new AppError("STORE_NOT_QUALIFIED", {
      details: {
        storeId,
        reason:
          store.qualificationStatus === "pending"
            ? "pending_review"
            : store.qualificationStatus === "rejected"
              ? last?.finalRejectedAt
                ? "final_rejected"
                : "rejected"
              : "not_submitted",
      },
    });
  }
  return gate;
}
export async function subscription(tx: Tx, entityId: string, at: Date) {
  const e = await getEntitlements(tx, entityId, at);
  if (!e.term || e.subStatus !== "active") throw new AppError("SUBSCRIPTION_INACTIVE");
  if (e.refundPending) throw new AppError("PLAN_REFUND_IN_PROGRESS");
  return e.term;
}
export async function openIndustry(tx: Tx, storeId: string) {
  if (!(await industryOpen(tx, storeId))) throw new AppError("INDUSTRY_NOT_OPEN");
}
export async function profileChecks(tx: Tx, actor: OrderActor) {
  await assertProfileComplete(tx, actor.membership.storeId);
  const gate = await qualification(tx, actor.membership.storeId);
  await openIndustry(tx, actor.membership.storeId);
  return gate;
}
export async function currentLicense(tx: Tx, deps: OrderDeps, versionId?: string) {
  // currentVersions 自己取真实时刻；hold 后调用它就是 Tv，不能用 Tf 替代。
  const current = (await deps.docs.currentVersions(tx)).get("custom_license");
  if (!current || (versionId !== undefined && current.id !== versionId))
    throw new AppError("AGREEMENT_VERSION_STALE", {
      details: { agreementKey: "custom_license", currentAgreementVersionId: current?.id ?? null },
    });
  return current;
}
export async function dramaSnapshots(
  tx: Tx,
  deps: OrderDeps,
  ids: readonly string[],
  platforms: readonly string[],
  at: Date,
) {
  const result = new Map<string, DramaSnapshot>();
  for (const id of ids) {
    try {
      result.set(
        id,
        DramaSnapshotSchema.parse(
          await deps.content.assertOrderable(tx, id, platforms, calendarDate(at)),
        ),
      );
    } catch (error) {
      if (error instanceof AppError && error.error === "NOT_FOUND")
        throw new AppError("DRAMA_NOT_ORDERABLE", {
          details: { dramaId: id, reason: "not_listed" },
        });
      throw error;
    }
  }
  return result;
}
export async function submitChecks(
  tx: Tx,
  deps: OrderDeps,
  actor: OrderActor,
  input: OrderCreateBody,
  at: Date,
) {
  const gate = await profileChecks(tx, actor);
  await subscription(tx, actor.membership.entityId, at);
  const accounts = await orderAccounts(tx, actor.membership.storeId, input.channelAccountIds);
  const snapshots = await dramaSnapshots(
    tx,
    deps,
    input.dramaIds,
    accounts.selected.map((a) => a.platform),
    at,
  );
  for (let i = 0; i < input.focusCodes.length; i++) {
    const found = await tx.dictItem.findUnique({
      where: { dictTypeKey_code: { dictTypeKey: "custom_focus", code: input.focusCodes[i]! } },
      select: { isEnabled: true },
    });
    if (!found?.isEnabled) invalid(`focusCodes.${i}`, "请选择启用的定制重点");
  }
  if (input.adIds?.length)
    throw new AppError("ORDER_AD_INVALID", {
      details: { adId: input.adIds[0], reason: "not_in_store" },
    });
  if (input.referenceStoreAssetIds?.length) invalid("referenceStoreAssetIds.0", "库里没有素材");
  const earliest = await earliestLaunch(tx, at);
  if (input.expectedLaunchDate && input.expectedLaunchDate < earliest)
    throw new AppError("LAUNCH_DATE_TOO_EARLY", { details: { earliestLaunchDate: earliest } });
  return { gate, accounts: accounts.selected, snapshots };
}
