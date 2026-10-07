import type { DictReferenceSource } from "../kernel/index.js";
export const profileDictReferences: DictReferenceSource = {
  types: ["industry", "region", "permit_type"],
  async count(tx, typeKey, codes) {
    const rows = await tx.$queryRawUnsafe<{ code: string; count: number }[]>(
      typeKey === "permit_type"
        ? `SELECT permit_type AS code, count(*)::int AS count FROM qualification_doc WHERE permit_type=ANY($1::text[]) AND removed_at IS NULL GROUP BY permit_type`
        : typeKey === "industry"
          ? `SELECT code,count(DISTINCT store_id)::int AS count FROM store_profile CROSS JOIN LATERAL unnest(ARRAY[industry_code,category_code]) code WHERE code=ANY($1::text[]) GROUP BY code`
          : `SELECT code,count(DISTINCT store_id)::int AS count FROM store_profile CROSS JOIN LATERAL unnest(ARRAY[province_code,city_code,district_code,zone_code]) code WHERE code=ANY($1::text[]) GROUP BY code`,
      codes,
    );
    return new Map(rows.map((row) => [row.code, row.count]));
  },
};
