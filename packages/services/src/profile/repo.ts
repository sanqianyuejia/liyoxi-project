// 本域仓储。字典/员工只读当前数据库值；敏感字段只在这里解密，不流入日志或公开 DTO。
import { IndustryExtSchema, PermitTypeExtSchema } from "@liyoxi/contract";
import type { QualificationDoc, StoreProfile, StoreProfileMedia } from "@liyoxi/db";
import { profileCompleteness } from "@liyoxi/shared/profile";
import { AppError, lockRows } from "../kernel/index.js";
import type { Tx } from "../kernel/index.js";
import { decryptField } from "../security/index.js";
import type { Keyring } from "../security/index.js";

export async function storeOf(tx: Tx, storeId: string) {
  const store = await tx.store.findUnique({ where: { id: storeId }, include: { entity: true } });
  if (!store) throw new AppError("NOT_FOUND");
  return store;
}
export async function dictRef(tx: Tx, type: string, code: string | null | undefined) {
  if (code == null) return null;
  const row = await tx.dictItem.findUnique({
    where: { dictTypeKey_code: { dictTypeKey: type, code } },
    select: { name: true },
  });
  return { code, name: row?.name ?? code };
}
export async function requiredPermits(
  tx: Tx,
  categoryCode: string | null | undefined,
): Promise<string[]> {
  if (!categoryCode) return [];
  const item = await tx.dictItem.findUnique({
    where: { dictTypeKey_code: { dictTypeKey: "industry", code: categoryCode } },
    select: { ext: true },
  });
  return item ? IndustryExtSchema.parse(item.ext).requiredCerts : [];
}
export async function permitSpec(tx: Tx, code: string) {
  const row = await tx.dictItem.findUnique({
    where: { dictTypeKey_code: { dictTypeKey: "permit_type", code } },
  });
  if (!row) throw new AppError("VALIDATION_FAILED");
  return PermitTypeExtSchema.parse(row.ext);
}
export async function ensureProfile(tx: Tx, storeId: string, now: Date) {
  const store = await storeOf(tx, storeId);
  await tx.storeProfile.upsert({
    where: { storeId },
    create: { storeId, entityId: store.entityId, createdAt: now, updatedAt: now },
    update: {},
  });
  await lockRows(tx, "store_profile", [storeId]);
  return tx.storeProfile.findUniqueOrThrow({ where: { storeId } });
}
export const roundInclude = {
  qualificationDocs: { where: { removedAt: null }, orderBy: { createdAt: "asc" as const } },
  approvalRequest: true,
};
type BasicProfile = Pick<
  StoreProfile,
  | "brandName"
  | "industryCode"
  | "categoryCode"
  | "provinceCode"
  | "cityCode"
  | "districtCode"
  | "addressDetail"
  | "businessHours"
  | "storeTel"
  | "avgSpendFen"
  | "sellingPointCodes"
>;
function basicFilled(
  storeName: string | null,
  profile: BasicProfile | null,
  media: readonly Pick<StoreProfileMedia, "mediaGroup" | "fileId">[],
  serviceCount: number,
  usable: (id: string) => boolean,
) {
  return {
    brand_name: !!profile?.brandName,
    store_name: !!storeName,
    industry: !!profile?.industryCode && !!profile.categoryCode,
    address:
      !!profile?.provinceCode &&
      !!profile.cityCode &&
      !!profile.districtCode &&
      !!profile.addressDetail,
    business_hours: Array.isArray(profile?.businessHours) && profile.businessHours.length > 0,
    store_tel: !!profile?.storeTel,
    avg_spend: profile?.avgSpendFen != null,
    door_photos: media.filter((m) => m.mediaGroup === "door" && usable(m.fileId)).length >= 1,
    interior_photos:
      media.filter((m) => m.mediaGroup === "interior" && usable(m.fileId)).length >= 3,
    service_items: serviceCount > 0,
    selling_points: (profile?.sellingPointCodes.length ?? 0) > 0,
  };
}
/** 订购只消费前三步；每次读取当前基础档案和媒体，不读取未消费的资质历史。 */
export async function basicCompleteness(tx: Tx, storeId: string) {
  const [row] = await tx.$queryRaw<
    {
      name: string | null;
      profile: BasicProfile | null;
      media: {
        mediaGroup: string;
        fileId: string;
        status: string | null;
        moderationState: string | null;
      }[];
      serviceCount: number;
    }[]
  >`
    SELECT s.name,
           CASE WHEN p.store_id IS NULL THEN NULL ELSE jsonb_build_object(
             'brandName', p.brand_name, 'industryCode', p.industry_code,
             'categoryCode', p.category_code, 'provinceCode', p.province_code,
             'cityCode', p.city_code, 'districtCode', p.district_code,
             'addressDetail', p.address_detail, 'businessHours', p.business_hours,
             'storeTel', p.store_tel, 'avgSpendFen', p.avg_spend_fen,
             'sellingPointCodes', p.selling_point_codes
           ) END AS profile,
           COALESCE((SELECT jsonb_agg(jsonb_build_object(
             'mediaGroup', m.media_group, 'fileId', m.file_id,
             'status', f.status, 'moderationState', f.moderation_state
           ) ORDER BY m.position ASC)
             FROM store_profile_media m LEFT JOIN file_object f ON f.id = m.file_id
             WHERE m.store_id = s.id AND m.removed_at IS NULL), '[]'::jsonb) AS media,
           (SELECT count(*)::int FROM store_service_item si
             WHERE si.store_id = s.id AND si.removed_at IS NULL) AS "serviceCount"
      FROM store s LEFT JOIN store_profile p ON p.store_id = s.id
      WHERE s.id = ${storeId}::uuid`;
  if (!row) throw new AppError("NOT_FOUND");
  const usable = new Map(
    row.media.map((m) => [m.fileId, m.status === "stored" && m.moderationState !== "block"]),
  );
  return profileCompleteness({
    filled: basicFilled(
      row.name,
      row.profile,
      row.media,
      row.serviceCount,
      (id) => usable.get(id) === true,
    ),
    requiredPermits: [],
    providedPermits: [],
  }).steps.slice(0, 3);
}

export async function snapshot(tx: Tx, storeId: string) {
  const store = await storeOf(tx, storeId);
  const profile = await tx.storeProfile.findUnique({ where: { storeId } });
  const media = await tx.storeProfileMedia.findMany({
    where: { storeId, removedAt: null },
    orderBy: { position: "asc" },
  });
  const services = await tx.storeServiceItem.findMany({
    where: { storeId, removedAt: null },
    orderBy: { position: "asc" },
  });
  const open = await tx.qualificationSubmission.findFirst({
    where: { storeId, closedAt: null },
    include: roundInclude,
  });
  const last = await tx.qualificationSubmission.findFirst({
    where: { storeId, submittedAt: { not: null }, closedAt: { not: null } },
    orderBy: { submittedAt: "desc" },
    include: roundInclude,
  });
  const effective = profile?.effectiveQualificationSubmissionId
    ? await tx.qualificationSubmission.findUnique({
        where: { id: profile.effectiveQualificationSubmissionId },
        include: roundInclude,
      })
    : null;
  const current = open?.kind !== "change" && open ? open : (effective ?? last);
  const permits = await requiredPermits(tx, profile?.categoryCode);
  const fileIds = [
    ...new Set([
      ...media.map((m) => m.fileId),
      ...services.flatMap((s) => (s.imageFileId ? [s.imageFileId] : [])),
      ...(profile?.logoFileId ? [profile.logoFileId] : []),
    ]),
  ];
  const files = new Map(
    (await tx.fileObject.findMany({ where: { id: { in: fileIds } } })).map((file) => [
      file.id,
      file,
    ]),
  );
  const usable = (id: string) =>
    files.get(id)?.status === "stored" && files.get(id)?.moderationState !== "block";
  const docs = current?.qualificationDocs ?? [];
  const completeness = profileCompleteness({
    filled: {
      ...basicFilled(store.name, profile, media, services.length, usable),
      entity_type: store.entity.verificationStatus === "verified" || !!current?.claimedEntityType,
      business_license:
        store.entity.verificationStatus === "verified" ||
        docs.some((d) => d.docType === "business_license"),
      contact: !!profile?.contactName && !!profile.contactPhoneEnc,
      declaration: current?.declarationConfirmedAt != null,
    },
    requiredPermits: permits,
    providedPermits: docs
      .filter((d) => d.docType === "industry_permit")
      .flatMap((d) => (d.permitType ? [d.permitType] : [])),
  });
  return {
    store,
    profile,
    media,
    services,
    files,
    open,
    last,
    effective,
    current,
    permits,
    completeness,
  };
}
export type ProfileSnapshot = Awaited<ReturnType<typeof snapshot>>;
export async function refreshCompleteness(tx: Tx, storeId: string, now: Date) {
  const { completeness } = await snapshot(tx, storeId);
  await tx.storeProfile.update({
    where: { storeId },
    data: {
      completenessPct: completeness.pct,
      requiredFilled: completeness.requiredFilled,
      requiredTotal: completeness.requiredTotal,
      updatedAt: now,
    },
  });
  return completeness;
}
export function submittedFields(
  keyring: Keyring,
  doc: Pick<QualificationDoc, "submittedFieldsEnc" | "reviewedFieldsEnc">,
): Record<string, string> {
  const enc = doc.reviewedFieldsEnc ?? doc.submittedFieldsEnc;
  if (!enc) return {};
  return JSON.parse(
    decryptField(
      keyring,
      doc.reviewedFieldsEnc
        ? "qualification_doc.reviewed_fields_enc"
        : "qualification_doc.submitted_fields_enc",
      enc,
    ),
  ) as Record<string, string>;
}
export const loginPhone = (keyring: Keyring, user: { phoneEnc: string | null }) =>
  user.phoneEnc ? decryptField(keyring, "merchant_user.phone_enc", user.phoneEnc) : null;
export const contactPhone = (keyring: Keyring, profile: StoreProfile) =>
  profile.contactPhoneEnc
    ? decryptField(keyring, "store_profile.contact_phone_enc", profile.contactPhoneEnc)
    : null;
