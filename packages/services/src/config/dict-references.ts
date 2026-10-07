import type { DictReferenceSource } from "../kernel/index.js";
/** 许可类型的字典内引用属于 config，不能由 profile 反向读取。 */
export const configDictReferences: DictReferenceSource = {
  types: ["permit_type"],
  async count(tx, _type, codes) {
    const rows = await tx.$queryRaw<
      { code: string; count: number }[]
    >`SELECT refs.code,count(*)::int AS count FROM dict_item CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(ext->'requiredCerts','[]'::jsonb)) AS refs(code) WHERE dict_type_key='industry' AND refs.code=ANY(${[...codes]}::text[]) GROUP BY refs.code`;
    return new Map(rows.map((row) => [row.code, row.count]));
  },
};
