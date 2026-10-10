import type { MallConfig } from "@liyoxi/contract";
import { moveId } from "../home/model";

export { mallSearch } from "../home/model";
export function reorderCategories(content: MallConfig, source: string, target: string): MallConfig {
  if (source === "all" || target === "all") return content;
  const keys = moveId(
    content.categories.map((row) => row.key),
    source,
    target,
  );
  return {
    ...content,
    categories: keys.map((key) => content.categories.find((row) => row.key === key)!),
  };
}
export function newCategoryKey() {
  return `category_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
}
