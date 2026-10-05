// 商家端：账号与登录 · 协议与同意的结构（docs/api/m01-account.md 第 2.5、2.7、2.9–2.11 节；W1-03）。
// PendingConsent、ConsentInput、DeviceInfo 由本文件定义，登录与引导（W1-04）引用，不另写一份。
// 结构名不用 AgreementConsentItem：a09 的同意记录检索已用这个名字（约定 C74）。
import {
  CursorQuerySchema,
  IdSchema,
  InstantSchema,
  cursorPage,
  openEnum,
  orNull,
} from "../../common/index.js";
import {
  AGREEMENT_CONSENT_BIZ_TYPE,
  AGREEMENT_CONSENT_METHOD,
  AGREEMENT_CONSENT_MODE,
  AGREEMENT_CONSENT_SCENE,
  AGREEMENT_SUBJECT_KIND,
} from "../../enums/index.js";
import { zodEnum } from "../../enums/zod.js";
import { z } from "../../zod.js";

/** 协议键：小写蛇形，不超过 24 字符（13 分组 第 2.10 节 ck_agreement_key、ck_agreement_text_len） */
export const AgreementKeySchema = z
  .string()
  .max(24)
  .regex(/^[a-z][a-z0-9_]*$/, "协议键须为小写蛇形名");

/** 签署场景：请求里是闭集（筛选、提交） */
export const ConsentSceneSchema = zodEnum(AGREEMENT_CONSENT_SCENE);

const VERSION_LABEL = z.string().regex(/^v\d+\.\d+$/, "版本号须形如 v1.1");

// ---------- 2.5 PendingConsent ----------

export const PendingConsentSchema = z
  .object({
    agreementKey: z.string(),
    agreementVersionId: IdSchema,
    name: z.string(),
    versionLabel: VERSION_LABEL,
    effectiveAt: InstantSchema,
    summary: z.string(),
  })
  .openapi("PendingConsent");
export type PendingConsent = z.infer<typeof PendingConsentSchema>;

// ---------- 2.7 请求结构 ----------

export const ConsentInputSchema = z
  .object({ agreementKey: AgreementKeySchema, agreementVersionId: IdSchema })
  .openapi("ConsentInput");
export type ConsentInput = z.infer<typeof ConsentInputSchema>;

/** 设备快照：端上取不到的键省略。小程序版本号取请求头 X-Client-Version，不在这里 */
export const DeviceInfoSchema = z
  .object({
    model: z.string().max(64).optional(),
    system: z.string().max(64).optional(),
    wechatVersion: z.string().max(32).optional(),
    sdkVersion: z.string().max(32).optional(),
  })
  .openapi("DeviceInfo");
export type DeviceInfo = z.infer<typeof DeviceInfoSchema>;

// ---------- 2.9 协议 ----------

export const AgreementVersionBriefSchema = z
  .object({
    agreementVersionId: IdSchema,
    versionLabel: VERSION_LABEL,
    effectiveAt: InstantSchema,
    summary: z.string(),
    isReconsentRequired: z.boolean(),
  })
  .openapi("AgreementVersionBrief");
export type AgreementVersionBrief = z.infer<typeof AgreementVersionBriefSchema>;

export const AgreementCurrentSchema = z
  .object({
    agreementKey: z.string(),
    name: z.string(),
    subjectKind: openEnum(AGREEMENT_SUBJECT_KIND.values),
    consentMode: openEnum(AGREEMENT_CONSENT_MODE.values),
    scenes: z.array(openEnum(AGREEMENT_CONSENT_SCENE.values)),
    currentVersion: orNull(AgreementVersionBriefSchema),
    upcomingVersion: orNull(AgreementVersionBriefSchema),
  })
  .openapi("AgreementCurrent");
export type AgreementCurrent = z.infer<typeof AgreementCurrentSchema>;

/** phase 是按生效时间现算的阶段，不是簿记列 agreement_version.status */
export const AGREEMENT_VERSION_PHASES = ["upcoming", "current", "superseded"] as const;
export type AgreementVersionPhase = (typeof AGREEMENT_VERSION_PHASES)[number];

export const AgreementVersionDetailSchema = z
  .object({
    agreementVersionId: IdSchema,
    agreementKey: z.string(),
    name: z.string(),
    versionLabel: VERSION_LABEL,
    major: z.int(),
    minor: z.int(),
    phase: z.enum(AGREEMENT_VERSION_PHASES),
    effectiveAt: InstantSchema,
    summary: z.string(),
    isReconsentRequired: z.boolean(),
    contentHtml: orNull(z.string()),
    contentSha256: z.string().regex(/^[0-9a-f]{64}$/),
    pdf: z.object({ url: z.string(), expiresAt: InstantSchema }),
  })
  .openapi("AgreementVersionDetail");
export type AgreementVersionDetail = z.infer<typeof AgreementVersionDetailSchema>;

/** m.agreement.list 的查询参数：两个筛选都不传即全部协议 */
export const AgreementListQuerySchema = CursorQuerySchema.extend({
  /** 多值逗号分隔，至多 7 个（约定 C45） */
  agreementKey: z
    .string()
    .regex(/^[a-z][a-z0-9_]*(?:,[a-z][a-z0-9_]*){0,6}$/, "协议键多值以逗号分隔，至多 7 个")
    .optional(),
  scene: ConsentSceneSchema.optional(),
});
export const AgreementListSchema = cursorPage(AgreementCurrentSchema);

export const AgreementVersionParamsSchema = z.object({ agreementVersionId: IdSchema });

// ---------- 2.10 已签署协议 ----------

const consentRecordForClerkShape = {
  /** agreement_consent.seq 的十进制字符串（约定 C33） */
  consentNo: z.string().regex(/^\d+$/),
  consentedAt: InstantSchema,
  scene: openEnum(AGREEMENT_CONSENT_SCENE.values),
  method: openEnum(AGREEMENT_CONSENT_METHOD.values),
  versionLabel: VERSION_LABEL,
};

/** 店员视图：不带任何交易单号（约定 C57） */
export const ConsentRecordForClerkSchema = z
  .strictObject(consentRecordForClerkShape)
  .openapi("ConsentRecordForClerk");

export const ConsentRecordSchema = z
  .object({
    ...consentRecordForClerkShape,
    bizType: orNull(openEnum(AGREEMENT_CONSENT_BIZ_TYPE.values)),
    bizNo: orNull(z.string()),
    bizTitle: orNull(z.string()),
  })
  .openapi("ConsentRecord");
export type ConsentRecord = z.infer<typeof ConsentRecordSchema>;
export type ConsentRecordForClerk = z.infer<typeof ConsentRecordForClerkSchema>;

const signedAgreementShape = {
  agreementKey: z.string(),
  name: z.string(),
  subjectKind: openEnum(AGREEMENT_SUBJECT_KIND.values),
  consentedVersion: z.object({
    agreementVersionId: IdSchema,
    versionLabel: VERSION_LABEL,
    effectiveAt: InstantSchema,
  }),
  currentVersionId: orNull(IdSchema),
  isCurrentVersionConsented: z.boolean(),
};

export const SignedAgreementItemSchema = z
  .object({
    ...signedAgreementShape,
    latestConsent: ConsentRecordSchema,
    firstConsent: ConsentRecordSchema,
  })
  .openapi("SignedAgreementItem");
export type SignedAgreementItem = z.infer<typeof SignedAgreementItemSchema>;

export const SignedAgreementItemForClerkSchema = z
  .object({
    ...signedAgreementShape,
    latestConsent: ConsentRecordForClerkSchema,
    firstConsent: ConsentRecordForClerkSchema,
  })
  .openapi("SignedAgreementItemForClerk");
export type SignedAgreementItemForClerk = z.infer<typeof SignedAgreementItemForClerkSchema>;

const signedFilterShape = {
  subjectKind: z.enum(["user", "entity"]).optional(),
  agreementKey: AgreementKeySchema.optional(),
};
export const SignedAgreementListQuerySchema = CursorQuerySchema.extend(signedFilterShape);
/** 计数的查询参数同列表，去掉分页 */
export const SignedAgreementSummaryQuerySchema = z.object(signedFilterShape);

/** 按 viewerRole 判别（约定 C55）：老板与店员两种形状 */
export const SignedAgreementListSchema = z.discriminatedUnion("viewerRole", [
  cursorPage(SignedAgreementItemSchema).extend({ viewerRole: z.literal("owner") }),
  cursorPage(SignedAgreementItemForClerkSchema).extend({ viewerRole: z.literal("clerk") }),
]);
export type SignedAgreementList = z.infer<typeof SignedAgreementListSchema>;

// ---------- 2.11 其他响应结构 ----------

export const AgreementConsentCreateBodySchema = z.object({
  consents: z.array(ConsentInputSchema).min(1).max(2),
  device: DeviceInfoSchema.optional(),
});

export const AgreementConsentReceiptSchema = z
  .object({
    consents: z.array(
      z.object({
        agreementConsentId: IdSchema,
        consentNo: z.string().regex(/^\d+$/),
        agreementKey: z.string(),
        agreementVersionId: IdSchema,
        consentedAt: InstantSchema,
      }),
    ),
    pendingConsents: z.array(PendingConsentSchema),
  })
  .openapi("AgreementConsentReceipt");
export type AgreementConsentReceipt = z.infer<typeof AgreementConsentReceiptSchema>;

export const AgreementConsentSummarySchema = z
  .object({ all: z.int().min(0) })
  .openapi("AgreementConsentSummary");
