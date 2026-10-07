import { defineKeyedPort } from "../assembly/index.js";
import type { Assembly } from "../assembly/index.js";
import type { Tx } from "../tx.js";
/** 引用由事实所属模块读取；没登记的类型没有覆盖，不以零计数假装已实现。 */
export interface DictReferenceSource {
  readonly types: readonly string[];
  count(tx: Tx, typeKey: string, codes: readonly string[]): Promise<ReadonlyMap<string, number>>;
}
export const dictReferencesPort = defineKeyedPort<DictReferenceSource>("config.dict_references");
export function dictReferencesOf(assembly: Pick<Assembly, "portEntries">) {
  const sources = assembly.portEntries(dictReferencesPort);
  return {
    async count(tx: Tx, typeKey: string, codes: readonly string[]) {
      const covered = [...sources.values()].filter((source) => source.types.includes(typeKey));
      if (!covered.length) return null;
      const totals = new Map(codes.map((code) => [code, 0]));
      for (const source of covered)
        for (const [code, count] of await source.count(tx, typeKey, codes)) {
          if (!Number.isSafeInteger(count) || count < 0)
            throw new TypeError("字典引用计数必须为非负整数");
          totals.set(code, (totals.get(code) ?? 0) + count);
        }
      return totals;
    },
  };
}
