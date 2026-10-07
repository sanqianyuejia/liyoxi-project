import { IndustryExtSchema, RegionExtSchema } from "@liyoxi/contract";
import { AppError, lockRows } from "../kernel/index.js";
import type { Tx } from "../kernel/index.js";
import type { ProfileDeps, ProfileViewer } from "./context.js";
import type { ProfileSnapshot } from "./repo.js";

export const invalid = (message: string) => new AppError("VALIDATION_FAILED", { message });
export function assertOwner(viewer: ProfileViewer) {
  if (viewer.membership.role !== "owner") throw new AppError("ROLE_FORBIDDEN");
  if (viewer.membership.storeMode !== "active") throw new AppError("STORE_ARCHIVED");
}
export function assertVersion(actual: number, expected: number | null) {
  if (actual !== expected)
    throw new AppError("VERSION_CONFLICT", { details: { lockVersion: actual } });
}
export async function checkContent(
  deps: ProfileDeps,
  viewer: ProfileViewer,
  fields: Record<string, string | null | undefined>,
) {
  const texts = Object.entries(fields).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0,
  );
  if (texts.length === 0) return;
  const openid = await deps.currentOpenid(viewer.principal);
  const rejected = [];
  for (const [path, content] of texts) {
    const result = await deps.wechat.checkText({ openid, scene: "profile", content });
    if (!result.ok) throw new AppError("PROVIDER_UNAVAILABLE");
    if (result.value.verdict !== "pass") rejected.push(path);
  }
  if (rejected.length) throw new AppError("CONTENT_REJECTED", { details: { fields: rejected } });
}
export async function newCode(
  tx: Tx,
  type: string,
  code: string | null | undefined,
  old: string | null | undefined,
  field: string,
  force = false,
) {
  if (code == null || (!force && code === old)) return;
  await tx.$queryRaw`SELECT id FROM dict_item WHERE dict_type_key=${type} AND code=${code} ORDER BY id FOR SHARE`;
  const row = await tx.dictItem.findUnique({
    where: { dictTypeKey_code: { dictTypeKey: type, code } },
  });
  if (!row) throw invalid(`${field} 编码不存在`);
  if (!row.isEnabled && code !== old)
    throw new AppError("DICT_ITEM_DISABLED", { details: { dictTypeKey: type, code } });
  if (
    (type === "industry" && !IndustryExtSchema.parse(row.ext).open) ||
    (type === "region" && !RegionExtSchema.parse(row.ext).opened)
  )
    throw new AppError("INDUSTRY_NOT_OPEN", { details: { field, code } });
  return row;
}
export async function validateBasics(
  tx: Tx,
  values: {
    industryCode?: string | null;
    categoryCode?: string | null;
    address?: {
      provinceCode: string | null;
      cityCode: string | null;
      districtCode: string | null;
      zoneCode: string | null;
    } | null;
  },
  old: ProfileSnapshot["profile"],
  force = false,
) {
  const industry = values.industryCode === undefined ? old?.industryCode : values.industryCode;
  const category = values.categoryCode === undefined ? old?.categoryCode : values.categoryCode;
  await newCode(tx, "industry", industry, old?.industryCode, "industryCode", force);
  await newCode(tx, "industry", category, old?.categoryCode, "categoryCode", force);
  if (
    industry &&
    category &&
    (force || industry !== old?.industryCode || category !== old?.categoryCode)
  ) {
    const [parent, child] = [
      await tx.dictItem.findUnique({
        where: { dictTypeKey_code: { dictTypeKey: "industry", code: industry } },
      }),
      await tx.dictItem.findUnique({
        where: { dictTypeKey_code: { dictTypeKey: "industry", code: category } },
      }),
    ];
    if (!parent || parent.parentCode !== null || child?.parentCode !== industry)
      throw invalid("品类不隶属行业");
  }
  if (values.address) {
    const a = values.address;
    let parent: string | null = null;
    for (const [field, level] of [
      ["provinceCode", 1],
      ["cityCode", 2],
      ["districtCode", 3],
    ] as const) {
      const row = await newCode(tx, "region", a[field], old?.[field], `address.${field}`, force);
      if (a[field]) {
        const item =
          row ??
          (await tx.dictItem.findUnique({
            where: { dictTypeKey_code: { dictTypeKey: "region", code: a[field] } },
          }));
        if (
          !item ||
          RegionExtSchema.parse(item.ext).functionalZone ||
          RegionExtSchema.parse(item.ext).level !== level ||
          (level > 1 && item.parentCode !== parent)
        )
          throw invalid("行政区划层级不符");
      }
      parent = a[field];
    }
    const selectedZone = await newCode(
      tx,
      "region",
      a.zoneCode,
      old?.zoneCode,
      "address.zoneCode",
      force,
    );
    const zone =
      selectedZone ??
      (a.zoneCode
        ? await tx.dictItem.findUnique({
            where: { dictTypeKey_code: { dictTypeKey: "region", code: a.zoneCode } },
          })
        : null);
    if (
      zone &&
      (!RegionExtSchema.parse(zone.ext).functionalZone || zone.parentCode !== a.districtCode)
    )
      throw invalid("功能区不属于所选区县");
  }
}
export async function lockFiles(tx: Tx, ids: readonly (string | null | undefined)[]) {
  await lockRows(
    tx,
    "file_object",
    ids.filter((id): id is string => !!id),
  );
}
export async function newFile(
  tx: Tx,
  viewer: ProfileViewer,
  fileId: string,
  categories: readonly string[],
  scope: "store" | "entity" = "store",
) {
  const file = await tx.fileObject.findUnique({ where: { id: fileId } });
  const refuse = (reason: string): never => {
    throw new AppError("FILE_NOT_USABLE", { details: { fileIds: [fileId], reason } });
  };
  if (!file) return refuse("not_stored");
  if (file.status !== "stored") refuse("not_stored");
  if (file.moderationState === "block") refuse("blocked");
  if (!categories.includes(file.category)) refuse("category_mismatch");
  if (
    file.uploadActorType !== "merchant" ||
    file.uploadActorId !== viewer.principal.merchantUserId ||
    file.scopeType !== scope ||
    file.entityId !== viewer.membership.entityId ||
    (scope === "store" && file.storeId !== viewer.membership.storeId)
  )
    refuse("scope_mismatch");
  return file;
}
export function requiredMissing(
  before: ProfileSnapshot,
  after: ProfileSnapshot,
  step: number,
  draft: boolean,
) {
  const old = before.completeness.steps[step - 1]!;
  const next = after.completeness.steps[step - 1]!;
  if (
    before.store.qualificationStatus !== "unsubmitted" &&
    next.missing.some(
      (m) => !old.missing.some((o) => o.item === m.item && o.permitType === m.permitType),
    )
  )
    throw new AppError("PROFILE_REQUIRED_MISSING");
  if (!draft && next.missing.length)
    throw invalid(`第 ${step} 步必填缺项：${next.missing.map((m) => m.item).join("、")}`);
}
