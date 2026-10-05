// 给 profile 的三个写函数（W1-03；任务书 第 10 节第 2 项；02 分组 第 2.9、2.10 节）。都在调用方的事务里。
//
//   setStoreQualification  资质 initial 轮次的提交、通过、驳回、撤回：门店与主体两条链同事务各迁移一次、各写一行状态历史。
//                          通过时主体的名称、信用代码等认证字段由调用方传入，与状态同一条 UPDATE 写。
//                          出站事件（store.qualification.*）由 profile 发，这里两次迁移都是从属迁移。
//   setStoreName           首店起名（提交资质之前）。已提交过的门店改名走变更重审，随 M2 的 tenant.renameStore。
//   setDeliveryManager     改门店的交付经理并写审计。
//
// 加锁：主体（100）→ 门店（130）。调用方（profile）在这之前锁的资质轮次（65）次序更小，不冲突。
// change、new_store 两种轮次随 M2。
import { record as recordAudit } from "../audit/index.js";
import type { AuditRequestMeta } from "../audit/index.js";
import type { Flow, MergedAudit } from "../flow/index.js";
import { AppError, lockRows } from "../kernel/index.js";
import type { IdentityContext, Tx } from "../kernel/index.js";
import type {
  QualificationArgs,
  QualificationRejection,
  VerifiedEntityFields,
} from "./machines.js";
import { selectStateBeforePending } from "./repo.js";

export const QUALIFICATION_ACTIONS = ["submit", "approve", "reject", "withdraw"] as const;
export type QualificationAction = (typeof QUALIFICATION_ACTIONS)[number];

export interface StoreQualificationInput {
  readonly storeId: string;
  /** 只做含主体营业执照的那一轮；别的轮次随 M2 */
  readonly round: "initial";
  readonly action: QualificationAction;
  /** approve 必给：写进主体的认证字段 */
  readonly verified?: VerifiedEntityFields;
  /** reject 必给：原因至少一项、说明必填 */
  readonly rejection?: QualificationRejection;
  /** 随审批单联动时：两次迁移并入审批单那一行审计，不另写。不给即各补一条 activity 行 */
  readonly audit?: MergedAudit;
}

export interface StoreQualificationResult {
  readonly storeId: string;
  readonly entityId: string;
  /** 两条链各自迁移前后的状态 */
  readonly store: { readonly from: string | null; readonly to: string };
  readonly entity: { readonly from: string | null; readonly to: string };
}

/** 由 profile 发的主事件：两条链上的迁移都是它的从属迁移 */
const PRIMARY_EVENT: Readonly<Record<QualificationAction, string>> = {
  submit: "store.qualification.submitted",
  approve: "store.qualification.approved",
  reject: "store.qualification.rejected",
  withdraw: "store.qualification.withdrawn",
};

const metaOf = (ctx: IdentityContext): AuditRequestMeta => ({
  requestId: ctx.requestId,
  ip: ctx.ip,
  userAgent: ctx.userAgent,
  authMethod: null,
  sessionId: null,
});

/** 锁主体再锁门店，返回锁住之后的门店行；门店不存在即 NOT_FOUND */
async function lockStore(tx: Tx, storeId: string, withEntity: boolean) {
  const found = await tx.store.findUnique({ where: { id: storeId }, select: { entityId: true } });
  if (found === null) throw new AppError("NOT_FOUND");
  if (withEntity) await lockRows(tx, "entity", [found.entityId], "update");
  await lockRows(tx, "store", [storeId], "update");
  return tx.store.findUniqueOrThrow({
    where: { id: storeId },
    select: {
      id: true,
      entityId: true,
      name: true,
      isPrimary: true,
      qualificationStatus: true,
      deliveryManagerId: true,
    },
  });
}

export async function setStoreQualification(
  tx: Tx,
  deps: { flow: Flow },
  now: Date,
  ctx: IdentityContext,
  input: StoreQualificationInput,
): Promise<StoreQualificationResult> {
  const { storeId, action } = input;
  const store = await lockStore(tx, storeId, true);
  const entityId = store.entityId;
  const event = `qualification.${action}`;
  const refuse = (reason: string): never => {
    throw new AppError("STATE_NOT_ALLOWED", {
      details: {
        machine: "store",
        stateField: "qualification_status",
        state: store.qualificationStatus,
        event,
        reason,
      },
    });
  };
  // initial 轮次只发生在首家门店上：主体的结论随它变
  if (!store.isPrimary) refuse("not_initial_round");
  // 服务层先断言；库里的 ck_store_name_required 兜底
  if (action === "submit" && store.name === null) refuse("store_name_required");

  const args: QualificationArgs = {
    ...(input.verified === undefined ? {} : { verified: input.verified }),
    ...(input.rejection === undefined ? {} : { rejection: input.rejection }),
  };
  const shared = {
    event,
    entityId,
    args,
    reasonCode: input.rejection?.reasonCodes[0] ?? null,
    note: input.rejection?.note ?? null,
    payload:
      input.rejection === undefined
        ? { round: input.round }
        : { round: input.round, reasonCodes: [...input.rejection.reasonCodes] },
    ...(input.audit === undefined ? {} : { audit: input.audit }),
    emit: { none: true, primary: PRIMARY_EVENT[action] },
  } as const;
  /** 撤回回到提交前的值：这条链最近一次进入 pending 之前的状态 */
  const revertTo = async (machine: "store" | "entity", stateField: string, id: string) =>
    action === "withdraw"
      ? { to: (await selectStateBeforePending(tx, machine, stateField, id)) ?? "unsubmitted" }
      : {};

  const onStore = await deps.flow.transition(tx, ctx, {
    ...shared,
    machine: "store",
    stateField: "qualification_status",
    id: storeId,
    storeId,
    ...(await revertTo("store", "qualification_status", storeId)),
  });
  const verified = action === "approve" ? input.verified : undefined;
  const onEntity = await deps.flow.transition(tx, ctx, {
    ...shared,
    machine: "entity",
    stateField: "verification_status",
    id: entityId,
    storeId: null,
    ...(await revertTo("entity", "verification_status", entityId)),
    // 认证字段与状态同一条 UPDATE：ck_entity_verified_fields 是逐语句查的
    ...(verified === undefined
      ? {}
      : {
          set: {
            name: verified.name,
            entity_type: verified.entityType,
            uscc_enc: verified.usccEnc,
            uscc_bidx: verified.usccBidx,
            uscc_mask: verified.usccMask,
            legal_rep_name_enc: verified.legalRepNameEnc,
            legal_rep_name_mask: verified.legalRepNameMask,
            verified_at: now,
          },
        }),
  });
  return {
    storeId,
    entityId,
    store: { from: onStore.from, to: onStore.to },
    entity: { from: onEntity.from, to: onEntity.to },
  };
}

export const STORE_NAME_MIN = 2;
export const STORE_NAME_MAX = 30;

/** 首店起名：只在资质还没提交（或被驳回待重交）时可改 */
export async function setStoreName(
  tx: Tx,
  now: Date,
  ctx: IdentityContext,
  input: { storeId: string; name: string },
): Promise<{ storeId: string; name: string }> {
  const name = input.name.trim();
  const length = [...name].length;
  if (length < STORE_NAME_MIN || length > STORE_NAME_MAX) {
    throw new AppError("VALIDATION_FAILED", {
      message: `门店名称为 ${STORE_NAME_MIN} 至 ${STORE_NAME_MAX} 个字`,
    });
  }
  const store = await lockStore(tx, input.storeId, false);
  if (store.qualificationStatus !== "unsubmitted" && store.qualificationStatus !== "rejected") {
    throw new AppError("STATE_NOT_ALLOWED", {
      details: {
        machine: "store",
        stateField: "qualification_status",
        state: store.qualificationStatus,
        reason: "rename_needs_review",
      },
    });
  }
  if (store.name === name) return { storeId: store.id, name };
  await tx.store.update({ where: { id: store.id }, data: { name, updatedAt: now } });
  await recordAudit(tx, ctx.actor, metaOf(ctx), {
    stream: "activity",
    category: "profile_edit",
    action: "tenant.store.rename",
    summary: store.name === null ? "设置门店名称" : "修改门店名称",
    target: { type: "store", id: store.id, label: name },
    entityId: store.entityId,
    storeId: store.id,
    before: { name: store.name },
    after: { name },
    fields: ["name"],
  });
  return { storeId: store.id, name };
}

/** 改门店的交付经理（null = 取消指派，回到待分配）；没变就不写。员工存在与否由外键把关 */
export async function setDeliveryManager(
  tx: Tx,
  now: Date,
  ctx: IdentityContext,
  input: { storeId: string; staffId: string | null },
): Promise<{ storeId: string; previousStaffId: string | null; staffId: string | null }> {
  const store = await lockStore(tx, input.storeId, false);
  const previousStaffId = store.deliveryManagerId;
  if (previousStaffId === input.staffId) {
    return { storeId: store.id, previousStaffId, staffId: input.staffId };
  }
  await tx.store.update({
    where: { id: store.id },
    data: { deliveryManagerId: input.staffId, updatedAt: now },
  });
  await recordAudit(tx, ctx.actor, metaOf(ctx), {
    stream: "ops",
    category: "manager_assign",
    action: "tenant.store.assign_manager",
    summary: input.staffId === null ? "取消门店的交付经理" : "指派门店的交付经理",
    target: { type: "store", id: store.id, label: store.name },
    entityId: store.entityId,
    storeId: store.id,
    before: { deliveryManagerId: previousStaffId },
    after: { deliveryManagerId: input.staffId },
    fields: ["deliveryManagerId"],
  });
  return { storeId: store.id, previousStaffId, staffId: input.staffId };
}
