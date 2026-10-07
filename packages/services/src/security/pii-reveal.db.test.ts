import {
  PII_SUBJECT_FIELDS,
  PiiRevealBodySchema,
  defaultRoleActions,
  staffRoleDefault,
} from "@liyoxi/contract";
import type { PiiRevealBody } from "@liyoxi/contract";
import type { PrismaClient } from "@liyoxi/db";
import { beforeAll, describe, expect, it } from "vitest";
import { assembleServices } from "../assembly.js";
import { record } from "../audit/index.js";
import { createActor, isInTransaction, noopAlerts, piiFieldsOf, uuidv7 } from "../kernel/index.js";
import {
  createFactories,
  createTestStaffAuth,
  signInAsStaff,
  sampleStaffContext,
  TEST_KEYRING,
  useSeededDatabase,
} from "../testing/index.js";
import type { TestStaffAuth } from "../testing/index.js";
import { buildStaffContext, normalizeRoleConfig } from "../authz/index.js";
import { createPiiReveal } from "./pii-reveal.js";
import { encryptField } from "./crypto.js";
import { openField, sealPhone } from "./pii.js";

const db = useSeededDatabase("services");
let prisma: PrismaClient;
let t: TestStaffAuth;
beforeAll(async () => {
  prisma = await db.prisma();
  t = createTestStaffAuth(prisma);
}, 20_000);
const deps = () => ({
  db: prisma,
  tx: t.tx,
  clock: t.clock,
  keyring: () => TEST_KEYRING,
  facts: piiFieldsOf(assembleServices({ entry: "api", appEnv: "test" })),
  alerts: noopAlerts,
});
async function operator(
  roleKey: "super_admin" | "editor" | "delivery_manager" | "cs" = "super_admin",
  isLead = false,
) {
  const signed = await signInAsStaff(prisma, { roleKey, isLead, now: t.clock.now() });
  return {
    who: {
      id: signed.staff.id,
      phone: openField(TEST_KEYRING, "staff.phone_enc", signed.staff.phoneEnc),
    },
    ctx: await sampleStaffContext(prisma, signed.staff.id, { stepUpAt: t.clock.now() }),
    actor: createActor({ type: "staff", id: signed.staff.id, client: "admin" }),
    meta: {
      requestId: "pii-test",
      ip: "127.0.0.1",
      userAgent: "pii-test",
      authMethod: "password+totp" as const,
      sessionId: signed.sessionId,
    },
  };
}
const input = (
  id: string,
  subjectType: PiiRevealBody["subjectType"] = "staff",
  field: PiiRevealBody["field"] = "phone",
): PiiRevealBody => ({ subjectType, subjectId: id, field, purpose: "verify_identity" });

describe("W2-04 明文查看真实独立审计", () => {
  it("共享主体证照依主体范围，另一门店许可证不能借主体可见越过门店范围", async () => {
    const manager = await operator("delivery_manager");
    const make = createFactories({ db: prisma, clock: t.clock });
    const foreign = await make.staff({ staffRoleKey: "delivery_manager", staffGroupId: null });
    const mine = await make.store({ deliveryManagerId: manager.who.id });
    const outside = await make.store({ entityId: mine.entityId, deliveryManagerId: foreign.id });
    const entity = await prisma.entity.findUniqueOrThrow({ where: { id: mine.entityId } });
    const file = await make.fileObject({
      bucket: "secure",
      category: "kyc_permit",
      scopeType: "store",
      entityId: mine.entityId,
      storeId: outside.id,
    });
    const round = await prisma.qualificationSubmission.create({
      data: {
        id: uuidv7(),
        entityId: mine.entityId,
        storeId: outside.id,
        kind: "initial",
        createdByUserId: entity.createdByUserId!,
        createdAt: t.clock.now(),
        updatedAt: t.clock.now(),
      },
    });
    const branch = await prisma.qualificationDoc.create({
      data: {
        id: uuidv7(),
        entityId: mine.entityId,
        storeId: outside.id,
        qualificationSubmissionId: round.id,
        fileId: file.id,
        docType: "industry_permit",
        permitType: "food_business",
        scope: "store",
        origin: "uploaded",
        uploadedByUserId: entity.createdByUserId!,
        certNoEnc: encryptField(TEST_KEYRING, "qualification_doc.cert_no_enc", "JY20400000000001"),
        certNoMask: "JY*********0001",
        createdAt: t.clock.now(),
        updatedAt: t.clock.now(),
      },
    });
    const shared = await prisma.qualificationDoc.create({
      data: {
        id: uuidv7(),
        entityId: mine.entityId,
        storeId: outside.id,
        qualificationSubmissionId: round.id,
        fileId: file.id,
        docType: "business_license",
        scope: "entity",
        origin: "uploaded",
        uploadedByUserId: entity.createdByUserId!,
        certNoEnc: encryptField(
          TEST_KEYRING,
          "qualification_doc.cert_no_enc",
          "91310000MA1K204004",
        ),
        certNoMask: "9131**********4004",
        certNoBidx: new Uint8Array(32).fill(204),
        createdAt: t.clock.now(),
        updatedAt: t.clock.now(),
      },
    });
    const service = createPiiReveal(deps());
    await expect(
      service.reveal(
        manager.ctx,
        manager.actor,
        manager.meta,
        input(branch.id, "qualification_doc", "certNo"),
      ),
    ).rejects.toMatchObject({ error: "NOT_FOUND" });
    expect(await prisma.auditLog.count({ where: { targetId: branch.id } })).toBe(0);
    expect(
      (
        await service.reveal(
          manager.ctx,
          manager.actor,
          manager.meta,
          input(shared.id, "qualification_doc", "certNo"),
        )
      ).value,
    ).toBe("91310000MA1K204004");
  });
  it("超额告警只传员工id/window/实际limit；端口故障不向调用方传播", async () => {
    const seen: unknown[] = [];
    const service = createPiiReveal({
      ...deps(),
      alerts: {
        raise: async (value) => {
          expect(isInTransaction()).toBe(false);
          seen.push(value);
          throw new Error("本地告警端口故障");
        },
      },
    });
    const id = uuidv7();
    await expect(service.raiseLimit(id, "hour", 30)).resolves.toBeUndefined();
    expect(seen).toEqual([
      {
        rule: "pii.reveal_limit",
        severity: "P2",
        dimension: id,
        detail: { window: "hour", limit: 30 },
      },
    ]);
  });
  it("真实经理own/主管group/超级管理员all，范围外与不存在统一404且零审计", async () => {
    const manager = await operator("delivery_manager"),
      teammate = await operator("delivery_manager"),
      admin = await operator();
    const make = createFactories({ db: prisma, clock: t.clock });
    const foreign = await make.staff({ staffRoleKey: "delivery_manager", staffGroupId: null });
    const mine = await make.store({ deliveryManagerId: manager.who.id }),
      peer = await make.store({ deliveryManagerId: teammate.who.id }),
      outside = await make.store({ deliveryManagerId: foreign.id });
    for (const store of [mine, peer, outside])
      await prisma.storeProfile.create({
        data: {
          storeId: store.id,
          entityId: store.entityId,
          contactPhoneEnc: sealPhone(TEST_KEYRING, "store_profile.contact_phone_enc", "13920401234")
            .enc,
          contactPhoneMask: "139****1234",
          contactPhoneSource: "unverified",
          createdAt: t.clock.now(),
          updatedAt: t.clock.now(),
        },
      });
    const service = createPiiReveal(deps());
    expect(
      (
        await service.reveal(
          manager.ctx,
          manager.actor,
          manager.meta,
          input(mine.id, "store_profile", "contactPhone"),
        )
      ).value,
    ).toBe("13920401234");
    await expect(
      service.reveal(
        manager.ctx,
        manager.actor,
        manager.meta,
        input(peer.id, "store_profile", "contactPhone"),
      ),
    ).rejects.toMatchObject({ error: "NOT_FOUND" });
    await expect(
      service.reveal(
        manager.ctx,
        manager.actor,
        manager.meta,
        input(uuidv7(), "store_profile", "contactPhone"),
      ),
    ).rejects.toMatchObject({ error: "NOT_FOUND" });
    t.clock.advance(5_001); // 既有跨请求角色/组缓存5秒后重新读取真实组成员
    const leader = await operator("delivery_manager", true);
    expect(
      (
        await service.reveal(
          leader.ctx,
          leader.actor,
          leader.meta,
          input(peer.id, "store_profile", "contactPhone"),
        )
      ).value,
    ).toBe("13920401234");
    await expect(
      service.reveal(
        leader.ctx,
        leader.actor,
        leader.meta,
        input(outside.id, "store_profile", "contactPhone"),
      ),
    ).rejects.toMatchObject({ error: "NOT_FOUND" });
    expect(
      (
        await service.reveal(
          admin.ctx,
          admin.actor,
          admin.meta,
          input(outside.id, "store_profile", "contactPhone"),
        )
      ).value,
    ).toBe("13920401234");
    expect(await prisma.auditLog.count({ where: { targetId: peer.id, stream: "access" } })).toBe(1);
  });
  it("资质review权限独立可用，JSON字段只返回目标对象；可空字段仍独立留痕", async () => {
    const cs = await operator("cs");
    const base = staffRoleDefault("cs")!,
      actions = { ...defaultRoleActions("cs"), "pii.license.view": { on: false, leadOnly: false } };
    const ctx = buildStaffContext({
      staff: cs.ctx.staff,
      role: normalizeRoleConfig("cs", {
        moduleLevels: base.moduleLevels,
        actions,
        dataScope: base.dataScope,
      }),
      groupStaffIds: [],
      stepUpAt: t.clock.now(),
    });
    expect(ctx.permissions.has("merchant.qualification.review")).toBe(true);
    expect(ctx.permissions.has("pii.license.view")).toBe(false);
    const make = createFactories({ db: prisma, clock: t.clock });
    const store = await make.store();
    const user = await prisma.entity.findUniqueOrThrow({ where: { id: store.entityId } });
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
        createdByUserId: user.createdByUserId!,
        createdAt: t.clock.now(),
        updatedAt: t.clock.now(),
      },
    });
    const fields = { name: "资质测试主体", principal: "测试姓名" };
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
        uploadedByUserId: user.createdByUserId!,
        submittedFieldsEnc: encryptField(
          TEST_KEYRING,
          "qualification_doc.submitted_fields_enc",
          JSON.stringify(fields),
        ),
        createdAt: t.clock.now(),
        updatedAt: t.clock.now(),
      },
    });
    const service = createPiiReveal(deps());
    expect(
      (
        await service.reveal(
          ctx,
          cs.actor,
          cs.meta,
          input(doc.id, "qualification_doc", "submittedFields"),
        )
      ).value,
    ).toEqual(fields);
    expect(
      (
        await service.reveal(
          ctx,
          cs.actor,
          cs.meta,
          input(doc.id, "qualification_doc", "reviewedFields"),
        )
      ).value,
    ).toBeNull();
    const logs = await prisma.auditLog.findMany({ where: { targetId: doc.id, stream: "access" } });
    expect(logs).toHaveLength(2);
    expect(JSON.stringify(logs.map((v) => v.meta))).not.toContain("测试姓名");
  });
  it("完整11对象20组合准确校验；非法组合、other用途空note拒绝", () => {
    let combinations = 0;
    for (const [subject, fields] of Object.entries(PII_SUBJECT_FIELDS))
      for (const field of fields) {
        expect(
          PiiRevealBodySchema.safeParse(
            input(
              uuidv7(),
              subject as PiiRevealBody["subjectType"],
              field as PiiRevealBody["field"],
            ),
          ).success,
        ).toBe(true);
        combinations++;
      }
    expect(combinations).toBe(20);
    expect(PiiRevealBodySchema.safeParse(input(uuidv7(), "staff", "bankAccount")).success).toBe(
      false,
    );
    expect(PiiRevealBodySchema.safeParse({ ...input(uuidv7()), purpose: "other" })).toMatchObject({
      success: false,
    });
  });
  it("真正解密前，另一连接已看见access提交；输出只含指定字段、无幂等明文", async () => {
    const admin = await operator();
    const request = input(admin.who.id);
    let opens = 0;
    const service = createPiiReveal({
      ...deps(),
      open: async (...args) => {
        expect(isInTransaction()).toBe(false);
        expect(
          await prisma.auditLog.count({ where: { targetId: admin.who.id, stream: "access" } }),
        ).toBe(1);
        opens++;
        return openField(...args);
      },
    });
    const result = await service.reveal(admin.ctx, admin.actor, admin.meta, request);
    expect(result).toEqual({
      value: admin.who.phone,
      field: "phone",
      auditLogId: expect.any(String),
    });
    expect(opens).toBe(1);
    const log = await prisma.auditLog.findUniqueOrThrow({ where: { id: result.auditLogId } });
    expect(log).toMatchObject({
      stream: "access",
      category: "pii_reveal",
      action: "pii.phone.reveal",
      meta: { purpose: "verify_identity", note: null },
    });
    expect(
      JSON.stringify(log, (_key, value: unknown) =>
        typeof value === "bigint" ? String(value) : value,
      ),
    ).not.toContain(admin.who.phone);
    expect(await prisma.idempotencyRecord.count()).toBe(0);
  });
  it("审计写入后故障回滚即不解密；解密失败审计仍提交；禁止嵌套TX", async () => {
    const admin = await operator();
    let opens = 0;
    const brokenAudit = createPiiReveal({
      ...deps(),
      audit: async (...args) => {
        await record(...args);
        throw new Error("审计提交前故障");
      },
      open: () => {
        opens++;
        return "不应出现";
      },
    });
    await expect(
      brokenAudit.reveal(admin.ctx, admin.actor, admin.meta, input(admin.who.id)),
    ).rejects.toThrow("审计提交前故障");
    expect(opens).toBe(0);
    expect(
      await prisma.auditLog.count({ where: { targetId: admin.who.id, stream: "access" } }),
    ).toBe(0);
    const brokenCrypto = createPiiReveal({
      ...deps(),
      open: () => {
        throw new Error("本地解密故障");
      },
    });
    await expect(
      brokenCrypto.reveal(admin.ctx, admin.actor, admin.meta, input(admin.who.id)),
    ).rejects.toThrow("本地解密故障");
    expect(
      await prisma.auditLog.count({ where: { targetId: admin.who.id, stream: "access" } }),
    ).toBe(1);
    await expect(
      t.tx.run(() =>
        createPiiReveal(deps()).reveal(admin.ctx, admin.actor, admin.meta, input(admin.who.id)),
      ),
    ).rejects.toMatchObject({ kind: "nested_transaction" });
  });
  it("权限、范围、再验证不满足时无审计/明文，未来无对象404", async () => {
    const admin = await operator();
    const editor = await operator("editor");
    const manager = await operator("delivery_manager");
    const service = createPiiReveal(deps());
    await expect(
      service.reveal(editor.ctx, editor.actor, editor.meta, input(admin.who.id)),
    ).rejects.toMatchObject({ error: "PERMISSION_DENIED" });
    // 经理有 phone 权限但 system 无查看权，员工电话不能借此越权。
    await expect(
      service.reveal(manager.ctx, manager.actor, manager.meta, input(admin.who.id)),
    ).rejects.toMatchObject({ error: "PERMISSION_DENIED" });
    for (const [subject, field] of [
      ["invoice_request", "taxNo"],
      ["refund_txn", "payeeAccount"],
      ["service_ticket", "contactPhone"],
    ] as const)
      await expect(
        service.reveal(admin.ctx, admin.actor, admin.meta, input(uuidv7(), subject, field)),
      ).rejects.toMatchObject({ error: "NOT_FOUND" });
    const stale = { ...admin.ctx, stepUpAt: new Date(t.clock.now().getTime() - 600_001) };
    await expect(
      service.reveal(stale, admin.actor, admin.meta, input(uuidv7(), "agreement_consent", "phone")),
    ).rejects.toMatchObject({ error: "STEP_UP_REQUIRED" });
    expect(
      await prisma.auditLog.count({ where: { targetId: admin.who.id, stream: "access" } }),
    ).toBe(0);
  });
});
