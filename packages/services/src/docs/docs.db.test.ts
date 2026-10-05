// docs 的服务层用例（任务书 W1-03 第 7 节验收 1–4 与“模块完整”的两条不变量）。连真库，整份文件共用一个带种子的库。
// 各段用不同的协议键或自己的账号，互不踩：同意记录与协议版本是只增或禁删的，插了删不掉。
import type { PrismaClient } from "@liyoxi/db";
import { beforeAll, describe, expect, it } from "vitest";

import { AppError, createIdentityContext, createTxRunner } from "../kernel/index.js";
import type { IdentityContext, TxRunner } from "../kernel/index.js";
import { createClock, createFactories, useSeededDatabase } from "../testing/index.js";
import type { AdjustableClock, Factories } from "../testing/index.js";
import { createDocs, findN13Violations, findN4Violations, stampOf } from "./index.js";
import type { ConsentSigner, Docs } from "./index.js";

const db = useSeededDatabase("services");
const SLOW = 60_000;
const HOUR = 3_600_000;

let prisma: PrismaClient;
let clock: AdjustableClock;
let make: Factories;
let tx: TxRunner;
let docs: Docs;
/** 版本共用的员工与 PDF 文件行：省掉每个版本各造一份 */
let shared: { createdByStaffId: string; pdfFileId: string };

beforeAll(async () => {
  prisma = await db.prisma();
  clock = createClock();
  make = createFactories({ db: prisma, clock });
  tx = createTxRunner({ prisma, appEnv: "test" });
  docs = createDocs({ tx, clock });
  const staff = await make.staff({ staffRoleKey: "super_admin" });
  const file = await make.fileObject({ bucket: "secure", category: "legal_doc", ext: "pdf" });
  shared = { createdByStaffId: staff.id, pdfFileId: file.id };
}, SLOW);

const version = (
  agreementKey: string,
  input: Partial<Parameters<Factories["agreementVersion"]>[0] & object> = {},
) => make.agreementVersion({ agreementKey, ...shared, ...input });

const later = (ms: number): Date => new Date(clock.now().getTime() + ms);

async function signerOf(role: ConsentSigner["role"] = null): Promise<{
  signer: ConsentSigner;
  ctx: IdentityContext;
}> {
  const user = await make.merchantUser();
  return {
    signer: {
      merchantUserId: user.id,
      phoneEnc: user.phoneEnc ?? "",
      phoneMask: user.phoneMask ?? "",
      operatorNameMask: "王*",
      role,
      appid: "wx0000000000000001",
      openidHmac: new Uint8Array(32).fill(7),
    },
    ctx: createIdentityContext({
      actor: { type: "merchant", id: user.id, client: "weapp", role },
      requestId: "req_docs_test",
      ip: "203.0.113.9",
      userAgent: "u".repeat(400),
    }),
  };
}

async function appError(run: () => Promise<unknown>): Promise<AppError> {
  try {
    await run();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    return error as AppError;
  }
  throw new Error("本该抛业务错误，却成功了");
}

const currentOf = async (key: string) => (await docs.currentVersions(prisma)).get(key)?.id ?? null;
const listed = async (key: string) =>
  (await docs.listAgreements({ agreementKey: key, limit: 20 })).items[0];

describe("当前版本解析（验收 1）", () => {
  it(
    "到点前后切换；到点而簿记仍是 pending 也算当前；尚无生效版本为 null",
    async () => {
      const key = "custom_license";
      expect(await currentOf(key)).toBeNull();
      expect((await listed(key))?.currentVersion).toBeNull();

      const v1 = await version(key);
      const v2 = await version(key, { status: "pending", effectiveAt: later(HOUR) });
      // 表驱动：拨到某一刻，看当前版本、待生效版本，与两个版本各自的阶段
      const steps = [
        { at: 0, current: v1.id, upcoming: v2.id, phases: ["current", "upcoming"] },
        { at: HOUR - 1, current: v1.id, upcoming: v2.id, phases: ["current", "upcoming"] },
        // 到点那一刻：v2 的簿记列还是 pending（没有 docs.sweep 翻它），照样是当前版本
        { at: 1, current: v2.id, upcoming: null, phases: ["superseded", "current"] },
        { at: 24 * HOUR, current: v2.id, upcoming: null, phases: ["superseded", "current"] },
      ];
      for (const step of steps) {
        clock.advance(step.at);
        expect(await currentOf(key), `at +${step.at}`).toBe(step.current);
        const row = await listed(key);
        expect(row?.currentVersion?.agreementVersionId).toBe(step.current);
        expect(row?.upcomingVersion?.agreementVersionId ?? null).toBe(step.upcoming);
        expect([
          (await docs.getAgreementVersion(v1.id)).phase,
          (await docs.getAgreementVersion(v2.id)).phase,
        ]).toEqual(step.phases);
      }
      const status = await prisma.agreementVersion.findUniqueOrThrow({ where: { id: v2.id } });
      expect(status.status).toBe("pending");
      expect(await listed(key)).toMatchObject({
        agreementKey: key,
        subjectKind: "entity",
        consentMode: "checkbox",
        scenes: ["order_submit"],
        currentVersion: { versionLabel: "v2.0", isReconsentRequired: true },
      });
    },
    SLOW,
  );

  it(
    "草稿、已撤回不算当前，读正文是 NOT_FOUND；正文带占位的 PDF 地址",
    async () => {
      const key = "ad_service";
      const draft = await version(key, { status: "draft", effectiveAt: later(-HOUR) });
      expect(await currentOf(key)).toBeNull();
      const pending = await version(key, { status: "pending", effectiveAt: clock.now() });
      expect(await currentOf(key)).toBe(pending.id);

      const detail = await docs.getAgreementVersion(pending.id);
      expect(detail).toMatchObject({
        agreementKey: key,
        name: "《广告制作与交付服务协议》",
        phase: "current",
        versionLabel: `v${pending.major}.${pending.minor}`,
        contentSha256: pending.contentSha256,
        pdf: { url: "" },
      });

      await prisma.agreementVersion.update({
        where: { id: pending.id },
        data: { status: "withdrawn" },
      });
      expect(await currentOf(key)).toBeNull();
      for (const id of [draft.id, pending.id, "01890000-0000-7000-8000-0000000000ff"]) {
        expect((await appError(() => docs.getAgreementVersion(id))).error).toBe("NOT_FOUND");
      }
    },
    SLOW,
  );

  it(
    "清单：按 sort_no；按协议键、按场景筛；分页的游标",
    async () => {
      const all = await docs.listAgreements({ limit: 20 });
      expect(all.items.map((item) => item.agreementKey)).toEqual([
        "user",
        "privacy",
        "member",
        "points",
        "custom_license",
        "ad_service",
      ]);
      expect(all).toMatchObject({ nextCursor: null, hasMore: false });
      const byKey = await docs.listAgreements({ agreementKey: "points,user", limit: 20 });
      expect(byKey.items.map((item) => item.agreementKey)).toEqual(["user", "points"]);
      const byScene = await docs.listAgreements({ scene: "plan_purchase", limit: 20 });
      expect(byScene.items.map((item) => item.agreementKey)).toEqual(["member", "points"]);

      const first = await docs.listAgreements({ limit: 4 });
      expect(first.hasMore).toBe(true);
      const second = await docs.listAgreements({ limit: 4, cursor: first.nextCursor ?? "" });
      expect(second.items.map((item) => item.agreementKey)).toEqual(["custom_license", "ad_service"]);
      expect(second.hasMore).toBe(false);
      const bad = await appError(() => docs.listAgreements({ limit: 4, cursor: "@@" }));
      expect(bad.error).toBe("VALIDATION_FAILED");
    },
    SLOW,
  );
});

describe("同意记录、待同意与指纹、已签署协议（验收 2–4）", () => {
  it(
    "同意记录只增、可重放；旧版本回 AGREEMENT_VERSION_STALE；用户级场景里混进主体级协议回 VALIDATION_FAILED",
    async () => {
      const user1 = await version("user");
      const privacy1 = await version("privacy");
      const { signer, ctx } = await signerOf();
      const submit = (versions: { agreementKey?: string; agreementVersionId: string }[]) =>
        tx.run((handle) =>
          docs.assertConsents(handle, ctx, {
            scene: "login",
            consents: versions,
            signer,
            device: { model: "iPhone 15", system: "iOS 17.5", appVersion: "1.0.0" },
          }),
        );

      const before = await docs.pendingConsents(prisma, signer.merchantUserId);
      expect(before.map((item) => item.agreementKey)).toEqual(["user", "privacy"]);

      const both = [
        { agreementKey: "user", agreementVersionId: user1.id },
        { agreementKey: "privacy", agreementVersionId: privacy1.id },
      ];
      const first = await submit(both);
      expect(first.consents).toHaveLength(2);
      expect(first).toMatchObject({ complete: true, pendingConsents: [] });
      expect(first.stamp).toBe((await docs.consentStamps(prisma)).user);

      // 同一账号同一版本再提交：只有一行，返回同一编号
      const again = await submit([...both, both[0] as (typeof both)[number]]);
      expect(again.consents).toEqual(first.consents);
      const rows = await prisma.agreementConsent.findMany({
        where: { merchantUserId: signer.merchantUserId },
        orderBy: { seq: "asc" },
      });
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({
        scene: "login",
        method: "checkbox",
        contentSha256: user1.contentSha256,
        operatorNameMask: "王*",
        role: null,
        entityId: null,
        bizType: null,
        ip: "203.0.113.9",
        requestId: "req_docs_test",
        deviceSnapshot: { model: "iPhone 15", system: "iOS 17.5", appVersion: "1.0.0" },
      });
      expect(rows[0]?.userAgent).toHaveLength(300);
      expect(rows[0]?.seq.toString()).toBe(first.consents[0]?.consentNo);

      // 只增：对该表 UPDATE、DELETE 被库拒绝
      const id = first.consents[0]?.agreementConsentId ?? "";
      await expect(
        prisma.$executeRaw`UPDATE agreement_consent SET ip = '0.0.0.0' WHERE id = ${id}::uuid`,
      ).rejects.toThrow();
      await expect(
        prisma.$executeRaw`DELETE FROM agreement_consent WHERE id = ${id}::uuid`,
      ).rejects.toThrow();

      // 用户级场景里混进主体级协议；协议键与版本不一致
      const license = await currentOf("custom_license");
      const mixed = await appError(() => submit([{ agreementVersionId: license ?? "" }]));
      expect(mixed.error).toBe("VALIDATION_FAILED");
      const mismatch = await appError(() =>
        submit([{ agreementKey: "privacy", agreementVersionId: user1.id }]),
      );
      expect(mismatch.error).toBe("VALIDATION_FAILED");

      // 排了新版本：还没到点提交它是过期；到点后提交旧的是过期，都带此刻的当前版本 id
      const user2 = await version("user", {
        status: "pending",
        effectiveAt: later(HOUR),
        isReconsentRequired: false,
      });
      const early = await appError(() => submit([{ agreementVersionId: user2.id }]));
      expect(early.error).toBe("AGREEMENT_VERSION_STALE");
      expect(early.details).toEqual({ agreementKey: "user", currentAgreementVersionId: user1.id });

      const stampBefore = await docs.consentStamps(prisma);
      clock.advance(HOUR);
      const stale = await appError(() => submit([both[0] as (typeof both)[number]]));
      expect(stale.error).toBe("AGREEMENT_VERSION_STALE");
      expect(stale.details).toEqual({ agreementKey: "user", currentAgreementVersionId: user2.id });
      expect(await prisma.agreementConsent.count({ where: { merchantUserId: signer.merchantUserId } })).toBe(2);

      // 验收 3：当前版本集合一变指纹就变；关了“需重新同意”的小修订，同意过旧版的人不列入
      const stampAfter = await docs.consentStamps(prisma);
      expect(stampAfter.user).not.toBe(stampBefore.user);
      expect(stampAfter.all).not.toBe(stampBefore.all);
      expect(stampAfter.user).toBe(
        stampOf([
          { agreementKey: "privacy", id: privacy1.id },
          { agreementKey: "user", id: user2.id },
        ]),
      );
      expect(await docs.pendingConsents(prisma, signer.merchantUserId)).toEqual([]);
      // 没同意过任何版本的人：两份都列，带新版本
      const fresh = await signerOf();
      const pending = await docs.pendingConsents(prisma, fresh.signer.merchantUserId);
      expect(pending.map((item) => [item.agreementKey, item.agreementVersionId])).toEqual([
        ["user", user2.id],
        ["privacy", privacy1.id],
      ]);
      expect(pending[0]).toMatchObject({ name: "《用户服务协议》", versionLabel: "v2.0" });

      // 需重新同意的新版本：同意过旧版的人也列入
      const privacy2 = await version("privacy", { status: "pending", effectiveAt: later(HOUR) });
      clock.advance(HOUR);
      const mine = await docs.pendingConsents(prisma, signer.merchantUserId);
      expect(mine.map((item) => item.agreementVersionId)).toEqual([privacy2.id]);
      // 重新同意（用例函数）：补齐后不再待同意
      const receipt = await docs.reconsent(ctx, {
        consents: [{ agreementKey: "privacy", agreementVersionId: privacy2.id }],
        signer,
      });
      expect(receipt.pendingConsents).toEqual([]);
      expect(receipt.consents[0]).toMatchObject({ agreementKey: "privacy" });
      const reconsented = await prisma.agreementConsent.findUniqueOrThrow({
        where: { id: receipt.consents[0]?.agreementConsentId ?? "" },
      });
      expect(reconsented).toMatchObject({ scene: "reconsent", method: "checkbox" });
    },
    SLOW,
  );

  it(
    "已签署协议：老板、店员两种形状；店员结果的键里没有三个单据字段；计数等于老板视图的行数",
    async () => {
      const merchant = await make.merchant();
      const owner = await signerOf("owner");
      const ownerId = owner.signer.merchantUserId;
      const license = (await currentOf("custom_license")) ?? "";
      const [user, privacy] = [(await currentOf("user")) ?? "", (await currentOf("privacy")) ?? ""];

      await tx.run((handle) =>
        docs.assertConsents(handle, owner.ctx, {
          scene: "login",
          consents: [{ agreementVersionId: user }, { agreementVersionId: privacy }],
          signer: owner.signer,
        }),
      );
      // 交易场景：带主体、门店与单据；同一单据重复提交只有一条，换一张单据另记一条
      const order = (bizId: string, bizNo: string) =>
        tx.run((handle) =>
          docs.assertConsents(handle, owner.ctx, {
            scene: "order_submit",
            consents: [{ agreementVersionId: license }],
            signer: owner.signer,
            entity: {
              entityId: merchant.entity.id,
              entityName: "测试主体",
              usccEnc: null,
              usccMask: null,
              storeId: merchant.store.id,
            },
            biz: { type: "drama_order", id: bizId, no: bizNo },
          }),
        );
      const firstOrder = await order("01890000-0000-7000-8000-00000000b001", "LYX2026010590001");
      clock.advance(60_000);
      expect(await order("01890000-0000-7000-8000-00000000b001", "LYX2026010590001")).toMatchObject({
        consents: firstOrder.consents,
      });
      const secondOrder = await order("01890000-0000-7000-8000-00000000b002", "LYX2026010590002");
      expect(secondOrder.consents[0]?.consentNo).not.toBe(firstOrder.consents[0]?.consentNo);

      const viewer = { merchantUserId: ownerId, entityId: merchant.entity.id };
      const asOwner = await docs.listSignedAgreements({ role: "owner", ...viewer }, { limit: 20 });
      if (asOwner.viewerRole !== "owner") throw new Error("老板视图的判别字段不对");
      // 主体级在前、用户级在后；一行一份协议
      expect(asOwner.items.map((item) => item.agreementKey)).toEqual([
        "custom_license",
        "user",
        "privacy",
      ]);
      expect(asOwner.items[0]).toMatchObject({
        subjectKind: "entity",
        currentVersionId: license,
        isCurrentVersionConsented: true,
        consentedVersion: { agreementVersionId: license },
        latestConsent: {
          consentNo: secondOrder.consents[0]?.consentNo,
          scene: "order_submit",
          bizType: "drama_order",
          bizNo: "LYX2026010590002",
          bizTitle: null,
        },
        firstConsent: { consentNo: firstOrder.consents[0]?.consentNo, bizNo: "LYX2026010590001" },
      });
      expect(asOwner.items[1]?.latestConsent).toMatchObject({ scene: "login", bizNo: null });

      // 计数与老板视图的行数同口径；筛选同列表
      expect(await docs.countSignedAgreements(viewer, {})).toEqual({ all: 3 });
      expect(await docs.countSignedAgreements(viewer, { subjectKind: "user" })).toEqual({ all: 2 });
      expect(await docs.countSignedAgreements(viewer, { agreementKey: "custom_license" })).toEqual({
        all: 1,
      });
      const onlyEntity = await docs.listSignedAgreements(
        { role: "owner", ...viewer },
        { limit: 20, subjectKind: "entity" },
      );
      expect(onlyEntity.items).toHaveLength(1);

      // 店员：只有本人的用户级协议；记录的键里没有 bizType、bizNo、bizTitle
      const asClerk = await docs.listSignedAgreements({ role: "clerk", ...viewer }, { limit: 20 });
      expect(asClerk.viewerRole).toBe("clerk");
      expect(asClerk.items.map((item) => item.agreementKey)).toEqual(["user", "privacy"]);
      for (const item of asClerk.items) {
        for (const record of [item.latestConsent, item.firstConsent]) {
          expect(Object.keys(record).sort()).toEqual(
            ["consentNo", "consentedAt", "method", "scene", "versionLabel"].sort(),
          );
        }
      }
      const clerkEntity = await docs.listSignedAgreements(
        { role: "clerk", ...viewer },
        { limit: 20, subjectKind: "entity" },
      );
      expect(clerkEntity.items).toEqual([]);
    },
    SLOW,
  );
});

describe("不变量 docs.N4、docs.N13", () => {
  it(
    "前面各段留下的数据 0 违规；并列的两个可解析版本被 docs.N4 报出",
    async () => {
      const now = clock.now();
      expect(await findN4Violations(prisma, { now })).toEqual([]);
      expect(await findN13Violations(prisma, { now })).toEqual([]);

      // ad_service：一个生效中、一个待生效，生效时间相同 → 当前版本不唯一
      const at = later(-HOUR);
      const active = await version("ad_service", { effectiveAt: at });
      const pending = await version("ad_service", { status: "pending", effectiveAt: at });
      const violations = await findN4Violations(prisma, { now });
      expect(violations.map((item) => item.subject)).toEqual(
        [active.id, pending.id].sort().map((id) => ({ type: "agreement_version", id })),
      );
      expect(violations[0]?.detail).toMatchObject({
        problem: "current_version_not_unique",
        agreementKey: "ad_service",
      });
      // 登记的检查项不给时刻：取数据库时间也跑得通
      expect(Array.isArray(await findN13Violations(prisma))).toBe(true);
    },
    SLOW,
  );
});
