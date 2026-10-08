import { IndustryExtSchema, RegionExtSchema } from "@liyoxi/contract";
import { AppError } from "../kernel/index.js";
import type { Tx } from "../kernel/index.js";
import { basicCompleteness, storeOf, orderProfileFacts, industryDictionary } from "./repo.js";
import type { IndustryFacts } from "./repo.js";

export type StoreGate = "full" | "parallel" | "blocked";
function gateOf(store: {
  lifecycle: string;
  entityLifecycle: string;
  qualificationStatus: string;
  isPrimary: boolean;
}): StoreGate {
  if (store.lifecycle !== "active" || store.entityLifecycle !== "active") return "blocked";
  if (store.qualificationStatus === "verified") return "full";
  return store.isPrimary && store.qualificationStatus === "pending" ? "parallel" : "blocked";
}
const missingOf = (steps: Awaited<ReturnType<typeof basicCompleteness>>) =>
  steps.flatMap((step) => step.missing.map((item) => ({ step: step.step, ...item })));
export interface OrderProfileFacts {
  readonly missing: ReturnType<typeof missingOf>;
  readonly gate: StoreGate;
  readonly industry: IndustryFacts | null;
}
export async function getOrderProfileFacts(tx: Tx, storeId: string): Promise<OrderProfileFacts> {
  const row = await orderProfileFacts(tx, storeId);
  return {
    missing: missingOf(row.steps),
    gate: gateOf(row),
    industry: row.profile
      ? {
          industryCode: row.profile.industryCode,
          categoryCode: row.profile.categoryCode,
          provinceCode: row.profile.provinceCode,
          cityCode: row.profile.cityCode,
          districtCode: row.profile.districtCode,
          zoneCode: row.zoneCode,
          dictionary: row.dictionary,
        }
      : null,
  };
}
export const industryOpenFromOrderFacts = (facts: OrderProfileFacts): boolean =>
  industryIsOpen(facts.industry);
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
  return gateOf(store);
}
export async function assertProfileComplete(tx: Tx, storeId: string) {
  const steps = await basicCompleteness(tx, storeId);
  const missing = missingOf(steps);
  if (missing.length) throw new AppError("STORE_PROFILE_INCOMPLETE", { details: { missing } });
}
export async function industryOpen(tx: Tx, storeId: string): Promise<boolean> {
  const [p] = await tx.$queryRaw<IndustryFacts[]>`
    SELECT p.industry_code AS "industryCode", p.category_code AS "categoryCode",
           p.province_code AS "provinceCode", p.city_code AS "cityCode",
           p.district_code AS "districtCode", p.zone_code AS "zoneCode",
           ${industryDictionary} AS dictionary
    FROM store_profile p WHERE p.store_id = ${storeId}::uuid`;
  return industryIsOpen(p ?? null);
}
function industryIsOpen(p: IndustryFacts | null): boolean {
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
