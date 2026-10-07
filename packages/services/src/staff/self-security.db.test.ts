import type { PrismaClient } from "@liyoxi/db";
import { beforeAll, describe, expect, it } from "vitest";
import { createActor, createIdempotencyContext, isInTransaction, uuidv7 } from "../kernel/index.js";
import {
  createFakeProviders,
  createTestStaffAuth,
  totpNow,
  useSeededDatabase,
} from "../testing/index.js";
import type { TestStaffAuth } from "../testing/index.js";
import { failed } from "../providers/types.js";
import { openMfaSecret } from "../security/index.js";
import { META, PASSWORD, provisionStaff } from "./__fixtures__/staff.js";
import { createStaffSelfSecurity } from "./self-security.js";
import { verifyPassword } from "./password.js";

const db = useSeededDatabase("services");
let prisma: PrismaClient;
let t: TestStaffAuth;
beforeAll(async () => {
  prisma = await db.prisma();
  t = createTestStaffAuth(prisma);
}, 20_000);
async function signed() {
  const who = await provisionStaff(t, prisma);
  const first = await t.staff.login({ phone: who.phone, password: who.password, meta: META });
  const result = await t.staff.verifyMfa({
    ticket: first.ticket!,
    method: "totp",
    code: totpNow(who.secret, t.clock),
    meta: META,
  });
  return { who, principal: result.principal, token: result.sessionToken };
}
const deps = (enabled = false, wecom = createFakeProviders({ clock: t.clock }).wecom) => ({
  db: prisma,
  tx: t.tx,
  clock: t.clock,
  keyring: t.keyring,
  authKeys: t.authKeys,
  flags: { value: async () => enabled },
  wecom,
});
const idem = (
  staffId: string,
  scope: string,
  body: object,
  key = uuidv7(),
  redact: string[] = [],
) =>
  createIdempotencyContext({
    mode: "required",
    scope,
    actor: createActor({ type: "staff", id: staffId, client: "admin" }),
    key,
    request: { method: "POST", body },
    redact,
  });

describe("W2-04 本人安全真实链", () => {
  it("扫码外呼期间会话到期，settle重读拒绝且不写绑定或成功审计", async () => {
    const current = await signed();
    const fake = createFakeProviders({ clock: t.clock }).wecom;
    fake.setWebLoginCode("expiry204", "expiry-user204");
    await prisma.staffSession.update({
      where: { id: current.principal.session.id },
      data: { idleExpiresAt: new Date(t.clock.now().getTime() + 1_000) },
    });
    const service = createStaffSelfSecurity(
      deps(true, {
        ...fake,
        exchangeWebLoginCode: async (input) => {
          expect(isInTransaction()).toBe(false);
          const result = await fake.exchangeWebLoginCode(input);
          t.clock.advance(1_000);
          return result;
        },
      }),
    );
    await expect(
      service.bindWecom(current.principal, { code: "expiry204", meta: META }),
    ).rejects.toMatchObject({ error: "SESSION_INVALID" });
    expect(
      (await prisma.staff.findUniqueOrThrow({ where: { id: current.who.id } })).wecomUserid,
    ).toBeNull();
    expect(
      await prisma.auditLog.count({
        where: { targetId: current.who.id, action: "sys.staff.wecom_bind" },
      }),
    ).toBe(0);
  });
  it("改密吊销其他会话，当前会话保留，旧口令拒绝且同键重放不重复校验", async () => {
    const current = await signed();
    t.clock.advance(30_000);
    const first = await t.staff.login({ phone: current.who.phone, password: PASSWORD, meta: META });
    const other = await t.staff.verifyMfa({
      ticket: first.ticket!,
      method: "totp",
      code: totpNow(current.who.secret, t.clock),
      meta: META,
    });
    const input = { currentPassword: PASSWORD, newPassword: "A-new-password-204", meta: META };
    const key = uuidv7();
    await expect(
      createStaffSelfSecurity(deps()).changePassword(current.principal, input, {
        idem: idem(current.who.id, "password-test", input, key),
      }),
    ).resolves.toBeNull();
    await expect(
      createStaffSelfSecurity(deps()).changePassword(current.principal, input, {
        idem: idem(current.who.id, "password-test", input, key),
      }),
    ).resolves.toBeNull();
    await expect(t.staff.authenticate(current.token)).resolves.toBeDefined();
    await expect(t.staff.authenticate(other.sessionToken)).rejects.toMatchObject({
      error: "SESSION_INVALID",
    });
    const row = await prisma.staff.findUniqueOrThrow({ where: { id: current.who.id } });
    expect(await verifyPassword(PASSWORD, row.passwordHash!)).toBe(false);
    expect(await verifyPassword(input.newPassword, row.passwordHash!)).toBe(true);
    expect(
      await prisma.auditLog.count({
        where: { targetId: row.id, action: "sys.staff.password_change" },
      }),
    ).toBe(1);
  });
  it("错误当前口令连续五次独立落失败桶，同口令/弱口令拒绝", async () => {
    const current = await signed();
    const service = createStaffSelfSecurity(deps());
    for (let n = 0; n < 5; n++)
      await expect(
        service.changePassword(current.principal, {
          currentPassword: "bad",
          newPassword: "A-new-password-204",
          meta: META,
        }),
      ).rejects.toMatchObject({ error: "PASSWORD_INCORRECT" });
    expect(await prisma.staff.findUniqueOrThrow({ where: { id: current.who.id } })).toMatchObject({
      failUntrusted: 5,
      lockedUntilUntrusted: new Date(t.clock.now().getTime() + 900_000),
    });
    await expect(
      service.changePassword(current.principal, {
        currentPassword: PASSWORD,
        newPassword: PASSWORD,
        meta: META,
      }),
    ).rejects.toMatchObject({
      error: "PASSWORD_POLICY_VIOLATED",
      details: { rules: ["same_as_current"] },
    });
  });
  it("待确认新密钥不替换旧密钥，确认原子替换、恢复码仅首次且旧码作废", async () => {
    const current = await signed();
    t.clock.advance(30_000);
    const otherLogin = await t.staff.login({
      phone: current.who.phone,
      password: PASSWORD,
      meta: META,
    });
    const other = await t.staff.verifyMfa({
      ticket: otherLogin.ticket!,
      method: "totp",
      code: totpNow(current.who.secret, t.clock),
      meta: META,
    });
    const service = createStaffSelfSecurity(deps());
    const pending = await service.enrollTotp(current.principal);
    const before = await prisma.staff.findUniqueOrThrow({ where: { id: current.who.id } });
    expect(openMfaSecret(t.authKeys, "staff.totp_secret_enc", before.totpSecretEnc!)).toBe(
      current.who.secret,
    );
    expect(pending.pendingExpiresAt).toBe(
      new Date(t.clock.now().getTime() + 900_000).toISOString(),
    );
    const input = { code: totpNow(pending.secret, t.clock), meta: META };
    const key = uuidv7();
    const result = await service.confirmTotp(current.principal, input, {
      idem: idem(current.who.id, "totp-test", input, key, ["recoveryCodes"]),
    });
    expect(result.recoveryCodes).toHaveLength(10);
    const replay = await service.confirmTotp(current.principal, input, {
      idem: idem(current.who.id, "totp-test", input, key, ["recoveryCodes"]),
    });
    expect(replay).toEqual({ recoveryCodes: null, recoveryCodesLeft: 10, replayed: true });
    const after = await prisma.staff.findUniqueOrThrow({ where: { id: current.who.id } });
    expect(openMfaSecret(t.authKeys, "staff.totp_secret_enc", after.totpSecretEnc!)).toBe(
      pending.secret,
    );
    expect(after.recoveryCodes).not.toEqual(before.recoveryCodes);
    const stored = await prisma.idempotencyRecord.findFirstOrThrow({
      where: { scope: "totp-test", key },
    });
    expect(JSON.stringify(stored.result)).not.toContain(result.recoveryCodes![0]);
    await expect(t.staff.authenticate(current.token)).resolves.toBeDefined();
    await expect(t.staff.authenticate(other.sessionToken)).rejects.toMatchObject({
      error: "SESSION_INVALID",
    });
    t.clock.advance(30_000);
    for (const [method, code] of [
      ["totp", totpNow(current.who.secret, t.clock)],
      ["recovery", current.who.recoveryCodes[0]!],
    ] as const) {
      const first = await t.staff.login({
        phone: current.who.phone,
        password: PASSWORD,
        meta: META,
      });
      await expect(
        t.staff.verifyMfa({ ticket: first.ticket!, method, code, meta: META }),
      ).rejects.toMatchObject({ error: "AUTH_FAILED" });
    }
    const fresh = await t.staff.login({ phone: current.who.phone, password: PASSWORD, meta: META });
    await expect(
      t.staff.verifyMfa({
        ticket: fresh.ticket!,
        method: "totp",
        code: totpNow(pending.secret, t.clock),
        meta: META,
      }),
    ).resolves.toBeDefined();
  });
  it("活跃企业微信占用返回真实details，停用占用可移交且审计标明手填来源", async () => {
    const current = await signed(),
      active = await provisionStaff(t, prisma),
      inactive = await provisionStaff(t, prisma, { status: "disabled" });
    await prisma.staff.update({
      where: { id: active.id },
      data: {
        wecomUserid: "active-conflict204",
        wecomBindStatus: "bound",
        wecomBoundAt: t.clock.now(),
      },
    });
    await prisma.staff.update({
      where: { id: inactive.id },
      data: { wecomUserid: "inactive-transfer204", wecomBindStatus: "unbound" },
    });
    const service = createStaffSelfSecurity(deps());
    await expect(
      service.bindWecom(current.principal, { wecomUserid: "active-conflict204", meta: META }),
    ).rejects.toMatchObject({
      error: "WECOM_USERID_TAKEN",
      details: { staffId: active.id, name: active.row.name, status: "active" },
    });
    await service.bindWecom(current.principal, { wecomUserid: "inactive-transfer204", meta: META });
    expect(
      (await prisma.staff.findUniqueOrThrow({ where: { id: inactive.id } })).wecomUserid,
    ).toBeNull();
    expect(
      (await prisma.staff.findUniqueOrThrow({ where: { id: current.who.id } })).wecomUserid,
    ).toBe("inactive-transfer204");
    expect(
      await prisma.auditLog.findFirst({
        where: { targetId: current.who.id, action: "sys.staff.wecom_bind" },
      }),
    ).toMatchObject({ meta: { method: "manual", takeOverFromStaffId: inactive.id } });
  });
  it("pending在15分钟边界过期而非1小时，再验证过期不写新密钥", async () => {
    const current = await signed();
    const service = createStaffSelfSecurity(deps());
    const pending = await service.enrollTotp(current.principal);
    t.clock.advance(900_000);
    const refreshed = {
      ...current.principal,
      session: { ...current.principal.session, stepupAt: t.clock.now() },
    };
    await expect(
      service.confirmTotp(refreshed, { code: totpNow(pending.secret, t.clock), meta: META }),
    ).rejects.toMatchObject({
      error: "STATE_NOT_ALLOWED",
      details: { reason: "no_pending_secret" },
    });
    await expect(service.enrollTotp(current.principal)).rejects.toMatchObject({
      error: "STEP_UP_REQUIRED",
    });
  });
  it("手填不外呼，启用扫码未配置/失败不落绑定；替身成功外呼在事务外且只一次", async () => {
    const current = await signed();
    const fake = createFakeProviders({ clock: t.clock }).wecom;
    const manual = createStaffSelfSecurity(deps(false, fake));
    await expect(
      manual.bindWecom(current.principal, { code: "x", meta: META }),
    ).rejects.toMatchObject({ error: "FEATURE_DISABLED" });
    const result = await manual.bindWecom(current.principal, {
      wecomUserid: "staff204",
      meta: META,
    });
    expect(result.status).toBe("bound");
    expect(fake.calls).toHaveLength(0);
    const noConfig = createFakeProviders({ clock: t.clock }).wecom;
    noConfig.failNext("exchangeWebLoginCode", failed("unconfigured", "本地未配置"));
    const off = createStaffSelfSecurity(deps(true, noConfig));
    await expect(
      off.bindWecom(current.principal, { code: "unused", meta: META }),
    ).rejects.toMatchObject({ error: "PROVIDER_UNAVAILABLE" });
    fake.failNext("exchangeWebLoginCode", failed("unavailable", "本地超时"));
    await expect(
      createStaffSelfSecurity(deps(true, fake)).bindWecom(current.principal, {
        code: "unused",
        meta: META,
      }),
    ).rejects.toMatchObject({ error: "PROVIDER_UNAVAILABLE" });
    expect(
      (await prisma.staff.findUniqueOrThrow({ where: { id: current.who.id } })).wecomUserid,
    ).toBe("staff204");
    const guarded = createFakeProviders({
      clock: t.clock,
      beforeCall: () => {
        expect(isInTransaction()).toBe(false);
      },
    }).wecom;
    guarded.setWebLoginCode("scan204", "scan-user204");
    const input = { code: "scan204", meta: META };
    const key = uuidv7();
    const scan = createStaffSelfSecurity(deps(true, guarded));
    await scan.bindWecom(current.principal, input, {
      idem: idem(current.who.id, "scan-test", input, key),
    });
    await scan.bindWecom(current.principal, input, {
      idem: idem(current.who.id, "scan-test", input, key),
    });
    expect(guarded.calls.filter((call) => call.method === "exchangeWebLoginCode")).toHaveLength(1);
  });
});
