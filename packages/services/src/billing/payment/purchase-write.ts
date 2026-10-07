import { createHash, randomBytes } from "node:crypto";
import type {
  PaymentOrderCreateBody,
  TransferProofConfirmBody,
  TransferProofRejectBody,
} from "@liyoxi/contract";
import type { BillingOrder } from "@liyoxi/db";
import type { IdentityContext, Tx } from "../../kernel/index.js";
import { AppError, lockRows, uuidv7, isUniqueViolation } from "../../kernel/index.js";
import { assertPermission } from "../../authz/index.js";
import type { StaffContext } from "../../authz/index.js";
import { record } from "../../audit/index.js";
import { maskName } from "@liyoxi/shared/mask";
import { paramsAt } from "../../config/index.js";
import { workHoursAt } from "../../sla/index.js";
import { quotePlan } from "../catalog/index.js";
import { financeConfigAt } from "../finance-config/index.js";
import { getPurchasePolicy } from "../policy/index.js";
import type { PurchaseClient } from "../policy/index.js";
import {
  dictRef,
  merchantOrderView,
  orderInScope,
  proofInScope,
  proofDetailView,
} from "./purchase-read.js";
import type { BillingPurchaseDeps, PurchaseActor } from "./purchase-context.js";

function owner(actor: PurchaseActor) {
  if (
    actor.ctx.actor.type !== "merchant" ||
    actor.ctx.actor.id === null ||
    actor.membership.role !== "owner" ||
    actor.ctx.actor.role !== "owner" ||
    actor.ctx.entityId !== actor.membership.entityId
  )
    throw new AppError("ROLE_FORBIDDEN");
}
async function validOwner(tx: Tx, deps: BillingPurchaseDeps, actor: PurchaseActor) {
  owner(actor);
  const current = await deps.tenant.resolveMembership(tx, {
    merchantUserId: actor.ctx.actor.id!,
    storeId: actor.membership.storeId,
  });
  if (current?.role !== "owner" || current.entityId !== actor.membership.entityId)
    throw new AppError("NOT_FOUND");
}
export async function armTransferTtl(
  tx: Tx,
  deps: Pick<BillingPurchaseDeps, "timers">,
  o: { id: string; entityId: string; storeId: string | null; expiresAt: Date },
) {
  await deps.timers.arm(tx, {
    kind: "po.transfer_ttl",
    subject: { type: "billing_order", id: o.id },
    fireAt: o.expiresAt,
    key: `po.transfer_ttl:billing_order:${o.id}:${o.expiresAt.getTime()}`,
    entityId: o.entityId,
    ...(o.storeId ? { storeId: o.storeId } : {}),
    payload: { expiresAt: o.expiresAt.toISOString() },
  });
}
async function consents(
  tx: Tx,
  deps: BillingPurchaseDeps,
  actor: PurchaseActor,
  order: { id: string; orderNo: string },
  versions: readonly string[],
) {
  const selected = await tx.agreementVersion.findMany({
    where: { id: { in: [...versions] } },
    select: { agreementKey: true },
  });
  const current = await deps.docs.currentVersions(tx);
  for (const agreementKey of ["member", "points"]) {
    if (!selected.some((v) => v.agreementKey === agreementKey))
      throw new AppError("AGREEMENT_VERSION_STALE", {
        details: { agreementKey, currentAgreementVersionId: current.get(agreementKey)?.id ?? null },
      });
  }
  const user = await tx.merchantUser.findUniqueOrThrow({
      where: { id: actor.ctx.actor.id! },
      select: { phoneEnc: true, phoneMask: true, displayName: true },
    }),
    entity = await tx.entity.findUniqueOrThrow({
      where: { id: actor.membership.entityId },
      select: { name: true, usccEnc: true, usccMask: true },
    });
  await deps.docs.recordTransactionConsents(tx, actor.ctx, {
    scene: "plan_purchase",
    method: "by_action",
    consents: versions.map((agreementVersionId) => ({ agreementVersionId })),
    signer: {
      merchantUserId: actor.ctx.actor.id!,
      phoneEnc: user.phoneEnc!,
      phoneMask: user.phoneMask!,
      operatorNameMask: user.displayName ? maskName(user.displayName) : null,
      role: "owner",
      appid: null,
      openidHmac: null,
    },
    entity: {
      entityId: actor.membership.entityId,
      entityName: entity.name,
      usccEnc: entity.usccEnc,
      usccMask: entity.usccMask,
      storeId: actor.membership.storeId,
    },
    biz: { type: "billing_order", id: order.id, no: order.orderNo },
  });
}
export async function createOrder(
  tx: Tx,
  deps: BillingPurchaseDeps,
  actor: PurchaseActor,
  client: PurchaseClient,
  input: PaymentOrderCreateBody,
) {
  owner(actor);
  await lockRows(tx, "entity", [actor.membership.entityId]);
  await validOwner(tx, deps, actor);
  const entity = await tx.entity.findUniqueOrThrow({ where: { id: actor.membership.entityId } });
  if (!["verified", "pending"].includes(entity.verificationStatus))
    throw new AppError("PURCHASE_QUALIFICATION_REQUIRED", {
      details: { verificationStatus: entity.verificationStatus },
    });
  if (input.pointPackId || !input.planId) throw new AppError("STATE_NOT_ALLOWED");
  const open = await tx.billingOrder.findFirst({
    where: {
      entityId: entity.id,
      type: { in: ["plan_new", "plan_renew", "plan_upgrade"] },
      status: { in: ["pending_payment", "pending_confirmation"] },
    },
  });
  if (open) await lockRows(tx, "billing_order", [open.id]);
  const clock = await deps.ledger.lockAccount(tx, entity.id),
    now = clock.now;
  const { quote, content } = await quotePlan(
    tx,
    entity.id,
    now,
    {
      planId: input.planId,
      ...(input.months === undefined ? {} : { months: input.months }),
      ...(input.intent === undefined ? {} : { intent: input.intent }),
    },
    (type, amount) => getPurchasePolicy(tx, deps.config, entity.id, now, client, type, amount),
  );
  if (quote.payFen !== input.expectAmountFen)
    throw new AppError("QUOTE_CHANGED", {
      details: { kind: "plan", amountFen: quote.payFen, quote },
    });
  if (!quote.policy.channels.find((c) => c.code === input.channel)?.isEnabled)
    throw new AppError("CHANNEL_NOT_ALLOWED", { details: { channels: quote.policy.channels } });
  const quoteHash = createHash("sha256")
    .update(JSON.stringify({ ...content, quotedAt: undefined }))
    .digest("hex");
  if (open) {
    if (open.quoteHash !== quoteHash || open.channel !== input.channel)
      throw new AppError("OPEN_ORDER_EXISTS", {
        details: { paymentOrderId: open.id, orderNo: open.orderNo },
      });
    if (open.expiresAt.getTime() - now.getTime() <= 300_000)
      throw new AppError("OPEN_ORDER_EXPIRING", {
        details: {
          paymentOrderId: open.id,
          orderNo: open.orderNo,
          expiresAt: open.expiresAt.toISOString(),
        },
      });
    await consents(tx, deps, actor, open, input.agreementVersionIds);
    return { ...(await merchantOrderView(tx, deps, open, client)), replayed: false };
  }
  const finance = await financeConfigAt(tx, now);
  if (!finance.bank)
    throw new AppError("CHANNEL_NOT_ALLOWED", { details: { channels: quote.policy.channels } });
  const params = await paramsAt(tx, ["billing.payment.transfer_valid_days"], now),
    id = uuidv7(),
    orderNo = await deps.bizNo.next(tx, "FK"),
    expiresAt = new Date(
      now.getTime() + params["billing.payment.transfer_valid_days"] * 86_400_000,
    );
  await consents(tx, deps, actor, { id, orderNo }, input.agreementVersionIds);
  const order = await tx.billingOrder.create({
    data: {
      id,
      orderNo,
      entityId: entity.id,
      storeId: actor.membership.storeId,
      type: "plan_new",
      status: "pending_payment",
      channel: "bank_transfer",
      source: "weapp",
      contentSnapshot: content,
      formulaCode: quote.formula.code,
      formulaArgs: quote.formula.args,
      quoteHash,
      amountFen: quote.payFen,
      expiresAt,
      transferState: "awaiting_proof",
      bankAccountFinanceConfigRevisionId: finance.bank.id,
      clientPlatform: client.platform,
      clientVersion: client.appVersion ?? null,
      placedByUserId: actor.ctx.actor.id,
      createdAt: now,
      updatedAt: now,
    },
  });
  await deps.flow.transition(tx, actor.ctx, {
    machine: "billing_order",
    stateField: "status",
    id,
    event: "billing_order.create",
    ref: "08:162",
    created: true,
    args: { validated: true },
    audit: {
      stream: "activity",
      category: "payment",
      action: "billing.order.create",
      summary: "创建对公付款单",
      target: { type: "billing_order", id },
      meta: { collectionRevisionId: finance.bank.id },
    },
    emit: {
      type: "billing_order.created",
      payload: {
        v: 1,
        billingOrderId: id,
        entityId: entity.id,
        storeId: order.storeId,
        orderType: "plan_new",
        channel: "bank_transfer",
        amountFen: quote.payFen,
      },
      dedupeKey: `billing_order.created:${id}`,
    },
  });
  await armTransferTtl(tx, deps, order);
  return { ...(await merchantOrderView(tx, deps, order, client)), replayed: false };
}
export async function submitProof(
  tx: Tx,
  deps: BillingPurchaseDeps,
  actor: PurchaseActor,
  client: PurchaseClient,
  id: string,
  fileId: string,
) {
  owner(actor);
  await lockRows(tx, "billing_order", [id]);
  const order = await tx.billingOrder.findFirst({
    where: { id, entityId: actor.membership.entityId },
  });
  if (!order) throw new AppError("NOT_FOUND");
  await validOwner(tx, deps, actor);
  const now = deps.clock.now();
  if (order.transferState === "confirm_review") throw new AppError("TRANSFER_PROOF_LOCKED");
  if (
    order.channel !== "bank_transfer" ||
    !(
      (order.status === "pending_payment" &&
        ["awaiting_proof", "proof_rejected"].includes(order.transferState ?? "")) ||
      (order.status === "pending_confirmation" && order.transferState === "proof_submitted")
    )
  )
    throw new AppError("STATE_NOT_ALLOWED");
  if (order.status === "pending_payment" && now >= order.expiresAt)
    throw new AppError("PAYMENT_ORDER_EXPIRED", {
      details: { expiresAt: order.expiresAt.toISOString() },
    });
  const old = await tx.transferProof.findFirst({
    where: { billingOrderId: id, reviewStatus: "pending" },
  });
  if (old) await lockRows(tx, "transfer_proof", [old.id]);
  await lockRows(tx, "file_object", [fileId]);
  const file = await tx.fileObject.findUnique({ where: { id: fileId } });
  if (
    !file ||
    file.uploadActorType !== "merchant" ||
    file.uploadActorId !== actor.ctx.actor.id ||
    file.scopeType !== "entity" ||
    file.entityId !== order.entityId
  )
    throw new AppError("FILE_NOT_USABLE", {
      details: { fileIds: [fileId], reason: "scope_mismatch" },
    });
  const params = await paramsAt(tx, ["sla.review.transfer_proof"], now),
    policy = params["sla.review.transfer_proof"];
  const due = policy
    ? await deps.sla.dueAt(tx, {
        policy: "review.transfer_proof",
        ...policy,
        from: now,
        workHours: await workHoursAt(tx, now),
      })
    : null;
  if (old)
    await tx.transferProof.update({
      where: { id: old.id },
      data: { reviewStatus: "superseded", lockVersion: { increment: 1 }, updatedAt: now },
    });
  const last = await tx.transferProof.aggregate({
      where: { billingOrderId: id },
      _max: { uploadNo: true },
    }),
    proofId = uuidv7();
  await tx.transferProof.create({
    data: {
      id: proofId,
      entityId: order.entityId,
      billingOrderId: id,
      uploadNo: (last._max.uploadNo ?? 0) + 1,
      fileId,
      uploadedByUserId: actor.ctx.actor.id,
      uploadedAt: now,
      reviewStatus: "pending",
      dueAt: due?.dueAt ?? null,
      ...(due ? { slaSnapshot: { ...due.snapshot } } : {}),
      createdAt: now,
      updatedAt: now,
    },
  });
  await deps.media.link(tx, {
    fileId,
    refType: "transfer_proof",
    refId: proofId,
    role: "main",
    entityId: order.entityId,
    storeId: null,
  });
  const payload = {
    v: 1 as const,
    transferProofId: proofId,
    billingOrderId: id,
    entityId: order.entityId,
    dueAt: due?.dueAt.toISOString() ?? null,
  };
  if (order.status === "pending_payment")
    await deps.flow.transition(tx, actor.ctx, {
      machine: "billing_order",
      stateField: "status",
      id,
      event: "billing_order.submit_proof",
      set: { transfer_state: "proof_submitted" },
      args: { transferProofId: proofId },
      audit: {
        stream: "activity",
        category: "payment",
        action: "billing.transfer_proof.submit",
        summary: "提交对公凭证",
        target: { type: "transfer_proof", id: proofId },
      },
      emit: { none: true, primary: "transfer.proof_submitted" },
    });
  await deps.events.emit(tx, actor.ctx, {
    type: "transfer.proof_submitted",
    payload,
    aggregate: { type: "transfer_proof", id: proofId },
    dedupeKey: `transfer.proof_submitted:${proofId}`,
  });
  if (order.status !== "pending_payment") {
    await audit(tx, actor.ctx, "billing.transfer_proof.submit", proofId, "替换对公凭证");
  }
  return merchantOrderView(
    tx,
    deps,
    await tx.billingOrder.findUniqueOrThrow({ where: { id } }),
    client,
  );
}
export function normalizeBankSerial(raw: string) {
  return raw.normalize("NFKC").replace(/[\s-]/gu, "").toUpperCase();
}
async function audit(
  tx: Tx,
  ctx: IdentityContext,
  action:
    | "billing.transfer_proof.submit"
    | "billing.transfer_proof.confirm"
    | "billing.transfer_proof.reject",
  id: string,
  summary: string,
  meta?: Record<string, unknown>,
) {
  await record(
    tx,
    ctx.actor,
    {
      requestId: ctx.requestId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      authMethod: null,
      sessionId: null,
    },
    {
      stream: ctx.actor.type === "merchant" ? "activity" : "ops",
      category: "payment",
      action,
      summary,
      target: { type: "transfer_proof", id },
      ...(ctx.entityId
        ? { entityId: ctx.entityId, storeId: ctx.storeId }
        : { entityId: null, storeId: null }),
      ...(meta ? { meta } : {}),
    },
  );
}
async function serialConflicts(tx: Tx, serial: string, excludeId?: string) {
  return tx.paymentTxn.findMany({
    where: {
      channel: "bank_transfer",
      channelTxnNo: serial,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    include: { billingOrder: { select: { orderNo: true } } },
  });
}
async function checkSerial(
  tx: Tx,
  serial: string,
  input: TransferProofConfirmBody,
  excludeId?: string,
) {
  const conflicts = await serialConflicts(tx, serial, excludeId);
  if (!serial)
    throw new AppError("VALIDATION_FAILED", {
      details: { fieldErrors: [{ path: "bankSerialNo", message: "请填写有效银行流水号" }] },
    });
  if (input.payerBankCode) {
    const items = await tx.dictItem.findMany({
      where: { dictTypeKey: "bank", code: input.payerBankCode, isEnabled: true },
    });
    if (!items.length) throw new AppError("DICT_ITEM_DISABLED");
  }
  if (conflicts.length) {
    if (!input.payerBankCode || conflicts.some((c) => c.payerBank === input.payerBankCode))
      throw new AppError("BANK_SERIAL_DUPLICATE", {
        details: {
          conflicts: await Promise.all(
            conflicts.map(async (c) => ({
              ref: c.billingOrder?.orderNo ?? c.outTradeNo,
              payerBank: await dictRef(tx, "bank", c.payerBank),
            })),
          ),
        },
      });
    const expected = conflicts.map((c) => c.billingOrder?.orderNo ?? c.outTradeNo).sort(),
      actual = [...new Set(input.confirm.conflictOrderNos ?? [])].sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new AppError("CONFIRM_MISMATCH");
  } else if (input.confirm.conflictOrderNos?.length) throw new AppError("CONFIRM_MISMATCH");
}
async function assertConfirmation(
  tx: Tx,
  deps: BillingPurchaseDeps,
  ctx: IdentityContext,
  staff: StaffContext,
  order: BillingOrder,
  input: TransferProofConfirmBody,
) {
  assertPermission(staff, "finance.receipt.confirm", deps.clock.now());
  if (ctx.actor.type !== "staff" || ctx.actor.id !== staff.staff.id)
    throw new AppError("PERMISSION_DENIED");
  if (input.confirm.orderNo !== order.orderNo) throw new AppError("CONFIRM_MISMATCH");
  if (input.confirm.receivedAmountFen !== order.amountFen)
    throw new AppError("TRANSFER_AMOUNT_MISMATCH", { details: { amountFen: order.amountFen } });
  if (!input.confirmChecks.includes("bank_statement_checked"))
    throw new AppError("VALIDATION_FAILED");
  if (order.createdByStaffId === staff.staff.id) throw new AppError("CONFIRMER_IS_ORDER_CREATOR");
  const finance = await financeConfigAt(tx, deps.clock.now());
  if (
    finance.controls.receiptSecondReviewFen !== null &&
    order.amountFen >= finance.controls.receiptSecondReviewFen
  )
    throw new AppError("STATE_NOT_ALLOWED");
}
export async function confirmProof(
  tx: Tx,
  deps: BillingPurchaseDeps,
  ctx: IdentityContext,
  staff: StaffContext,
  id: string,
  input: TransferProofConfirmBody,
) {
  assertPermission(staff, "finance.receipt.confirm", deps.clock.now());
  const first = await proofInScope(tx, staff.scope, id);
  await lockRows(tx, "billing_order", [first.billingOrderId]);
  const order = await orderInScope(tx, staff.scope, first.billingOrderId),
    now = deps.clock.now();
  const before = await proofInScope(tx, staff.scope, id);
  if (before.lockVersion !== input.lockVersion)
    throw new AppError("VERSION_CONFLICT", { details: { lockVersion: before.lockVersion } });
  if (
    before.reviewStatus !== "pending" ||
    order.status !== "pending_confirmation" ||
    order.transferState !== "proof_submitted"
  )
    throw new AppError("STATE_NOT_ALLOWED");
  await assertConfirmation(tx, deps, ctx, staff, order, input);
  const serial = normalizeBankSerial(input.bankSerialNo);
  // 290 → 流水咨询锁 → 300 → 310 → 420。所有主体/付款行共享同一渠道与规范化流水键；
  // 首次冲突查询前取得，直到事务提交/回滚才释放，不用复合唯一索引替代冲突回显。
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`lyx:billing:transfer-confirm:bank_transfer:${serial}`}, 0))`;
  await checkSerial(tx, serial, input);
  const latest = await tx.paymentTxn.aggregate({
      where: { billingOrderId: order.id },
      _max: { attemptNo: true },
    }),
    attemptNo = (latest._max.attemptNo ?? 0) + 1,
    txnId = uuidv7();
  // 290 → 300 → 310：先插入本事务真实收款行并锁到它。守卫拒绝时整事务回滚，不留下成功交易。
  await tx.paymentTxn.create({
    data: {
      id: txnId,
      entityId: order.entityId,
      billingOrderId: order.id,
      channel: "bank_transfer",
      attemptNo,
      outTradeNo: `${order.orderNo}-${String(attemptNo).padStart(2, "0")}-${randomBytes(3).toString("hex").toUpperCase()}`,
      amountFen: order.amountFen,
      channelAmountFen: input.confirm.receivedAmountFen,
      channelPayerRef: (
        await tx.entity.findUniqueOrThrow({ where: { id: order.entityId }, select: { name: true } })
      ).name,
      status: "succeeded",
      channelTxnNo: serial,
      bankSerialRaw: input.bankSerialNo,
      payerBank: input.payerBankCode ?? null,
      channelSuccessAt: now,
      transferProofId: id,
      confirmedByStaffId: staff.staff.id,
      reconState: "matched",
      createdAt: now,
      updatedAt: now,
    },
  });
  await lockRows(tx, "payment_txn", [txnId]);
  await lockRows(tx, "transfer_proof", [id]);
  const proof = await proofInScope(tx, staff.scope, id);
  if (proof.lockVersion !== input.lockVersion)
    throw new AppError("VERSION_CONFLICT", { details: { lockVersion: proof.lockVersion } });
  if (
    proof.reviewStatus !== "pending" ||
    order.status !== "pending_confirmation" ||
    order.transferState !== "proof_submitted" ||
    order.channel !== "bank_transfer"
  )
    throw new AppError("STATE_NOT_ALLOWED");
  await assertConfirmation(
    tx,
    deps,
    ctx,
    staff,
    await orderInScope(tx, staff.scope, order.id),
    input,
  );
  await checkSerial(tx, serial, input, txnId);
  await tx.transferProof.update({
    where: { id },
    data: {
      reviewStatus: "accepted",
      reviewedByStaffId: staff.staff.id,
      reviewedAt: now,
      lockVersion: { increment: 1 },
      updatedAt: now,
    },
  });
  await deps.payment.applyPayment(tx, {
    paymentTxnId: txnId,
    ctx: { ...ctx, entityId: order.entityId, storeId: order.storeId },
  });
  await audit(
    tx,
    { ...ctx, entityId: order.entityId, storeId: order.storeId },
    "billing.transfer_proof.confirm",
    id,
    "确认到账",
    { confirm: input.confirm, confirmChecks: input.confirmChecks },
  );
  return {
    ...(await proofDetailView(
      tx,
      deps,
      await tx.transferProof.findUniqueOrThrow({ where: { id } }),
      staff,
    )),
    outcome: "paid" as const,
  };
}
export async function rejectProof(
  tx: Tx,
  deps: BillingPurchaseDeps,
  ctx: IdentityContext,
  staff: StaffContext,
  id: string,
  input: TransferProofRejectBody,
) {
  if (ctx.actor.type !== "staff" || ctx.actor.id !== staff.staff.id)
    throw new AppError("PERMISSION_DENIED");
  assertPermission(staff, "finance.receipt.reject", deps.clock.now());
  const first = await proofInScope(tx, staff.scope, id);
  await lockRows(tx, "billing_order", [first.billingOrderId]);
  await lockRows(tx, "transfer_proof", [id]);
  const proof = await proofInScope(tx, staff.scope, id),
    order = await orderInScope(tx, staff.scope, proof.billingOrderId),
    now = deps.clock.now();
  if (proof.lockVersion !== input.lockVersion)
    throw new AppError("VERSION_CONFLICT", { details: { lockVersion: proof.lockVersion } });
  if (
    proof.reviewStatus !== "pending" ||
    order.status !== "pending_confirmation" ||
    order.transferState !== "proof_submitted"
  )
    throw new AppError("STATE_NOT_ALLOWED");
  const reason = await tx.dictItem.findFirst({
    where: { dictTypeKey: "reject_reason", code: input.reasonCode, isEnabled: true },
  });
  if (!reason || (reason.ext as { scene?: string }).scene !== "transfer")
    throw new AppError("DICT_ITEM_DISABLED");
  if (!input.note.trim() || input.note.length > 200) throw new AppError("VALIDATION_FAILED");
  const params = await paramsAt(tx, ["billing.payment.transfer_valid_days"], now),
    expiresAt =
      order.type === "plan_upgrade"
        ? order.expiresAt
        : new Date(now.getTime() + params["billing.payment.transfer_valid_days"] * 86_400_000);
  await tx.transferProof.update({
    where: { id },
    data: {
      reviewStatus: "rejected",
      rejectReasonCode: input.reasonCode,
      rejectNote: input.note,
      reviewedByStaffId: staff.staff.id,
      reviewedAt: now,
      lockVersion: { increment: 1 },
      updatedAt: now,
    },
  });
  await deps.flow.transition(
    tx,
    { ...ctx, entityId: order.entityId, storeId: order.storeId },
    {
      machine: "billing_order",
      stateField: "status",
      id: order.id,
      event: "billing_order.reject_proof",
      set: { transfer_state: "proof_rejected", expires_at: expiresAt },
      args: { transferProofId: id },
      audit: {
        stream: "ops",
        category: "payment",
        action: "billing.transfer_proof.reject",
        summary: "驳回对公凭证",
        target: { type: "transfer_proof", id },
      },
      emit: { none: true, primary: "transfer.rejected" },
    },
  );
  await deps.events.emit(tx, ctx, {
    type: "transfer.rejected",
    payload: {
      v: 1,
      transferProofId: id,
      billingOrderId: order.id,
      entityId: order.entityId,
      reasonCodes: [input.reasonCode],
    },
    aggregate: { type: "transfer_proof", id },
    dedupeKey: `transfer.rejected:${id}`,
  });
  await armTransferTtl(tx, deps, { ...order, expiresAt });
  return proofDetailView(
    tx,
    deps,
    await tx.transferProof.findUniqueOrThrow({ where: { id } }),
    staff,
  );
}
export const isSerialConflict = (e: unknown) =>
  isUniqueViolation(e, ["uq_payment_txn_channel_txn_no"]);
