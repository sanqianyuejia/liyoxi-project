// W2-04 全部10接口经过生产鉴权/权限/幂等/限流中间件；只用隔离库、假密钥和Provider。
import { runSeed, security, staff, uuidv7 } from "@liyoxi/services";
import {
  createFactories,
  createRedisOutage,
  fakeAuthKeys,
  signInAsStaff,
  totpNow,
  TEST_KEYRING,
} from "@liyoxi/services/testing";
import type { SignedInStaff } from "@liyoxi/services/testing";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { HANDLERS } from "../src/routes/index.js";
import { useTestApi } from "../src/testing/index.js";
import type { TestApi } from "../src/testing/index.js";

const OPERATIONS = [
  "admin.auditLog.get",
  "admin.auditLog.list",
  "admin.auth.bindWecom",
  "admin.auth.changePassword",
  "admin.auth.me.confirmTotp",
  "admin.auth.me.enrollTotp",
  "admin.piiReveal.create",
  "admin.role.defaults.get",
  "admin.role.get",
  "admin.role.replace",
];
const h = useTestApi();
let app: TestApi, prisma: Awaited<ReturnType<typeof h.db.prisma>>;
const PASSWORD = "A-password-204-original";
const AUTH_KEYS = fakeAuthKeys();
// 固定假盐预生成的合规口令夹具；凭据验证仍走真实登录用例。
const PASSWORD_HASH =
  "scrypt$16384$8$1$ICAgICAgICAgICAgICAgIA==$OCaVVfkRNtleZP6QXDh8pzoxGfwSYFQusy66uIX6c4KASwmMby1auACei1bQVtqPvLJGB11shP20Rx22MOZlSQ==";
beforeAll(async () => {
  app = await h.start();
  prisma = await h.db.prisma();
  await runSeed({ tx: app.runtime.tx, clock: app.clock });
}, 120_000);
async function signed(
  api = app,
  roleKey: "super_admin" | "cs" | "editor" | "delivery_manager" = "super_admin",
) {
  const secret = "JBSWY3DPEHPK3PXP";
  const who = await signInAsStaff(prisma, {
    roleKey,
    now: api.clock.now(),
    staff: {
      passwordHash: PASSWORD_HASH,
      totpSecretEnc: security.sealMfaSecret(AUTH_KEYS, "staff.totp_secret_enc", secret),
      totpEnrolledAt: api.clock.now(),
    },
  });
  return { ...who, secret };
}
const request = (
  who: SignedInStaff,
  path: string,
  method = "GET",
  json?: unknown,
  key = uuidv7(),
  api = app,
) =>
  api.request(`/api/v1/admin${path}`, {
    method,
    headers: { ...who.headers, "Idempotency-Key": key },
    ...(json === undefined ? {} : { json }),
  });
async function data<T>(response: Response): Promise<T> {
  expect(response.status).toBe(200);
  return ((await response.json()) as { data: T }).data;
}
async function error(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(await response.json()).toMatchObject({ error: code });
}
const pii = (id: string) => ({
  subjectType: "staff",
  subjectId: id,
  field: "phone",
  purpose: "verify_identity",
});

describe("W2-04 生产 HTTP 链", () => {
  it.each(["submittedFields", "reviewedFields"] as const)(
    "资质JSON格式异常：%s 的真实HTTP错误日志无明文，access已独立提交",
    async (field) => {
      const who = await signed();
      const make = createFactories({ db: prisma, clock: app.clock });
      const store = await make.store();
      const entity = await prisma.entity.findUniqueOrThrow({ where: { id: store.entityId } });
      const file = await make.fileObject({
        bucket: "secure",
        category: "kyc_license",
        scopeType: "entity",
        entityId: store.entityId,
      });
      const round = await prisma.qualificationSubmission.create({
        data: {
          id: uuidv7(),
          entityId: store.entityId,
          storeId: store.id,
          kind: "initial",
          createdByUserId: entity.createdByUserId!,
          createdAt: app.clock.now(),
          updatedAt: app.clock.now(),
        },
      });
      const marker = field === "submittedFields" ? "PII204S" : "PII204R";
      const column =
        field === "submittedFields"
          ? "qualification_doc.submitted_fields_enc"
          : "qualification_doc.reviewed_fields_enc";
      const encrypted = security.encryptField(TEST_KEYRING, column, marker);
      expect(security.openField(TEST_KEYRING, column, encrypted)).toBe(marker);
      const doc = await prisma.qualificationDoc.create({
        data: {
          id: uuidv7(),
          entityId: store.entityId,
          storeId: store.id,
          qualificationSubmissionId: round.id,
          fileId: file.id,
          docType: "business_license",
          scope: "entity",
          origin: "uploaded",
          uploadedByUserId: entity.createdByUserId!,
          [field === "submittedFields" ? "submittedFieldsEnc" : "reviewedFieldsEnc"]: encrypted,
          createdAt: app.clock.now(),
          updatedAt: app.clock.now(),
        },
      });
      const logStart = app.logs.length;
      const response = await request(who, "/pii-reveals", "POST", {
        subjectType: "qualification_doc",
        subjectId: doc.id,
        field,
        purpose: "verify_identity",
      });
      expect(response.status).toBe(500);
      const body = await response.text();
      expect(JSON.parse(body)).toMatchObject({ error: "INTERNAL" });
      expect(body).not.toContain(marker);
      // 支架db.prisma与runtime的事务连接独立：HTTP结束后确实可见已提交access。
      const audits = await prisma.auditLog.findMany({
        where: { stream: "access", targetId: doc.id },
      });
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        category: "pii_reveal",
        action: `pii.${field === "submittedFields" ? "submitted_fields" : "reviewed_fields"}.reveal`,
      });
      const errorLogs = app.logs.slice(logStart).filter((log) => log.evt === "http.error");
      expect(errorLogs).toHaveLength(1);
      expect(errorLogs[0]).toMatchObject({ error: "INTERNAL" });
      console.error("W2-04 资质JSON错误边界", {
        field,
        status: response.status,
        auditLogId: audits[0]!.id,
        errorLog: errorLogs[0],
      });
      expect(JSON.stringify(app.logs.slice(logStart))).not.toContain(marker);
    },
  );
  it("PII access提交前真实TX故障，HTTP500无明文、无残留审计；可重试成功", async () => {
    const who = await signed();
    const original = app.runtime.tx.run.bind(app.runtime.tx);
    const failure = vi.spyOn(app.runtime.tx, "run").mockImplementationOnce((fn, options) =>
      original(async (tx) => {
        await fn(tx);
        throw new Error("本地注入：access提交前故障");
      }, options),
    );
    const response = await request(who, "/pii-reveals", "POST", pii(who.staff.id));
    expect(response.status).toBe(500);
    const phone = security.openField(TEST_KEYRING, "staff.phone_enc", who.staff.phoneEnc);
    expect(await response.text()).not.toContain(phone);
    expect(
      await prisma.auditLog.count({ where: { stream: "access", targetId: who.staff.id } }),
    ).toBe(0);
    expect(JSON.stringify(app.logs)).not.toContain(phone);
    failure.mockRestore();
    expect((await request(who, "/pii-reveals", "POST", pii(who.staff.id))).status).toBe(200);
  });
  it("10条路由实际挂载；角色get/defaults/replace校验、版本冲突和锁定；旧角色拒绝", async () => {
    for (const operationId of OPERATIONS)
      expect(HANDLERS.some((entry) => entry.route.operationId === operationId)).toBe(true);
    const who = await signed();
    const current = await data<{ roleKey: string; lockVersion: number }>(
      await request(who, "/roles/editor"),
    );
    const defaults = await data<Record<string, unknown>>(
      await request(who, "/roles/editor/defaults"),
    );
    const { roleKey: _, ...config } = defaults;
    const body = { ...config, lockVersion: current.lockVersion };
    const key = uuidv7();
    expect(await data(await request(who, "/roles/editor", "PUT", body, key))).toMatchObject({
      lockVersion: current.lockVersion + 1,
    });
    expect(await data(await request(who, "/roles/editor", "PUT", body, key))).toMatchObject({
      lockVersion: current.lockVersion + 1,
    });
    await error(await request(who, "/roles/editor", "PUT", body), 409, "VERSION_CONFLICT");
    const superConfig = await data<Record<string, unknown>>(
      await request(who, "/roles/super_admin/defaults"),
    );
    const { roleKey: __, ...lockedConfig } = superConfig;
    await error(
      await request(who, "/roles/super_admin", "PUT", { ...lockedConfig, lockVersion: 0 }),
      409,
      "ROLE_LOCKED",
    );
    await error(await request(who, "/roles/missing"), 404, "NOT_FOUND");
    await error(
      await request(await signed(app, "editor"), "/roles/editor"),
      403,
      "PERMISSION_DENIED",
    );
  });
  it("本人改密保留当前会话、吊销另一会话，同键重放一次审计；旧密码登录拒绝", async () => {
    const who = await signed();
    const old = await prisma.staffSession.findUniqueOrThrow({ where: { id: who.sessionId } });
    const token = staff.newSessionToken();
    await prisma.staffSession.create({
      data: {
        ...old,
        id: uuidv7(),
        tokenHash: staff.sessionTokenHash(token) as Buffer<ArrayBuffer>,
      },
    });
    const body = { currentPassword: PASSWORD, newPassword: "A-new-password-204-http" },
      key = uuidv7();
    const response = await request(who, "/auth/change-password", "POST", body, key);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await data(response)).toBeNull();
    expect(await data(await request(who, "/auth/change-password", "POST", body, key))).toBeNull();
    expect((await request(who, "/auth/me")).status).toBe(200);
    await error(
      await app.request("/api/v1/admin/auth/me", {
        headers: { cookie: `${staff.staffCookieNames("test").session}=${token}` },
      }),
      401,
      "SESSION_INVALID",
    );
    expect(
      await prisma.staffSession.count({ where: { staffId: who.staff.id, revokedAt: null } }),
    ).toBe(1);
    const row = await prisma.staff.findUniqueOrThrow({ where: { id: who.staff.id } });
    const phone = security.openField(TEST_KEYRING, "staff.phone_enc", row.phoneEnc);
    await error(
      await request(who, "/auth/login", "POST", { phone, password: PASSWORD }),
      401,
      "AUTH_FAILED",
    );
    expect(
      await data(await request(who, "/auth/login", "POST", { phone, password: body.newPassword })),
    ).toMatchObject({ next: "mfa" });
    expect(
      await prisma.auditLog.count({
        where: { targetId: row.id, action: "sys.staff.password_change" },
      }),
    ).toBe(1);
  });
  it("本人TOTP pending 15分钟、旧密钥保留；确认当前会话保留且恢复码重放/库均无明文", async () => {
    const who = await signed();
    const response = await request(who, "/auth/me/enroll-totp", "POST");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const pending = await data<{ secret: string; pendingExpiresAt: string }>(response);
    expect(pending.pendingExpiresAt).toBe(
      new Date(app.clock.now().getTime() + 900_000).toISOString(),
    );
    const before = await prisma.staff.findUniqueOrThrow({ where: { id: who.staff.id } });
    expect(security.openMfaSecret(AUTH_KEYS, "staff.totp_secret_enc", before.totpSecretEnc!)).toBe(
      who.secret,
    );
    const key = uuidv7(),
      body = { code: totpNow(pending.secret, app.clock) };
    const result = await data<{ recoveryCodes: string[] }>(
      await request(who, "/auth/me/confirm-totp", "POST", body, key),
    );
    expect(result.recoveryCodes).toHaveLength(10);
    expect(
      await data(await request(who, "/auth/me/confirm-totp", "POST", body, key)),
    ).toMatchObject({ recoveryCodes: null, replayed: true });
    const stored = await prisma.idempotencyRecord.findFirstOrThrow({ where: { key } });
    for (const code of result.recoveryCodes)
      expect(JSON.stringify(stored.result)).not.toContain(code);
    expect((await request(who, "/auth/me")).status).toBe(200);
    const expired = await signed();
    const pending2 = await data<{ secret: string }>(
      await request(expired, "/auth/me/enroll-totp", "POST"),
    );
    app.clock.advance(900_000);
    await prisma.staffSession.update({
      where: { id: expired.sessionId },
      data: { stepupAt: app.clock.now() },
    });
    await error(
      await request(expired, "/auth/me/confirm-totp", "POST", {
        code: totpNow(pending2.secret, app.clock),
      }),
      409,
      "STATE_NOT_ALLOWED",
    );
  });
  it("默认手填绑定真实写入；启用扫码未配置、超时均无绑定事实，三段式幂等可重试", async () => {
    const who = await signed();
    expect(
      await data(await request(who, "/auth/bind-wecom", "POST", { wecomUserid: "manual-http204" })),
    ).toMatchObject({ status: "bound", userid: "manual-http204" });
    await error(
      await request(who, "/auth/bind-wecom", "POST", { code: "code204" }),
      403,
      "FEATURE_DISABLED",
    );
    const flags = vi.spyOn(app.runtime.config.flags, "value").mockResolvedValue(true);
    const provider = vi.spyOn(app.runtime.providers.wecom, "exchangeWebLoginCode");
    const key = uuidv7();
    for (const reason of ["unconfigured", "unavailable"] as const) {
      provider.mockResolvedValueOnce({ ok: false, reason, message: "本地替身故障" });
      await error(
        await request(who, "/auth/bind-wecom", "POST", { code: "same-code204" }, key),
        503,
        "PROVIDER_UNAVAILABLE",
      );
      expect(await prisma.idempotencyRecord.count({ where: { key } })).toBe(0);
      expect(
        (await prisma.staff.findUniqueOrThrow({ where: { id: who.staff.id } })).wecomUserid,
      ).toBe("manual-http204");
    }
    provider.mockResolvedValueOnce({ ok: true, value: { userid: "scan-http204" } });
    expect(
      await data(await request(who, "/auth/bind-wecom", "POST", { code: "same-code204" }, key)),
    ).toMatchObject({ userid: "scan-http204" });
    expect(
      await data(await request(who, "/auth/bind-wecom", "POST", { code: "same-code204" }, key)),
    ).toMatchObject({ userid: "scan-http204" });
    expect(provider).toHaveBeenCalledTimes(3);
    provider.mockRestore();
    flags.mockRestore();
  });
  it("字段权限、无幂等明文、access审计与脱敏get/list；越权access详情404", async () => {
    const who = await signed(),
      cs = await signed(app, "cs"),
      editor = await signed(app, "editor");
    await error(
      await request(editor, "/pii-reveals", "POST", pii(who.staff.id)),
      403,
      "PERMISSION_DENIED",
    );
    await error(
      await request(who, "/pii-reveals", "POST", { ...pii(who.staff.id), field: "bankAccount" }),
      400,
      "VALIDATION_FAILED",
    );
    const key = uuidv7(),
      response = await request(who, "/pii-reveals", "POST", pii(who.staff.id), key);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const revealed = await data<{ value: string; auditLogId: string }>(response);
    expect(revealed.value).toMatch(/^139\d{8}$/);
    expect(await prisma.idempotencyRecord.count({ where: { key } })).toBe(0);
    const list = await data<{ items: { auditLogId: string }[] }>(
      await request(who, "/audit-logs?stream=access&targetId=" + who.staff.id),
    );
    expect(list.items.map((v) => v.auditLogId)).toContain(revealed.auditLogId);
    const detail = await data(await request(who, "/audit-logs/" + revealed.auditLogId));
    expect(JSON.stringify(detail)).not.toContain(revealed.value);
    await error(await request(cs, "/audit-logs?stream=access"), 403, "PERMISSION_DENIED");
    await error(await request(cs, "/audit-logs/" + revealed.auditLogId), 404, "NOT_FOUND");
    await error(
      await request(who, "/pii-reveals", "POST", {
        subjectType: "agreement_consent",
        subjectId: uuidv7(),
        field: "phone",
        purpose: "verify_identity",
      }),
      404,
      "NOT_FOUND",
    );
    app.clock.advance(600_001);
    await error(
      await request(who, "/pii-reveals", "POST", {
        subjectType: "agreement_consent",
        subjectId: uuidv7(),
        field: "phone",
        purpose: "verify_identity",
      }),
      403,
      "STEP_UP_REQUIRED",
    );
  });
  it("PII真实hour/day限额详情、员工维度告警接口；global-only不误报", async () => {
    for (const [window, windowSec] of [
      ["hour", 3600],
      ["day", 86400],
    ] as const) {
      const api = await h.start({
        handlers: HANDLERS.filter((v) => v.route.operationId === "admin.piiReveal.create"),
        rateLimitQuotas: {
          "admin.global": [{ by: "session", limit: 100, windowSec: 60 }],
          "admin.pii_reveal": [{ by: "user", limit: 1, windowSec }],
        },
      });
      const who = await signed(api),
        alert = vi.spyOn(api.runtime.piiReveal, "raiseLimit");
      expect(
        (await request(who, "/pii-reveals", "POST", pii(who.staff.id), uuidv7(), api)).status,
      ).toBe(200);
      const blocked = await request(who, "/pii-reveals", "POST", pii(who.staff.id), uuidv7(), api);
      expect(blocked.status).toBe(429);
      expect(blocked.headers.get("Retry-After")).toMatch(/^[1-9]\d*$/);
      expect(await blocked.json()).toMatchObject({
        error: "RATE_LIMITED",
        details: { window, limit: 1 },
      });
      expect(alert).toHaveBeenCalledWith(who.staff.id, window, 1);
      alert.mockRestore();
    }
    const api = await h.start({
      handlers: HANDLERS.filter((v) => v.route.operationId === "admin.piiReveal.create"),
      rateLimitQuotas: {
        "admin.global": [{ by: "session", limit: 1, windowSec: 60 }],
        "admin.pii_reveal": [{ by: "user", limit: 100, windowSec: 3600 }],
      },
    });
    const who = await signed(api),
      alert = vi.spyOn(api.runtime.piiReveal, "raiseLimit");
    await request(who, "/pii-reveals", "POST", pii(who.staff.id), uuidv7(), api);
    const blocked = await request(who, "/pii-reveals", "POST", pii(who.staff.id), uuidv7(), api);
    expect(await blocked.json()).toMatchObject({ error: "RATE_LIMITED" });
    expect(alert).not.toHaveBeenCalled();
    alert.mockRestore();
  });
  it("Redis故障PII降级实际限额减半，429详情与Retry-After保留", async () => {
    const outage = await createRedisOutage();
    try {
      await outage.down();
      const api = await h.start({
        handlers: HANDLERS.filter((v) => v.route.operationId === "admin.piiReveal.create"),
        redisUrl: outage.url,
        rateLimitQuotas: {
          "admin.global": [{ by: "session", limit: 100, windowSec: 60 }],
          "admin.pii_reveal": [{ by: "user", limit: 2, windowSec: 3600 }],
        },
      });
      const who = await signed(api);
      expect(
        (await request(who, "/pii-reveals", "POST", pii(who.staff.id), uuidv7(), api)).status,
      ).toBe(200);
      const blocked = await request(who, "/pii-reveals", "POST", pii(who.staff.id), uuidv7(), api);
      expect(blocked.status).toBe(429);
      expect(blocked.headers.get("Retry-After")).toBe("3600");
      expect(await blocked.json()).toMatchObject({
        error: "RATE_LIMITED",
        details: { window: "hour", limit: 1 },
      });
    } finally {
      await outage.close();
    }
  }, 30_000);
});
