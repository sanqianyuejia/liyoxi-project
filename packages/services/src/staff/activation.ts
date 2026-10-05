// 激活四步（W1-01a；a01 第 3.3–3.6 节；D4 第 6.4 节；03 分组 第 2.4 节）：
//   1 activate      手机号 + 激活码 → set_password 票据（带激活码行的 id）
//   2 setPassword   写口令、激活码置已用 → 没绑过动态口令给 enroll_totp 票据；绑过的回 login，不发票据
//   3 enrollTotp    生成密钥（MFA 密钥加密，暂存在 totp_pending_*）→ 密钥明文只在这一次的结果里
//   4 confirmTotp   用暂存的密钥校验 → 转正、生成 10 个恢复码、建会话
// 全程要求员工是启用状态。第 2 步的分支堵一个降级口子：重置密码也发激活码，拿到它的人不能顺手重绑动态口令。
// 系统从不生成、也不发送可以长期使用的口令。
import { timingSafeEqual } from "node:crypto";

import { record as recordAudit } from "../audit/index.js";
import { AppError, createActor, uuidv7 } from "../kernel/index.js";
import type { Tx } from "../kernel/index.js";
import { openField, openMfaSecret, sealMfaSecret } from "../security/index.js";
import { activationCodeHash, generateActivationCode, generateRecoveryCodes } from "./codes.js";
import { completeSignIn, signedInOf } from "./login.js";
import { hashPassword, passwordViolations } from "./password.js";
import { findStaffByPhone, lockStaff } from "./repo.js";
import { issueTicket, readTicket } from "./ticket.js";
import { base32Decode, generateTotpSecret, matchTotpStep, otpauthUri } from "./totp.js";
import type { AuthNext, RequestMeta, SignedIn, StaffAuthContext } from "./types.js";

/** 激活码的有效期 */
export const ACTIVATION_TTL_MS = 24 * 60 * 60_000;
/** 激活码错满几次作废 */
export const ACTIVATION_MAX_ATTEMPTS = 5;

const ticketInvalid = (): AppError => new AppError("AUTH_TICKET_INVALID");

/** 审计行里操作人的角色名快照：在事务里现读（不走缓存，免得占第二条连接） */
const roleNameOf = async (tx: Tx, key: string): Promise<string | null> =>
  (await tx.staffRole.findUnique({ where: { key }, select: { name: true } }))?.name ?? null;

export interface IssuedActivation {
  readonly id: string;
  /** 激活码明文：只在这里出现一次，库里只有哈希 */
  readonly code: string;
  readonly expiresAt: Date;
}

/**
 * 给一名员工生成激活码：同一员工至多一个有效的码，旧的先作废。在调用方的事务里
 *（引导、新增、启用、重置密码、重置第二因子、重新生成激活码都调它）。
 */
export async function issueActivationCode(
  tx: Tx,
  input: {
    staffId: string;
    purpose: "activate" | "reset_password";
    delivery: "sms" | "manual";
    createdByStaffId: string | null;
    now: Date;
  },
): Promise<IssuedActivation> {
  const { now } = input;
  await tx.staffActivation.updateMany({
    where: { staffId: input.staffId, usedAt: null, revokedAt: null },
    data: { revokedAt: now, updatedAt: now },
  });
  const code = generateActivationCode();
  const expiresAt = new Date(now.getTime() + ACTIVATION_TTL_MS);
  const id = uuidv7();
  await tx.staffActivation.create({
    data: {
      id,
      staffId: input.staffId,
      purpose: input.purpose,
      codeHash: activationCodeHash(code) as Buffer<ArrayBuffer>,
      delivery: input.delivery,
      expiresAt,
      createdByStaffId: input.createdByStaffId,
      createdAt: now,
      updatedAt: now,
    },
  });
  return { id, code, expiresAt };
}

/** 第 1 步（admin.auth.activate）。失败一律 401 AUTH_FAILED，不区分原因；码错时次数加 1，满 5 次作废 */
export async function activate(
  ctx: StaffAuthContext,
  input: { phone: string; activationCode: string },
): Promise<AuthNext> {
  const now = ctx.clock.now();
  const staff = await findStaffByPhone(ctx.db, ctx.keyring, input.phone);
  const given = activationCodeHash(input.activationCode);
  const matched = await ctx.tx.run(async (handle) => {
    if (staff === null || staff.status !== "active") return null;
    // 锁住员工行：并发的几次错码逐个数，次数不丢
    await lockStaff(handle, staff.id);
    const live = await handle.staffActivation.findFirst({
      where: { staffId: staff.id, usedAt: null, revokedAt: null },
    });
    if (live === null || live.expiresAt.getTime() <= now.getTime()) return null;
    if (given !== null && timingSafeEqual(given, live.codeHash)) return live;
    const attempts = live.attempts + 1;
    await handle.staffActivation.update({
      where: { id: live.id },
      data: {
        attempts,
        revokedAt: attempts >= ACTIVATION_MAX_ATTEMPTS ? now : null,
        updatedAt: now,
      },
    });
    return null;
  });
  if (staff === null || matched === null) throw new AppError("AUTH_FAILED");
  const issued = issueTicket(ctx.authKeys, {
    staffId: staff.id,
    purpose: "set_password",
    now,
    activationId: matched.id,
  });
  return {
    next: "set_password",
    ticket: issued.ticket,
    ticketExpiresAt: issued.expiresAt,
    methods: [],
  };
}

/** 第 2 步（admin.auth.setPassword） */
export async function setPassword(
  ctx: StaffAuthContext,
  input: { ticket: string; newPassword: string; meta: RequestMeta },
): Promise<AuthNext> {
  const now = ctx.clock.now();
  const claims = readTicket(ctx.authKeys, input.ticket, "set_password", now);
  if (claims === null || claims.activationId === null) throw ticketInvalid();
  const activationId = claims.activationId;
  const account = await ctx.db.staff.findUnique({ where: { id: claims.staffId } });
  if (account === null) throw ticketInvalid();
  const phone = openField(ctx.keyring, "staff.phone_enc", account.phoneEnc);
  const rules = passwordViolations(input.newPassword, phone);
  if (rules.length > 0) throw new AppError("PASSWORD_POLICY_VIOLATED", { details: { rules } });
  // scrypt 在事务外算：几十毫秒的 CPU 不占着行锁
  const passwordHash = await hashPassword(input.newPassword);

  const enrolled = await ctx.tx.run(async (handle) => {
    const staff = await lockStaff(handle, claims.staffId);
    const activation = await handle.staffActivation.findUnique({ where: { id: activationId } });
    if (
      staff === null ||
      staff.status !== "active" ||
      activation === null ||
      activation.staffId !== staff.id ||
      activation.usedAt !== null ||
      activation.revokedAt !== null
    ) {
      throw ticketInvalid();
    }
    await handle.staff.update({
      where: { id: staff.id },
      data: { passwordHash, passwordChangedAt: now, updatedAt: now },
    });
    await handle.staffActivation.update({
      where: { id: activation.id },
      data: { usedAt: now, updatedAt: now },
    });
    await recordAudit(
      handle,
      createActor({ type: "staff", id: staff.id, client: "admin" }),
      {
        requestId: input.meta.requestId ?? null,
        ip: input.meta.ip,
        userAgent: input.meta.userAgent ?? null,
        authMethod: null,
        sessionId: null,
        actorName: staff.name,
        actorRole: await roleNameOf(handle, staff.staffRoleKey),
      },
      {
        stream: "ops",
        category: "account_security",
        action: "sys.staff.password_set",
        summary: `${staff.name} 设置了登录密码`,
        target: { type: "staff", id: staff.id, label: staff.name },
        meta: { purpose: activation.purpose },
      },
    );
    return staff.totpEnrolledAt !== null;
  });
  if (enrolled) return { next: "login", ticket: null, ticketExpiresAt: null, methods: [] };
  const issued = issueTicket(ctx.authKeys, {
    staffId: claims.staffId,
    purpose: "enroll_totp",
    now,
  });
  return {
    next: "enroll_totp",
    ticket: issued.ticket,
    ticketExpiresAt: issued.expiresAt,
    methods: [],
  };
}

export interface TotpEnrollment {
  /** 给验证器扫的地址；密钥明文只在这一次的结果里 */
  readonly otpauthUri: string;
  /** Base32 密钥，供无法扫码时手输 */
  readonly secret: string;
  /** 续期到 15 分钟的 enroll_totp 票据，确认时回传 */
  readonly ticket: string;
  readonly ticketExpiresAt: Date;
}

/** 第 3 步（admin.auth.enrollTotp）。重复调用覆盖上一次的待确认密钥；已绑定过的 409 */
export async function enrollTotp(
  ctx: StaffAuthContext,
  input: { ticket: string },
): Promise<TotpEnrollment> {
  const now = ctx.clock.now();
  const claims = readTicket(ctx.authKeys, input.ticket, "enroll_totp", now);
  if (claims === null) throw ticketInvalid();
  const secret = generateTotpSecret();
  const phoneMask = await ctx.tx.run(async (handle) => {
    const staff = await lockStaff(handle, claims.staffId);
    if (staff === null || staff.status !== "active") throw ticketInvalid();
    if (staff.totpEnrolledAt !== null) throw new AppError("TOTP_ALREADY_ENROLLED");
    await handle.staff.update({
      where: { id: staff.id },
      data: {
        totpPendingSecretEnc: sealMfaSecret(ctx.authKeys, "staff.totp_pending_secret_enc", secret),
        totpPendingAt: now,
        updatedAt: now,
      },
    });
    return staff.phoneMask;
  });
  const issued = issueTicket(ctx.authKeys, {
    staffId: claims.staffId,
    purpose: "enroll_totp",
    now,
  });
  return {
    otpauthUri: otpauthUri(secret, phoneMask),
    secret,
    ticket: issued.ticket,
    ticketExpiresAt: issued.expiresAt,
  };
}

/** 第 4 步（admin.auth.confirmTotp）：转正、生成恢复码、建会话。恢复码明文只出现这一次 */
export async function confirmTotp(
  ctx: StaffAuthContext,
  input: { ticket: string; code: string; meta: RequestMeta },
): Promise<SignedIn & { recoveryCodes: string[] }> {
  const now = ctx.clock.now();
  const claims = readTicket(ctx.authKeys, input.ticket, "enroll_totp", now);
  if (claims === null) throw ticketInvalid();
  const done = await ctx.tx.run(async (handle) => {
    const staff = await lockStaff(handle, claims.staffId);
    if (staff === null || staff.status !== "active") throw ticketInvalid();
    // 并发的两次确认：后到的看到已绑定
    if (staff.totpEnrolledAt !== null) throw new AppError("TOTP_ALREADY_ENROLLED");
    if (staff.totpPendingSecretEnc === null) throw ticketInvalid();
    const secret = openMfaSecret(
      ctx.authKeys,
      "staff.totp_pending_secret_enc",
      staff.totpPendingSecretEnc,
    );
    const step = matchTotpStep(base32Decode(secret), input.code, now);
    if (step === null) throw new AppError("MFA_CODE_INVALID");
    const recovery = generateRecoveryCodes();
    const created = await completeSignIn(handle, {
      staffId: staff.id,
      authMethod: "password+totp",
      meta: input.meta,
      now,
      set: {
        totpSecretEnc: sealMfaSecret(ctx.authKeys, "staff.totp_secret_enc", secret),
        totpEnrolledAt: now,
        totpPendingSecretEnc: null,
        totpPendingAt: null,
        totpLastStep: step,
        recoveryCodes: recovery.hashes,
      },
    });
    await recordAudit(
      handle,
      createActor({ type: "staff", id: staff.id, client: "admin" }),
      {
        requestId: input.meta.requestId ?? null,
        ip: input.meta.ip,
        userAgent: input.meta.userAgent ?? null,
        authMethod: "password+totp",
        sessionId: created.session.id,
        actorName: staff.name,
        actorRole: await roleNameOf(handle, staff.staffRoleKey),
      },
      {
        stream: "ops",
        category: "account_security",
        action: "sys.staff.totp_enrolled",
        summary: `${staff.name} 绑定了动态口令`,
        target: { type: "staff", id: staff.id, label: staff.name },
      },
    );
    return { created, recoveryCodes: recovery.codes };
  });
  return { ...(await signedInOf(ctx, done.created)), recoveryCodes: done.recoveryCodes };
}
