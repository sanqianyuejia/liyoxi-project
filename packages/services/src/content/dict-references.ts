import type { DictReferenceSource } from "../kernel/index.js";
export const contentDictReferences: DictReferenceSource = {
  types: ["industry"],
  async count(tx, _typeKey, codes) {
    const rows = await tx.$queryRawUnsafe<{ code: string; count: number }[]>(
      `SELECT code,count(DISTINCT id)::int AS count FROM drama CROSS JOIN LATERAL unnest(industry_codes) code WHERE archived_at IS NULL AND code=ANY($1::text[]) GROUP BY code`,
      codes,
    );
    return new Map(rows.map((row) => [row.code, row.count]));
  },
};
