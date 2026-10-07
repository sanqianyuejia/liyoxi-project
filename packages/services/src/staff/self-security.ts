// W2-04 本人安全用例；既有会话/再验证机制不变，凭据替换与其他会话吊销同事务。
import type { Staff, Prisma } from "@liyoxi/db";
import { record } from "../audit/index.js";
import { assertPermission } from "../authz/index.js";
import {
  AppError,
  createActor,
  createThreePhaseRunner,
  isUniqueViolation,
} from "../kernel/index.js";
import type { Tx, TxRunOptions } from "../kernel/index.js";
import type { Config } from "../config/index.js";
import type { WecomProvider } from "../providers/types.js";
import { openField, openMfaSecret, sealMfaSecret } from "../security/index.js";
import { generateRecoveryCodes } from "./codes.js";
import { recordFailure } from "./lockout.js";
import { staffContextOf } from "./me.js";
import { hashPassword, passwordViolations, verifyPassword } from "./password.js";
import { lockStaff } from "./repo.js";
import { revokeStaffSessions } from "./session.js";
import { base32Decode, generateTotpSecret, matchTotpStep, otpauthUri } from "./totp.js";
import type { RequestMeta, StaffAuthDeps, StaffPrincipal } from "./types.js";

export interface StaffSelfSecurityDeps extends Pick<
  StaffAuthDeps,
  "db" | "tx" | "clock" | "keyring" | "authKeys"
> {
  flags: Pick<Config["flags"], "value">;
  wecom: WecomProvider;
}
const PENDING_MS = 15 * 60_000;
async function currentStaff(tx: Tx, principal: StaffPrincipal, now: Date): Promise<Staff> {
  const row = await lockStaff(tx, principal.staff.id);
  const session = await tx.staffSession.findFirst({
    where: {
      id: principal.session.id,
      staffId: principal.staff.id,
      revokedAt: null,
      idleExpiresAt: { gt: now },
      absoluteExpiresAt: { gt: now },
    },
  });
  if (row === null || row.status !== "active" || session === null)
    throw new AppError("SESSION_INVALID");
  return row;
}
async function auditSelf(
  tx: Tx,
  principal: StaffPrincipal,
  meta: RequestMeta,
  action: "sys.staff.password_change" | "sys.staff.totp_rebound" | "sys.staff.wecom_bind",
  summary: string,
  change?: {
    before: object;
    after: object;
    fields: readonly string[];
    method: "manual" | "scan";
    takeover: string | null;
  },
) {
  return record(
    tx,
    createActor({ type: "staff", id: principal.staff.id, client: "admin" }),
    {
      requestId: meta.requestId ?? null,
      ip: meta.ip,
      userAgent: meta.userAgent ?? null,
      sessionId: principal.session.id,
      authMethod: principal.session.authMethod as "password+totp" | "password+recovery",
      actorName: principal.staff.name,
      actorRole: principal.role.name,
    },
    {
      entityId: null,
      stream: "ops",
      category: action === "sys.staff.wecom_bind" ? "staff_authz" : "account_security",
      action,
      summary,
      target: { type: "staff", id: principal.staff.id, label: principal.staff.name },
      before: change?.before ?? null,
      after: change?.after ?? null,
      fields: change?.fields ?? [],
      ...(change ? { meta: { method: change.method, takeOverFromStaffId: change.takeover } } : {}),
    },
  );
}

export function createStaffSelfSecurity(deps: StaffSelfSecurityDeps) {
  const threePhase = createThreePhaseRunner(deps);
  async function bind(
    tx: Tx,
    principal: StaffPrincipal,
    meta: RequestMeta,
    userid: string,
    method: "manual" | "scan",
  ) {
    // 两个员工的隐式写锁也按 id 排序；再读 userid 防止事务外定位已变化。
    const occupied = await tx.staff.findUnique({ where: { wecomUserid: userid } });
    for (const id of [...new Set([principal.staff.id, ...(occupied ? [occupied.id] : [])])].sort())
      await lockStaff(tx, id);
    const row = await currentStaff(tx, principal, deps.clock.now());
    const latest = await tx.staff.findUnique({ where: { wecomUserid: userid } });
    if (latest !== null && latest.id !== principal.staff.id) {
      if (latest.status === "active")
        throw new AppError("WECOM_USERID_TAKEN", {
          details: { staffId: latest.id, name: latest.name, status: latest.status },
        });
      if (latest.id !== occupied?.id) throw new AppError("BUSY");
      await tx.staff.update({
        where: { id: latest.id },
        data: {
          wecomUserid: null,
          ...(latest.wecomBindStatus === "bound" ? { wecomBindStatus: "unbound" } : {}),
          updatedAt: deps.clock.now(),
        },
      });
    }
    const now = deps.clock.now();
    const after = await tx.staff.update({
      where: { id: row.id },
      data: { wecomUserid: userid, wecomBindStatus: "bound", wecomBoundAt: now, updatedAt: now },
    });
    await auditSelf(tx, principal, meta, "sys.staff.wecom_bind", `${row.name}绑定企业微信账号`, {
      before: row,
      after,
      fields: ["wecomUserid", "wecomBindStatus"],
      method,
      takeover: latest !== null && latest.id !== row.id ? latest.id : null,
    });
    return {
      status: "bound" as const,
      userid,
      boundAt: now.toISOString(),
      qrFileId: after.wecomQrFileId,
      qrUrl: null,
    };
  }
  return {
    async changePassword(
      principal: StaffPrincipal,
      input: { currentPassword: string; newPassword: string; meta: RequestMeta },
      options: TxRunOptions = {},
    ): Promise<null> {
      try {
        // 幂等命中在任何旧凭据校验之前；scrypt 是本地计算，无外呼，持锁防并发改密。
        return await deps.tx.run(async (tx) => {
          const row = await currentStaff(tx, principal, deps.clock.now());
          if (row.passwordHash === null) throw new AppError("SESSION_INVALID");
          if (!(await verifyPassword(input.currentPassword, row.passwordHash)))
            throw new AppError("PASSWORD_INCORRECT");
          const rules: string[] = passwordViolations(
            input.newPassword,
            openField(deps.keyring, "staff.phone_enc", row.phoneEnc),
          );
          if (await verifyPassword(input.newPassword, row.passwordHash))
            rules.push("same_as_current");
          if (rules.length > 0)
            throw new AppError("PASSWORD_POLICY_VIOLATED", { details: { rules } });
          const passwordHash = await hashPassword(input.newPassword);
          const now = deps.clock.now();
          await tx.staff.update({
            where: { id: row.id },
            data: { passwordHash, passwordChangedAt: now, updatedAt: now },
          });
          await revokeStaffSessions(tx, {
            staffId: row.id,
            exceptSessionId: principal.session.id,
            reason: "password_reset",
            now,
          });
          await auditSelf(
            tx,
            principal,
            input.meta,
            "sys.staff.password_change",
            `${row.name}修改了登录密码`,
          );
          return null;
        }, options);
      } catch (error) {
        // 业务事务已回滚后独立累计错误口令，不能让失败计数随业务错误回滚。
        if (error instanceof AppError && error.error === "PASSWORD_INCORRECT")
          await deps.tx.run(async (tx) => {
            const row = await currentStaff(tx, principal, deps.clock.now());
            await recordFailure(tx, row, {
              bucket: "untrusted",
              method: "password",
              reason: "self_password_incorrect",
              meta: input.meta,
              now: deps.clock.now(),
            });
          });
        throw error;
      }
    },
    async enrollTotp(principal: StaffPrincipal) {
      assertPermission(staffContextOf(principal), "self.mfa.reset", deps.clock.now());
      const secret = generateTotpSecret();
      const now = deps.clock.now();
      const mask = await deps.tx.run(async (tx) => {
        const row = await currentStaff(tx, principal, deps.clock.now());
        await tx.staff.update({
          where: { id: row.id },
          data: {
            totpPendingSecretEnc: sealMfaSecret(
              deps.authKeys,
              "staff.totp_pending_secret_enc",
              secret,
            ),
            totpPendingAt: now,
            updatedAt: now,
          },
        });
        return row.phoneMask;
      });
      return {
        secret,
        otpauthUri: otpauthUri(secret, mask),
        pendingExpiresAt: new Date(now.getTime() + PENDING_MS).toISOString(),
      };
    },
    async confirmTotp(
      principal: StaffPrincipal,
      input: { code: string; meta: RequestMeta },
      options: TxRunOptions = {},
    ) {
      assertPermission(staffContextOf(principal), "self.mfa.reset", deps.clock.now());
      return deps.tx.run(async (tx) => {
        const row = await currentStaff(tx, principal, deps.clock.now());
        const now = deps.clock.now();
        if (
          row.totpPendingSecretEnc === null ||
          row.totpPendingAt === null ||
          row.totpPendingAt.getTime() + PENDING_MS <= now.getTime()
        )
          throw new AppError("STATE_NOT_ALLOWED", { details: { reason: "no_pending_secret" } });
        const secret = openMfaSecret(
          deps.authKeys,
          "staff.totp_pending_secret_enc",
          row.totpPendingSecretEnc,
        );
        const step = matchTotpStep(base32Decode(secret), input.code, now);
        if (step === null) throw new AppError("MFA_CODE_INVALID");
        const recovery = generateRecoveryCodes();
        await tx.staff.update({
          where: { id: row.id },
          data: {
            totpSecretEnc: sealMfaSecret(deps.authKeys, "staff.totp_secret_enc", secret),
            totpEnrolledAt: now,
            totpPendingAt: null,
            totpPendingSecretEnc: null,
            totpLastStep: step,
            recoveryCodes: recovery.hashes as Prisma.InputJsonArray,
            updatedAt: now,
          },
        });
        await revokeStaffSessions(tx, {
          staffId: row.id,
          exceptSessionId: principal.session.id,
          reason: "mfa_reset",
          now,
        });
        await tx.staffSession.update({
          where: { id: principal.session.id },
          data: { stepupAt: now, updatedAt: now },
        });
        await auditSelf(
          tx,
          principal,
          input.meta,
          "sys.staff.totp_rebound",
          `${row.name}重新绑定了动态口令`,
        );
        return {
          recoveryCodes: recovery.codes as string[] | null,
          recoveryCodesLeft: recovery.codes.length,
          replayed: false,
        };
      }, options);
    },
    async bindWecom(
      principal: StaffPrincipal,
      input: { wecomUserid?: string; code?: string; meta: RequestMeta },
      options: TxRunOptions = {},
    ) {
      const enabled = await deps.flags.value("admin.wecom_web_login.enabled", {
        platform: "admin",
      });
      let resolvedUserid = input.wecomUserid;
      if (input.code !== undefined && !enabled) throw new AppError("FEATURE_DISABLED");
      if (
        (input.code === undefined) === (input.wecomUserid === undefined) ||
        (enabled && input.wecomUserid !== undefined)
      )
        throw new AppError("VALIDATION_FAILED");
      try {
        if (!enabled)
          return await deps.tx.run(
            (tx) => bind(tx, principal, input.meta, input.wecomUserid!, "manual"),
            options,
          );
        return await threePhase.run(
          {
            external: async () => {
              const result = await deps.wecom.exchangeWebLoginCode({ code: input.code! });
              if (!result.ok)
                throw new AppError(
                  result.reason === "rejected" ? "WECOM_CODE_INVALID" : "PROVIDER_UNAVAILABLE",
                );
              resolvedUserid = result.value.userid;
              return result.value.userid;
            },
            settle: (tx, userid) => bind(tx, principal, input.meta, userid, "scan"),
          },
          options,
        );
      } catch (error) {
        if (isUniqueViolation(error, ["uq_staff_wecom_userid"])) {
          const occupied =
            resolvedUserid === undefined
              ? null
              : await deps.db.staff.findUnique({
                  where: { wecomUserid: resolvedUserid },
                  select: { id: true, name: true, status: true },
                });
          if (occupied !== null)
            throw new AppError("WECOM_USERID_TAKEN", {
              details: { staffId: occupied.id, name: occupied.name, status: occupied.status },
            });
          throw new AppError("BUSY");
        }
        throw error;
      }
    },
  };
}
