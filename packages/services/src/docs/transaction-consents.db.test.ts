import type { PrismaClient } from "@liyoxi/db";
import { beforeAll, expect, it, vi } from "vitest";
import { createEvents } from "../events/index.js";
import { createNotices } from "../config/index.js";
import { createIdentityContext, createTxRunner, uuidv7 } from "../kernel/index.js";
import type { AppError, TxRunner } from "../kernel/index.js";
import {
  assembleForTest,
  createClock,
  createFactories,
  useSeededDatabase,
} from "../testing/index.js";
import type { AdjustableClock, Factories } from "../testing/index.js";
import { createDocs } from "./index.js";
import type { Docs, TransactionConsentsInput } from "./index.js";

const database = useSeededDatabase("services");
let db: PrismaClient, clock: AdjustableClock, make: Factories, tx: TxRunner, docs: Docs;
const versions = new Map<string, string>();
let shared: { createdByStaffId: string; pdfFileId: string };
const ctx = createIdentityContext({ actor: { type: "system", job: "docs.transaction_test" } });

beforeAll(async () => {
  db = await database.prisma();
  clock = createClock();
  make = createFactories({ db, clock });
  tx = createTxRunner({ prisma: db, appEnv: "test" });
  docs = createDocs({ tx, clock });
  const notices = createNotices({
    clock,
    events: createEvents({ assembly: assembleForTest({ entry: "worker" }), clock, tx }),
  });
  const staff = await make.staff({ staffRoleKey: "super_admin" });
  const pdf = await make.fileObject({ category: "legal_doc", bucket: "secure", ext: "pdf" });
  shared = { createdByStaffId: staff.id, pdfFileId: pdf.id };
  for (const agreementKey of [
    "user",
    "privacy",
    "member",
    "points",
    "custom_license",
    "ad_service",
  ]) {
    const id = uuidv7();
    const siteNoticeId = ["member", "points"].includes(agreementKey)
      ? (
          await tx.run((handle) =>
            notices.announce(handle, ctx, {
              kind: "agreement_version",
              refId: id,
              title: "测试协议",
              summary: "交易 producer 真库验证",
              effectiveAt: clock.now(),
              shortNoticeReason: "首次测试前置",
              createdByStaffId: staff.id,
              link: { route: "/agreement", params: { agreementKey } },
            }),
          )
        ).siteNoticeId
      : undefined;
    await make.agreementVersion({
      id,
      agreementKey,
      ...shared,
      ...(siteNoticeId ? { siteNoticeId, shortNoticeReason: "首次测试前置" } : {}),
    });
    versions.set(agreementKey, id);
  }
}, 60_000);

async function input(
  scene: TransactionConsentsInput["scene"] = "order_submit",
): Promise<TransactionConsentsInput> {
  const merchant = await make.merchant();
  const keys =
    scene === "plan_purchase"
      ? ["member", "points"]
      : [scene === "topup" ? "points" : scene === "ad_request" ? "ad_service" : "custom_license"];
  return {
    scene,
    consents: keys.map((key) => ({ agreementVersionId: versions.get(key)! })),
    signer: {
      merchantUserId: merchant.user.id,
      phoneEnc: merchant.user.phoneEnc!,
      phoneMask: merchant.user.phoneMask!,
      operatorNameMask: "王*",
      role: "owner",
      appid: null,
      openidHmac: null,
    },
    entity: {
      entityId: merchant.entity.id,
      entityName: merchant.entity.name,
      usccEnc: merchant.entity.usccEnc,
      usccMask: merchant.entity.usccMask,
      storeId: merchant.store.id,
    },
    biz: {
      type:
        scene === "ad_request" ? "ad" : scene === "order_submit" ? "drama_order" : "billing_order",
      id: uuidv7(),
      no: `${scene === "ad_request" ? "GG" : scene === "order_submit" ? "LYX" : "FK"}2026010599991`,
    },
  };
}

it("四个真实交易 scene 与原 wrapper 返回同一凭据，重复版本/提交不增加记录", async () => {
  for (const scene of ["plan_purchase", "topup", "order_submit", "ad_request"] as const) {
    const asked = await input(scene);
    const original = await tx.run((handle) => docs.assertConsents(handle, ctx, asked));
    const producer = await tx.run((handle) =>
      docs.recordTransactionConsents(handle, ctx, {
        ...asked,
        consents: [...asked.consents, asked.consents[0]!],
      }),
    );
    expect(producer).toEqual(original.consents);
    expect(original.pendingConsents.map((item) => item.agreementKey)).toEqual(["user", "privacy"]);
    expect(original.complete).toBe(false);
    expect(original.stamp).toBe((await docs.consentStamps(db)).user);
    expect(await db.agreementConsent.count({ where: { bizId: asked.biz.id } })).toBe(
      asked.consents.length,
    );
    const rows = await db.agreementConsent.findMany({ where: { bizId: asked.biz.id } });
    expect(
      rows.every(
        (row) =>
          row.scene === scene &&
          row.bizNo === asked.biz.no &&
          row.consentedAt.toISOString() === clock.now().toISOString(),
      ),
    ).toBe(true);
  }
}, 60_000);

it("交易窄口运行时拒绝用户级 scene 与缺失主体，真实库没有伪凭据", async () => {
  const asked = await input();
  for (const scene of ["login", "reconsent", "member_join"]) {
    await expect(
      tx.run((handle) =>
        docs.recordTransactionConsents(handle, ctx, {
          ...asked,
          scene,
        } as unknown as TransactionConsentsInput),
      ),
    ).rejects.toThrow(TypeError);
  }
  await expect(
    tx.run((handle) =>
      docs.recordTransactionConsents(handle, ctx, {
        ...asked,
        entity: undefined,
      } as unknown as TransactionConsentsInput),
    ),
  ).rejects.toThrow(TypeError);
  expect(await db.agreementConsent.count({ where: { bizId: asked.biz.id } })).toBe(0);
});

it("与业务同 TX：凭据写成后后续异常使凭据和业务写一起回滚", async () => {
  const asked = await input();
  const before = await db.store.findUniqueOrThrow({ where: { id: asked.entity.storeId! } });
  await expect(
    tx.run(async (handle) => {
      await docs.recordTransactionConsents(handle, ctx, asked);
      await handle.store.update({ where: { id: before.id }, data: { name: "将回滚的业务写" } });
      throw new Error("after_receipt_fault");
    }),
  ).rejects.toThrow("after_receipt_fault");
  expect(await db.agreementConsent.count({ where: { bizId: asked.biz.id } })).toBe(0);
  expect((await db.store.findUniqueOrThrow({ where: { id: before.id } })).name).toBe(before.name);
});

it("服务入口只取一次真实 Tc：原 wrapper 的凭据/pending/stamp 同时刻；随后旧版真实拒绝", async () => {
  const asked = await input();
  const before = clock.now();
  const pendingBefore = await docs.pendingConsents(db, asked.signer.merchantUserId);
  const stampBefore = (await docs.consentStamps(db)).user;
  const due = new Date(before.getTime() + 1);
  const nextLicense = await make.agreementVersion({
    agreementKey: "custom_license",
    status: "pending",
    effectiveAt: due,
    ...shared,
  });
  await make.agreementVersion({
    agreementKey: "user",
    status: "pending",
    effectiveAt: due,
    ...shared,
  });
  const once = vi.fn(() => {
    const at = clock.now();
    clock.advance(2);
    return at;
  });
  const service = createDocs({ tx, clock: { now: once } });
  const original = await tx.run((handle) => service.assertConsents(handle, ctx, asked));
  expect(once).toHaveBeenCalledTimes(1);
  expect(original.consents[0]!.consentedAt).toBe(before.toISOString());
  expect(original.pendingConsents).toEqual(pendingBefore);
  expect(original.stamp).toBe(stampBefore);
  once.mockClear();
  await expect(
    tx.run((handle) =>
      service.recordTransactionConsents(handle, ctx, {
        ...asked,
        biz: { ...asked.biz, id: uuidv7() },
      }),
    ),
  ).rejects.toMatchObject({
    error: "AGREEMENT_VERSION_STALE",
    details: { agreementKey: "custom_license", currentAgreementVersionId: nextLicense.id },
  } satisfies Partial<AppError>);
  expect(once).toHaveBeenCalledTimes(1);
  const rows = await db.agreementConsent.findMany({
    where: { merchantUserId: asked.signer.merchantUserId },
  });
  expect(rows).toHaveLength(1);
});

it("新行真RETURNING seq/时间与库行一致；混合已有/新凭据保留输入顺序和一次Tc", async () => {
  const asked = await input("plan_purchase");
  const first = await tx.run((handle) => docs.recordTransactionConsents(handle, ctx, {
    ...asked, consents: [asked.consents[1]!],
  }));
  const mixed = await tx.run((handle) => docs.recordTransactionConsents(handle, ctx, asked));
  expect(mixed.map((receipt) => receipt.agreementVersionId)).toEqual(
    asked.consents.map((consent) => consent.agreementVersionId),
  );
  expect(mixed[1]).toEqual(first[0]);
  for (const receipt of mixed) {
    const stored = await db.agreementConsent.findUniqueOrThrow({ where: { id: receipt.agreementConsentId } });
    expect(receipt.consentNo).toBe(stored.seq.toString());
    expect(receipt.consentedAt).toBe(stored.consentedAt.toISOString());
  }
});

it("版本与协议同批读取仍保留缺版本、错键和错scene的原错误顺序，整批不落凭据", async () => {
  const asked = await input("plan_purchase");
  const run = (consents: TransactionConsentsInput["consents"]) => tx.run((handle) =>
    docs.recordTransactionConsents(handle, ctx, { ...asked, consents }));
  const missing = uuidv7();
  await expect(run([{ agreementVersionId: missing }])).rejects.toMatchObject({
    error: "VALIDATION_FAILED", message: "协议版本不存在",
  });
  await expect(run([{ agreementKey: "member", agreementVersionId: missing }]))
    .rejects.toMatchObject({ error: "AGREEMENT_VERSION_STALE", details: {
      agreementKey: "member", currentAgreementVersionId: versions.get("member"),
    } });
  await expect(run([{ agreementKey: "points", agreementVersionId: versions.get("member")! }]))
    .rejects.toMatchObject({ error: "VALIDATION_FAILED", message: "协议键与版本不一致" });
  await expect(run([{ agreementVersionId: versions.get("custom_license")! },
    { agreementVersionId: missing }])).rejects.toMatchObject({
    error: "AGREEMENT_VERSION_STALE", details: { agreementKey: "custom_license" },
  });
  await expect(run([asked.consents[0]!, { agreementVersionId: missing }]))
    .rejects.toMatchObject({ error: "VALIDATION_FAILED" });
  expect(await db.agreementConsent.count({ where: { bizId: asked.biz.id } })).toBe(0);
});
