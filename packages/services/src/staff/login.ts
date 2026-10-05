// 登录两步与再验证（W1-01a；a01 第 3.1、3.2、3.7 节；D4 第 6.3 节）。
//   第一步的失败（账号不存在、未启用、待激活、桶锁定、密码错）一律 401 AUTH_FAILED、同一文案，每条路都恰好跑一次 scrypt。
//   锁定中密码正确也是 401。密码正确时不写库：第二步成功才清零。
//   第二步失败累加同一个桶；成功后两桶清零、建会话、下发设备 Cookie。
//   动态口令的时间步严格递增、恢复码用掉即移除：都在锁住员工行之后比对，并发的两次只成功一个。
import type { Prisma, Staff, StaffGroup, StaffSession } from "@liyoxi/db";

import { alertRepeatedStaffLocks, recordAuthEvent } from "../audit/index.js";
import type { AuthBucket } from "../audit/index.js";
import { AppError } from "../kernel/index.js";
import type { Tx } from "../kernel/index.js";
import { openMfaSecret } from "../security/index.js";
import type { AuthKeys } from "../security/index.js";
import { recoveryCodeHash, recoveryHashesOf } from "./codes.js";
import { bucketOf, CLEARED_BUCKETS, isLocked, recordFailure } from "./lockout.js";
import { burnPasswordCheck, verifyPassword } from "./password.js";
import { findStaffByPhone, lockStaff } from "./repo.js";
import { createSession, principalOf, STEP_UP_TTL_MS } from "./session.js";
import { deviceCookieMatches, issueDeviceCookie, issueTicket, readTicket } from "./ticket.js";
import { base32Decode, matchTotpStep } from "./totp.js";
import type {
  AuthNext,
  RequestMeta,
  SecondFactorMethod,
  SignedIn,
  StaffAuthContext,
  StaffPrincipal,
} from "./types.js";

const authFailed = (): AppError => new AppError("AUTH_FAILED");

/** 失败之后：桶刚被锁上且是陌生来源桶，就去数当天的次数，满 3 次经告警端口报出（不抛） */
async function afterFailure(
  ctx: StaffAuthContext,
  staffId: string,
  bucket: AuthBucket,
  outcome: { lockedNow: boolean },
  now: Date,
): Promise<void> {
  if (outcome.lockedNow && bucket === "untrusted") {
    await alertRepeatedStaffLocks(ctx.db, ctx.alerts, { staffId, now });
  }
}

export interface LoginInput {
  readonly phone: string;
  readonly password: string;
  /** 请求带来的设备 Cookie 的值；没有就不给 */
  readonly deviceCookie?: string | null;
  readonly meta: RequestMeta;
}

/** 登录第一步（admin.auth.login）：密码正确 → 已绑定动态口令给 mfa 票据，尚未绑定给 enroll_totp 票据 */
export async function login(ctx: StaffAuthContext, input: LoginInput): Promise<AuthNext> {
  const now = ctx.clock.now();
  const staff = await findStaffByPhone(ctx.db, ctx.keyring, input.phone);
  const bucket: AuthBucket =
    staff !== null && deviceCookieMatches(ctx.authKeys, input.deviceCookie, staff.id, now)
      ? "trusted"
      : "untrusted";
  const usable = staff !== null && staff.status === "active" && staff.passwordHash !== null;
  const locked = staff !== null && isLocked(bucketOf(staff, bucket), now);
  // 每条路恰好一次 scrypt：能校验的校验真哈希，其余白跑一次同参数的
  const correct =
    usable && !locked
      ? await verifyPassword(input.password, staff.passwordHash as string)
      : await burnPasswordCheck(input.password);
  if (staff !== null && correct) {
    const purpose = staff.totpEnrolledAt === null ? "enroll_totp" : "mfa";
    const issued = issueTicket(ctx.authKeys, { staffId: staff.id, purpose, now });
    return {
      next: purpose,
      ticket: issued.ticket,
      ticketExpiresAt: issued.expiresAt,
      methods: purpose === "mfa" ? ["totp", "recovery"] : [],
    };
  }

  // 失败：计数、锁定与事件写在独立的事务里。只有“密码错”计数：锁定中没校验过密码，不能算它错
  const reason =
    staff === null
      ? "unknown_account"
      : staff.status !== "active"
        ? "not_active"
        : staff.passwordHash === null
          ? "not_activated"
          : locked
            ? "bucket_locked"
            : "bad_password";
  const outcome = await ctx.tx.run(async (handle) => {
    const row =
      staff !== null && reason === "bad_password" ? await lockStaff(handle, staff.id) : null;
    if (row !== null) {
      return recordFailure(handle, row, {
        bucket,
        method: "password",
        reason,
        meta: input.meta,
        now,
      });
    }
    await recordAuthEvent(handle, {
      space: "staff",
      subjectId: staff?.id ?? null,
      event: "login_fail",
      method: "password",
      ip: input.meta.ip,
      userAgent: input.meta.userAgent ?? null,
      detail: { bucket, reason, requestId: input.meta.requestId ?? null },
      at: now,
    });
    return { lockedNow: false };
  });
  if (staff !== null) await afterFailure(ctx, staff.id, bucket, outcome, now);
  throw authFailed();
}

/**
 * 校验并消耗第二因子：动态口令对得上且时间步严格大于上一次的，或恢复码还在。返回要随之写进员工行的列；
 * 不过即 null。只在员工行已锁住之后调。
 */
export function consumeSecondFactor(
  keys: AuthKeys,
  staff: Staff,
  input: { method: SecondFactorMethod; code: string; now: Date },
): { totpLastStep: number } | { recoveryCodes: string[] } | null {
  if (staff.totpSecretEnc === null) return null;
  if (input.method === "totp") {
    const secret = base32Decode(openMfaSecret(keys, "staff.totp_secret_enc", staff.totpSecretEnc));
    const step = matchTotpStep(secret, input.code, input.now, staff.totpLastStep);
    return step === null ? null : { totpLastStep: step };
  }
  const hash = recoveryCodeHash(input.code);
  const stored = recoveryHashesOf(staff.recoveryCodes);
  if (hash === null || !stored.includes(hash)) return null;
  return { recoveryCodes: stored.filter((item) => item !== hash) };
}

/** 事务里建好的会话：员工行、会话行与令牌。出了事务再拼成 SignedIn */
export interface SessionCreated {
  readonly staff: Staff & { staffGroup: StaffGroup | null };
  readonly session: StaffSession;
  readonly token: string;
}

/** 建会话、清两个桶、记最近登录、写 login_success。完成登录的两个用例（第二步、确认绑定）共用，在它们的事务里调 */
export async function completeSignIn(
  tx: Tx,
  input: {
    staffId: string;
    authMethod: "password+totp" | "password+recovery";
    meta: RequestMeta;
    now: Date;
    /** 随同一条 UPDATE 写进员工行的其余列 */
    set: Prisma.StaffUncheckedUpdateInput;
  },
): Promise<SessionCreated> {
  const { now, meta } = input;
  const staff = await tx.staff.update({
    where: { id: input.staffId },
    data: {
      ...input.set,
      ...CLEARED_BUCKETS,
      lastLoginAt: now,
      lastLoginIp: meta.ip,
      updatedAt: now,
    },
    include: { staffGroup: true },
  });
  const { session, token } = await createSession(tx, {
    staffId: staff.id,
    authMethod: input.authMethod,
    meta,
    now,
  });
  await recordAuthEvent(tx, {
    space: "staff",
    subjectId: staff.id,
    event: "login_success",
    method: input.authMethod,
    ip: meta.ip,
    userAgent: meta.userAgent ?? null,
    detail: { sessionId: session.id, requestId: meta.requestId ?? null },
    at: now,
  });
  return { staff, session, token };
}

/** 事务提交之后：拼出已登录的员工（角色与本组成员走缓存，不占事务的连接），签发设备 Cookie */
export async function signedInOf(
  ctx: StaffAuthContext,
  created: SessionCreated,
): Promise<SignedIn> {
  return {
    principal: await principalOf(ctx, created.staff, created.session),
    sessionToken: created.token,
    deviceCookie: issueDeviceCookie(ctx.authKeys, created.staff.id, created.session.createdAt),
  };
}

export interface VerifyMfaInput {
  readonly ticket: string;
  readonly method: SecondFactorMethod;
  readonly code: string;
  readonly deviceCookie?: string | null;
  readonly meta: RequestMeta;
}

/** 登录第二步（admin.auth.verifyMfa）：票据、动态口令或恢复码都对 → 建会话 */
export async function verifyMfa(ctx: StaffAuthContext, input: VerifyMfaInput): Promise<SignedIn> {
  const now = ctx.clock.now();
  const claims = readTicket(ctx.authKeys, input.ticket, "mfa", now);
  if (claims === null) throw authFailed();
  const bucket: AuthBucket = deviceCookieMatches(
    ctx.authKeys,
    input.deviceCookie,
    claims.staffId,
    now,
  )
    ? "trusted"
    : "untrusted";
  const authMethod = input.method === "totp" ? "password+totp" : "password+recovery";

  const result = await ctx.tx.run(async (handle) => {
    const staff = await lockStaff(handle, claims.staffId);
    if (staff === null || staff.status !== "active")
      return { ok: false as const, lockedNow: false };
    const consumed = isLocked(bucketOf(staff, bucket), now)
      ? null
      : consumeSecondFactor(ctx.authKeys, staff, { method: input.method, code: input.code, now });
    if (consumed === null) {
      // 失败留痕要提交：不抛错，带着结果出事务
      const outcome = await recordFailure(handle, staff, {
        bucket,
        method: authMethod,
        reason: "bad_second_factor",
        meta: input.meta,
        now,
      });
      return { ok: false as const, ...outcome };
    }
    const created = await completeSignIn(handle, {
      staffId: staff.id,
      authMethod,
      meta: input.meta,
      now,
      set: consumed,
    });
    return { ok: true as const, created };
  });
  if (result.ok) return signedInOf(ctx, result.created);
  await afterFailure(ctx, claims.staffId, bucket, result, now);
  throw authFailed();
}

export interface StepUpInput {
  /** 当前会话：会话中间件校验出来的那一个 */
  readonly principal: Pick<StaffPrincipal, "staff" | "session">;
  readonly method: SecondFactorMethod;
  readonly code: string;
  readonly meta: RequestMeta;
}

/**
 * 再验证（admin.auth.stepUp）：动态口令或恢复码对 → 会话的 stepup_at = 现在。
 * 失败是 400 MFA_CODE_INVALID：不吊销会话，不计入登录失败桶（穷举由 admin.login 档的限流挡）。
 */
export async function stepUp(
  ctx: StaffAuthContext,
  input: StepUpInput,
): Promise<{ stepUpValidUntil: Date }> {
  const now = ctx.clock.now();
  const { staff: who, session } = input.principal;
  await ctx.tx.run(async (handle) => {
    const staff = await lockStaff(handle, who.id);
    if (staff === null || staff.status !== "active") throw new AppError("SESSION_INVALID");
    const consumed = consumeSecondFactor(ctx.authKeys, staff, {
      method: input.method,
      code: input.code,
      now,
    });
    if (consumed === null) throw new AppError("MFA_CODE_INVALID");
    await handle.staff.update({ where: { id: staff.id }, data: { ...consumed, updatedAt: now } });
    const touched = await handle.staffSession.updateMany({
      where: { id: session.id, staffId: staff.id, revokedAt: null },
      data: { stepupAt: now, updatedAt: now },
    });
    if (touched.count === 0) throw new AppError("SESSION_INVALID");
    await recordAuthEvent(handle, {
      space: "staff",
      subjectId: staff.id,
      event: "step_up",
      method: input.method,
      ip: input.meta.ip,
      userAgent: input.meta.userAgent ?? null,
      detail: { sessionId: session.id, requestId: input.meta.requestId ?? null },
      at: now,
    });
  });
  return { stepUpValidUntil: new Date(now.getTime() + STEP_UP_TTL_MS) };
}
