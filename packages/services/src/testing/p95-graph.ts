// P95 专用前置：补齐旧表工厂没有构造的历史关联；不声称已跑认证或上架生产用例。
import { createHash } from "node:crypto";
import type { PrismaClient } from "@liyoxi/db";
import { assertTestDatabaseUrl } from "@liyoxi/db/testing/standalone";
import { QUALIFICATION_DECLARATION_VERSION } from "@liyoxi/contract";
import { createIdentityContext, lockRows, uuidv7 } from "../kernel/index.js";
import { fileRefTypePort, placeholderPdf } from "../media/index.js";
import { createProfile } from "../profile/index.js";
import { loadKeyring } from "../security/index.js";
import { createTenant } from "../tenant/index.js";
import { createFactories } from "./data/factories/index.js";
import { openSealed, testSealer } from "./data/seal.js";
import type { M1Support } from "./m1-types.js";

interface PrototypeScope {
  readonly entityId: string;
  readonly storeId: string;
  readonly memberId: string;
  readonly merchantUserId: string;
  readonly phone: string;
}

// 本轮假 Storage 的可解析 1×1 PNG；仅测试占位，不是实际证照。
const licenseImage = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=",
  "base64",
);

async function completeContent({ support, db }: { support: M1Support; db: PrismaClient }) {
  const { runtime, clock } = support;
  const dramas = await db.drama.findMany({ orderBy: { id: "asc" } });
  // 4 已开工订单、原 quote 剧和 spare 剧沿用原分布；不以补图另建剧或员工。
  if (dramas.length !== 6 || dramas.some((drama) => drama.status !== "listed"))
    throw new Error("P95 prototype 应是六部原有共享上架剧");
  await db.dictItem.upsert({
    where: { dictTypeKey_code: { dictTypeKey: "genre", code: "comedy" } },
    create: {
      id: uuidv7(),
      dictTypeKey: "genre",
      code: "comedy",
      name: "测试喜剧",
      parentCode: null,
      ext: {},
      isEnabled: true,
      position: 999,
      createdAt: clock.now(),
      updatedAt: clock.now(),
    },
    update: {},
  });
  for (const drama of dramas) {
    if (!drama.firstListedAt || !drama.posterFileId || drama.totalEpisodes !== 3)
      throw new Error("P95 prototype 原有上架快照缺失");
    const proof = await runtime.media.putSystemFile({
      category: "drama_license_doc",
      fileName: "p95-license-placeholder.pdf",
      objectKey: `p95/${support.runId}/drama-${drama.id}.pdf`,
      body: placeholderPdf(`p95-${drama.id}`),
      entityId: null,
      storeId: null,
    });
    await runtime.tx.run(async (tx) => {
      await lockRows(tx, "drama", [drama.id]);
      const copyright = await tx.dramaCopyright.findUniqueOrThrow({
        where: { dramaId: drama.id },
      });
      if (
        copyright.currentDramaCopyrightRevisionId ||
        !copyright.licenseStartDate ||
        !copyright.licenseEndDate ||
        (await tx.dramaCopyrightRevision.count({ where: { dramaId: drama.id } })) !== 0
      )
        throw new Error("P95 prototype 版权历史不是待补全的初始图");
      const complete = {
        source: "own",
        platforms: copyright.platforms,
        territory: "中国大陆（测试）",
        hasNetworkRight: true,
        canSublicense: true,
        canEditEmbed: true,
        canAdapt: true,
        proofFileIds: [proof.fileId],
      };
      const revisionId = uuidv7();
      await tx.dramaCopyrightRevision.create({
        data: {
          id: revisionId,
          dramaId: drama.id,
          changeKind: "initial",
          copyrightSnapshot: {
            ...complete,
            licenseStartDate: copyright.licenseStartDate.toISOString().slice(0, 10),
            licenseEndDate: copyright.licenseEndDate.toISOString().slice(0, 10),
          },
          prevEndDate: null,
          newEndDate: copyright.licenseEndDate,
          reason: "P95 测试前置首次上架历史配套",
          proofFileIds: complete.proofFileIds,
          createdByStaffId: drama.createdByStaffId,
          createdAt: drama.firstListedAt!,
        },
      });
      await tx.dramaCopyright.update({
        where: { dramaId: drama.id },
        data: { ...complete, currentDramaCopyrightRevisionId: revisionId, updatedAt: clock.now() },
      });
      await tx.drama.update({
        where: { id: drama.id },
        data: { synopsis: "P95 本地生活短剧测试前置", updatedAt: clock.now() },
      });
      const permit = await tx.dramaPermit.findFirstOrThrow({
        where: { dramaId: drama.id, status: "active", permitKind: "program_no" },
      });
      await tx.dramaPermit.update({
        where: { id: permit.id },
        data: { scanFileIds: [proof.fileId], updatedAt: clock.now() },
      });
      await tx.dramaEpisode.createMany({
        data: [1, 2, 3].map((episodeNo) => ({
          id: uuidv7(),
          dramaId: drama.id,
          episodeNo,
          durationMs: 60_000,
          createdAt: drama.firstListedAt!,
          updatedAt: clock.now(),
        })),
      });
    });
  }
}

export async function completeP95Qualification(
  { support, db }: { support: M1Support; db: PrismaClient },
  scope: PrototypeScope,
) {
  const { runtime, clock } = support;
  const store = await db.store.findFirstOrThrow({
    where: { id: scope.storeId, entityId: scope.entityId },
    include: { entity: true, storeProfileStore: true },
  });
  const profile = store.storeProfileStore;
  if (
    store.qualificationStatus !== "verified" ||
    store.entity.verificationStatus !== "verified" ||
    store.entity.entityType !== "enterprise" ||
    !store.entity.verifiedAt ||
    !store.entity.usccEnc ||
    !profile ||
    profile.effectiveQualificationSubmissionId ||
    (await db.qualificationSubmission.count({ where: { storeId: scope.storeId } })) !== 0
  )
    throw new Error("P95 prototype 已认证档案不是待补全的初始图");
  const reviewer = await db.staff.findFirstOrThrow({
    where: { status: "active", staffRoleKey: "super_admin" },
    orderBy: { id: "asc" },
  });
  const at = store.entity.verifiedAt;
  const fileId = uuidv7(),
    objectKey = `p95/${support.runId}/license-${fileId}.png`;
  const written = await support.providers.storage.putObject({
    bucket: "secure",
    key: objectKey,
    body: licenseImage,
    contentType: "image/png",
    ifAbsent: true,
  });
  if (!written.ok || written.value.size !== licenseImage.byteLength)
    throw new Error("P95 本轮假 Storage 证照占位未写入");
  const file = await createFactories({ db, clock }).fileObject({
    id: fileId,
    category: "kyc_license",
    bucket: "secure",
    objectKey,
    scopeType: "entity",
    entityId: scope.entityId,
    storeId: null,
    uploadActorType: "merchant",
    uploadActorId: scope.merchantUserId,
    uploadClient: "weapp",
    ext: "png",
    declaredMime: "image/png",
    mime: "image/png",
    declaredSize: licenseImage.byteLength,
    sizeBytes: licenseImage.byteLength,
    etag: written.value.etag,
    sha256: createHash("sha256").update(licenseImage).digest("hex"),
    storedAt: at,
    createdAt: at,
    updatedAt: at,
  });
  const uscc = openSealed("entity.uscc_enc", store.entity.usccEnc);
  const sealed = testSealer.uscc("qualification_doc.cert_no_enc", uscc);
  const submissionId = uuidv7(),
    approvalId = uuidv7();
  await runtime.tx.run(async (tx) => {
    // 仅构造已存在 verified 快照的历史，不倒退状态、调用未开放 change producer 或制造迁移事件。
    await tx.approvalRequest.create({
      data: {
        id: approvalId,
        kind: "qualification",
        category: "review",
        subjectType: "store",
        subjectId: scope.storeId,
        entityId: scope.entityId,
        storeId: scope.storeId,
        roundNo: 1,
        status: "approved",
        summarySnapshot: {
          title: store.name!,
          lines: [],
          domain: { type: "qualification_submission", id: submissionId },
        },
        submitActorType: "merchant",
        submitActorId: scope.merchantUserId,
        submitClient: "weapp",
        submittedAt: at,
        decidedAt: at,
        decidedByStaffId: reviewer.id,
        dedupeKey: `qualification:${scope.storeId}`,
        createdAt: at,
        updatedAt: at,
      },
    });
    await tx.qualificationSubmission.create({
      data: {
        id: submissionId,
        entityId: scope.entityId,
        storeId: scope.storeId,
        kind: "initial",
        roundNo: 1,
        claimedEntityType: "enterprise",
        proposedStoreName: store.name!,
        proposedIndustryCode: profile.industryCode!,
        proposedCategoryCode: profile.categoryCode!,
        proposedAddressSnapshot: {
          provinceCode: profile.provinceCode,
          cityCode: profile.cityCode,
          districtCode: profile.districtCode,
          detail: profile.addressDetail,
          poiName: profile.poiName,
          latitude: profile.latitude?.toNumber() ?? null,
          longitude: profile.longitude?.toNumber() ?? null,
        },
        contactSnapshot: {
          name: "P95测试联系人",
          phoneMask: testSealer.phone("merchant_user.phone_enc", scope.phone).mask,
          phoneSource: "login",
        },
        declarationConfirmedAt: at,
        declarationVersion: QUALIFICATION_DECLARATION_VERSION,
        approvalRequestId: approvalId,
        submittedAt: at,
        submittedByUserId: scope.merchantUserId,
        closedAt: at,
        outcome: "approved",
        approveMode: "normal",
        createdByUserId: scope.merchantUserId,
        createdAt: at,
        updatedAt: at,
      },
    });
    const doc = await tx.qualificationDoc.create({
      data: {
        id: uuidv7(),
        entityId: scope.entityId,
        storeId: scope.storeId,
        qualificationSubmissionId: submissionId,
        docType: "business_license",
        scope: "entity",
        fileId: file.id,
        origin: "uploaded",
        submittedFieldsEnc: testSealer.text(
          "qualification_doc.submitted_fields_enc",
          JSON.stringify({
            name: store.entity.name,
            uscc,
            subjectType: "enterprise",
            principal: "张测试",
            principalRole: "legal_rep",
            validFrom: "2020-01-01",
            validTo: "long_term",
            address: "测试营业地址",
          }),
        ),
        holderName: store.entity.name,
        certNoEnc: sealed.enc,
        certNoBidx: sealed.bidx,
        certNoMask: sealed.mask,
        subjectType: "enterprise",
        validStartDate: new Date("2020-01-01"),
        isLongTerm: true,
        verdict: "accepted",
        effectiveAt: at,
        uploadedByUserId: scope.merchantUserId,
        createdAt: at,
        updatedAt: at,
      },
    });
    await lockRows(tx, "file_object", [file.id]);
    await runtime.media.link(tx, {
      fileId: file.id,
      refType: "qualification_doc",
      refId: doc.id,
      role: "main",
      entityId: scope.entityId,
      storeId: null,
    });
    await tx.storeProfile.update({
      where: { storeId: scope.storeId },
      data: {
        effectiveQualificationSubmissionId: submissionId,
        firstSubmittedAt: at,
        firstVerifiedAt: at,
        lastDecidedAt: at,
        updatedAt: clock.now(),
      },
    });
  });
  const tenant = createTenant({
    tx: runtime.tx,
    clock,
    flow: runtime.flow,
    assembly: runtime.assembly,
  });
  const service = createProfile({
    ...runtime,
    tenant,
    keyring: () => loadKeyring(runtime.env),
    wechat: support.providers.wechat,
    currentOpenid: async () => {
      throw new Error("P95 原值完整度刷新不应请求内容检查");
    },
  });
  // 空字段请求保留原 contact/媒体/服务分布，由真实 profile 用例派生缓存。
  await service.updateService(
    {
      ctx: createIdentityContext({
        actor: { type: "merchant", id: scope.merchantUserId, client: "weapp" },
      }),
      membership: { ...scope, role: "owner", storeMode: "active" },
      principal: {
        sessionId: scope.merchantUserId,
        merchantUserId: scope.merchantUserId,
        wechatIdentityId: scope.merchantUserId,
        consentStamp: "p95",
      },
    },
    { draft: true, lockVersion: profile.lockVersion },
  );
}

async function completeFileRefs({ support }: { support: M1Support }) {
  const { runtime } = support;
  await runtime.tx.run(async (tx) => {
    const expected = [];
    for (const [refType, spec] of runtime.assembly.portEntries(fileRefTypePort))
      for (const ref of (await spec.readColumns?.(tx)) ?? []) expected.push({ ...ref, refType });
    await lockRows(tx, "file_object", [...new Set(expected.map((ref) => ref.fileId))].sort());
    const files = new Map(
      (
        await tx.fileObject.findMany({ where: { id: { in: expected.map((ref) => ref.fileId) } } })
      ).map((file) => [file.id, file]),
    );
    for (const ref of expected) {
      const file = files.get(ref.fileId);
      if (!file) throw new Error("P95 业务文件列引用不存在的文件");
      await runtime.media.link(tx, {
        ...ref,
        entityId: file.entityId,
        storeId: file.storeId,
      });
    }
  });
}

export async function completeP95Prototype(
  input: { support: M1Support; db: PrismaClient },
  scope: PrototypeScope,
) {
  const { support } = input;
  assertTestDatabaseUrl(support.runtime.env.DATABASE_URL);
  if (
    support.runtime.env.APP_ENV !== "test" ||
    new URL(support.runtime.env.DATABASE_URL).pathname !== `/${support.databaseName}`
  )
    throw new Error("P95 合法图补全仅接受本轮 APPtest 隔离库");
  await completeContent(input);
  await completeP95Qualification(input, scope);
  await completeFileRefs(input);
  return { cloneTables: ["qualification_submission", "qualification_doc"] as const };
}
