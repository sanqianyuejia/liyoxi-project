// 懒创建经营主体（W1-03；m02 第 3.1 节；02 分组 第 2.9–2.11 节）。一个事务里：
//   主体（— → active）、首家门店（— → active）、老板成员关系（— → active）各一行，三条迁移经 flow.transition()；
//   经端口建计费账户；发 entity.created、store.created 两条事件（老板成员关系的建立不另发）。
// 调用者已是老板：不新建，返回已有主体（isNew = false）；是别家的有效店员：409 ALREADY_IN_ENTITY。
// 加锁：先锁账号行（80），同一账号的并发请求在这里排队；新插入的三行别的事务看不见，不加锁；计费账户由端口的实现最后锁。
import type { AlreadyInEntityDetails, MembershipResult } from "@liyoxi/contract";

import type { Flow } from "../flow/index.js";
import { AppError, lockRows, uuidv7 } from "../kernel/index.js";
import type { IdentityContext, Tx } from "../kernel/index.js";
import type { CreateEntityArgs } from "./machines.js";
import type { BillingAccountOpener } from "./ports.js";
import { selectActiveMembership, selectClerkStoreName, selectEntryStoreId } from "./repo.js";

export interface CreateEntityDeps {
  readonly flow: Flow;
  readonly billingAccount: BillingAccountOpener;
}

/** 并发兜底认的那个唯一索引：V1.0 一个账号只属于一个主体 */
export const ONE_ENTITY_CONSTRAINT = "uq_entity_member_one_entity";

/** 调用者已有有效成员关系时的结果：老板返回已有主体，店员抛 ALREADY_IN_ENTITY；没有即 null */
export async function existingMembershipResult(
  tx: Tx,
  merchantUserId: string,
): Promise<MembershipResult | null> {
  const membership = await selectActiveMembership(tx, merchantUserId);
  if (membership === null) return null;
  if (membership.role !== "owner") {
    const details: AlreadyInEntityDetails = {
      storeName: await selectClerkStoreName(tx, membership.memberId),
    };
    throw new AppError("ALREADY_IN_ENTITY", { details });
  }
  const storeId = await selectEntryStoreId(tx, membership.entityId, membership.lastStoreId);
  if (storeId === null) throw new Error(`主体 ${membership.entityId} 没有首家门店（tenant.I27）`);
  return {
    entityId: membership.entityId,
    memberId: membership.memberId,
    role: "owner",
    storeId,
    isNew: false,
    abandonedEntityId: null,
  };
}

export async function createEntityIn(
  tx: Tx,
  deps: CreateEntityDeps,
  now: Date,
  ctx: IdentityContext,
): Promise<MembershipResult> {
  const { actor } = ctx;
  if (actor.type !== "merchant") throw new TypeError("建主体的操作人只能是商家用户");
  const merchantUserId = actor.id;

  const [locked] = await lockRows(tx, "merchant_user", [merchantUserId], "update");
  if (locked === undefined) throw new AppError("NOT_FOUND");
  const existing = await existingMembershipResult(tx, merchantUserId);
  if (existing !== null) return existing;

  // 来源四列从账号复制，之后不可改（trg_entity_immutable）
  const user = await tx.merchantUser.findUniqueOrThrow({
    where: { id: merchantUserId },
    select: {
      sourceType: true,
      sourceChannelCode: true,
      sourceInviteCode: true,
      sourceReferralCodeId: true,
    },
  });
  const [entityId, storeId, memberId] = [uuidv7(), uuidv7(), uuidv7()];
  const args: CreateEntityArgs = { merchantUserId };
  const stamps = { createdAt: now, updatedAt: now };

  await tx.entity.create({
    data: {
      id: entityId,
      lifecycle: "active",
      verificationStatus: "unsubmitted",
      ...user,
      createdByUserId: merchantUserId,
      ...stamps,
    },
  });
  await deps.flow.transition(tx, ctx, {
    machine: "entity",
    stateField: "lifecycle",
    id: entityId,
    event: "entity.create",
    created: true,
    entityId,
    storeId: null,
    args,
    emit: {
      type: "entity.created",
      payload: { v: 1, entityId, firstStoreId: storeId, ownerUserId: merchantUserId },
    },
  });

  // 首家门店：还没有名称，档案行不在这里建（profile 首次读写时补建）
  await tx.store.create({
    data: {
      id: storeId,
      entityId,
      isPrimary: true,
      lifecycle: "active",
      qualificationStatus: "unsubmitted",
      ...stamps,
    },
  });
  await deps.flow.transition(tx, ctx, {
    machine: "store",
    stateField: "lifecycle",
    id: storeId,
    event: "store.create",
    created: true,
    entityId,
    storeId,
    args,
    emit: { type: "store.created", payload: { v: 1, storeId, entityId, isFirstStore: true } },
  });

  await tx.entityMember.create({
    data: {
      id: memberId,
      entityId,
      merchantUserId,
      role: "owner",
      status: "active",
      lastStoreId: storeId,
      ...stamps,
    },
  });
  await deps.flow.transition(tx, ctx, {
    machine: "entity_member",
    stateField: "status",
    id: memberId,
    event: "entity_member.create_owner",
    ref: "02:690",
    created: true,
    entityId,
    storeId: null,
    args,
    // 从属迁移：老板成员关系的建立已由 entity.created 表达（载荷带 ownerUserId），不另发事件
    emit: { none: true, primary: "entity.created" },
  });

  // 计费账户排在加锁顺序的最后：锁完（建完）门店之后调
  await deps.billingAccount.ensureForEntity(tx, ctx, entityId);

  return { entityId, memberId, role: "owner", storeId, isNew: true, abandonedEntityId: null };
}
