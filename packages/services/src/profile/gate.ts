import { IndustryExtSchema, RegionExtSchema } from "@liyoxi/contract";
import { AppError } from "../kernel/index.js";
import type { Tx } from "../kernel/index.js";
import { basicCompleteness, storeOf } from "./repo.js";

export type StoreGate = "full" | "parallel" | "blocked";
export async function storeGate(tx: Tx, storeId: string): Promise<StoreGate> {
  const [store] = await tx.$queryRaw<
    {
      lifecycle: string;
      entityLifecycle: string;
      qualificationStatus: string;
      isPrimary: boolean;
    }[]
  >`
    SELECT s.lifecycle, e.lifecycle AS "entityLifecycle",
           s.qualification_status AS "qualificationStatus", s.is_primary AS "isPrimary"
    FROM store s JOIN entity e ON e.id = s.entity_id
    WHERE s.id = ${storeId}::uuid`;
  if (!store) throw new AppError("NOT_FOUND");
  if (store.lifecycle !== "active" || store.entityLifecycle !== "active") return "blocked";
  if (store.qualificationStatus === "verified") return "full";
  return store.isPrimary && store.qualificationStatus === "pending" ? "parallel" : "blocked";
}
export async function assertProfileComplete(tx: Tx, storeId: string) {
  const steps = await basicCompleteness(tx, storeId);
  const missing = steps.flatMap((step) =>
    step.missing.map((item) => ({ step: step.step, ...item })),
  );
  if (missing.length) throw new AppError("STORE_PROFILE_INCOMPLETE", { details: { missing } });
}
export async function industryOpen(tx: Tx, storeId: string): Promise<boolean> {
  const [p] = await tx.$queryRaw<
    {
      industryCode: string | null;
      categoryCode: string | null;
      provinceCode: string | null;
      cityCode: string | null;
      districtCode: string | null;
      zoneCode: string | null;
      dictionary: { dictTypeKey: string; code: string; ext: unknown }[];
    }[]
  >`
    SELECT p.industry_code AS "industryCode", p.category_code AS "categoryCode",
           p.province_code AS "provinceCode", p.city_code AS "cityCode",
           p.district_code AS "districtCode", p.zone_code AS "zoneCode",
           COALESCE((SELECT jsonb_agg(jsonb_build_object(
             'dictTypeKey', d.dict_type_key, 'code', d.code, 'ext', d.ext))
             FROM dict_item d WHERE d.code <> '' AND (
               (d.dict_type_key = 'industry' AND d.code = ANY(ARRAY[p.industry_code, p.category_code]))
               OR (d.dict_type_key = 'region' AND d.code = ANY(ARRAY[
                 p.province_code, p.city_code, p.district_code, p.zone_code]))
             )), '[]'::jsonb) AS dictionary
    FROM store_profile p WHERE p.store_id = ${storeId}::uuid`;
  if (!p) return false;
  const industryCodes = [p.industryCode, p.categoryCode];
  const regionCodes = [
    p.provinceCode,
    p.cityCode,
    p.districtCode,
    ...(p.zoneCode ? [p.zoneCode] : []),
  ];
  const current = new Map(p.dictionary.map((row) => [`${row.dictTypeKey}:${row.code}`, row]));
  // 读取批量化，但解析/短路顺序仍是行业、品类、省市区、功能区。
  for (const code of industryCodes) {
    if (!code) return false;
    const row = current.get(`industry:${code}`);
    if (!row || !IndustryExtSchema.parse(row.ext).open) return false;
  }
  for (const code of regionCodes) {
    if (!code) return false;
    const row = current.get(`region:${code}`);
    if (!row || !RegionExtSchema.parse(row.ext).opened) return false;
  }
  return true;
}
export async function storeLocation(tx: Tx, storeId: string) {
  await storeOf(tx, storeId);
  const p = await tx.storeProfile.findUnique({ where: { storeId } });
  return {
    cityCode: p?.cityCode ?? null,
    industryCode: p?.industryCode ?? null,
    categoryCode: p?.categoryCode ?? null,
  };
}
