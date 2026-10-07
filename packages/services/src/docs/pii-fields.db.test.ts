import { beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@liyoxi/db";
import { assembleServices } from "../assembly.js";
import { findUnknownAuditTargetTypes } from "../audit/index.js";
import {
  createActor,
  createIdentityContext,
  noopAlerts,
  piiFieldsOf,
  uuidv7,
} from "../kernel/index.js";
import {
  createFactories,
  createTestStaffAuth,
  sampleStaffContext,
  signInAsStaff,
  TEST_KEYRING,
  useSeededDatabase,
} from "../testing/index.js";
import type { TestStaffAuth } from "../testing/index.js";
import { createPiiReveal, encryptField, sealPhone, sealUscc } from "../security/index.js";
import { createDocs } from "./index.js";
const db = useSeededDatabase("services");
let prisma: PrismaClient, t: TestStaffAuth;
beforeAll(async () => {
  prisma = await db.prisma();
  t = createTestStaffAuth(prisma);
}, 30_000);
const deps = () => ({
  db: prisma,
  tx: t.tx,
  clock: t.clock,
  keyring: () => TEST_KEYRING,
  facts: piiFieldsOf(assembleServices({ entry: "api", appEnv: "test" })),
  alerts: noopAlerts,
});
async function operator() {
  const signed = await signInAsStaff(prisma, { roleKey: "super_admin", now: t.clock.now() });
  return {
    ctx: await sampleStaffContext(prisma, signed.staff.id, { stepUpAt: t.clock.now() }),
    actor: createActor({ type: "staff", id: signed.staff.id, client: "admin" }),
    meta: {
      requestId: "consent-pii-test",
      ip: "127.0.0.1",
      userAgent: "test",
      authMethod: "password+totp" as const,
      sessionId: signed.sessionId,
    },
  };
}
const input = (id: string, subjectType: "agreement_consent", field: "phone" | "uscc") => ({
  subjectType,
  subjectId: id,
  field,
  purpose: "verify_identity" as const,
});
describe("W2-04 同意快照来源事实", () => {
  it("生产同意写侧的复制密文按真实来源AAD解密，agreement_consent审计目标启动自检通过", async () => {
    const admin = await operator();
    const make = createFactories({
      db: prisma,
      clock: t.clock,
      seal: {
        phone: (column, value) => sealPhone(TEST_KEYRING, column, value),
        uscc: (column, value) => sealUscc(TEST_KEYRING, column, value),
        text: (column, value) => encryptField(TEST_KEYRING, column, value),
      },
    });
    const user = await make.merchantUser({ phone: "13920400204" });
    const version = await make.agreementVersion({ agreementKey: "user" });
    const docs = createDocs({ tx: t.tx, clock: t.clock });
    const created = await t.tx.run((tx) =>
      docs.assertConsents(
        tx,
        createIdentityContext({
          actor: { type: "merchant", id: user.id, client: "weapp" },
          ip: "127.0.0.1",
          requestId: "consent-pii-test",
        }),
        {
          scene: "login",
          consents: [{ agreementVersionId: version.id }],
          signer: {
            merchantUserId: user.id,
            phoneEnc: user.phoneEnc!,
            phoneMask: user.phoneMask!,
            operatorNameMask: null,
            role: null,
            appid: null,
            openidHmac: null,
          },
        },
      ),
    );
    const id = created.consents[0]!.agreementConsentId;
    expect(
      await createPiiReveal(deps()).reveal(
        admin.ctx,
        admin.actor,
        admin.meta,
        input(id, "agreement_consent", "phone"),
      ),
    ).toMatchObject({ value: "13920400204", field: "phone" });
    expect(
      await prisma.auditLog.findFirst({ where: { targetId: id, stream: "access" } }),
    ).toMatchObject({ targetType: "agreement_consent" });
    expect(await findUnknownAuditTargetTypes(prisma)).toEqual([]);
    // 主体信用代码同样来自真实 entity 密文。已有订单夹具只提供关联单号，目标同意仍走生产 assertConsents。
    const entity = await make.entity({ createdByUserId: user.id, uscc: "91310000MA1K204004" });
    const store = await make.store({ entityId: entity.id });
    const license = await make.agreementVersion({ agreementKey: "custom_license" });
    const orderId = uuidv7(),
      orderNo = "LYX2026010520404";
    const receipt = await t.tx.run((tx) =>
      docs.assertConsents(
        tx,
        createIdentityContext({
          actor: { type: "merchant", id: user.id, client: "weapp" },
          ip: "127.0.0.1",
          requestId: "consent-uscc-test",
        }),
        {
          scene: "order_submit",
          consents: [{ agreementVersionId: license.id }],
          signer: {
            merchantUserId: user.id,
            phoneEnc: user.phoneEnc!,
            phoneMask: user.phoneMask!,
            operatorNameMask: null,
            role: "owner",
            appid: null,
            openidHmac: null,
          },
          entity: {
            entityId: entity.id,
            entityName: entity.name,
            usccEnc: entity.usccEnc,
            usccMask: entity.usccMask,
            storeId: store.id,
          },
          biz: { type: "drama_order", id: orderId, no: orderNo },
        },
      ),
    );
    await make.dramaOrder({
      id: orderId,
      orderNo,
      entityId: entity.id,
      storeId: store.id,
      placedByUserId: user.id,
      agreementConsentId: receipt.consents[0]!.agreementConsentId,
    });
    const consent = await prisma.agreementConsent.findUniqueOrThrow({
      where: { id: receipt.consents[0]!.agreementConsentId },
    });
    expect(consent.usccEnc).toBe(entity.usccEnc);
    expect(
      (
        await createPiiReveal(deps()).reveal(
          admin.ctx,
          admin.actor,
          admin.meta,
          input(consent.id, "agreement_consent", "uscc"),
        )
      ).value,
    ).toBe("91310000MA1K204004");
  });
});
