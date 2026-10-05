// 资源登记表（约定 C10；docs/api/working/resources.json 落地到契约的那一份）。
// 只有服务端与契约自测用，不开子路径，从包入口给出。
// 对账：pnpm api-registries:check（表、资源名、参数名、端、别名与 resources.json 0 差异）。
import type { ResourceDef, ResourceGroup } from "./define.js";
import { RESOURCE_GROUPS } from "./groups.js";

export type { ResourceDef, ResourceGroup } from "./define.js";
export { RESOURCE_GROUPS } from "./groups.js";

/** 逐个文件取资源名再并起来 */
type NameOf<G> = G extends ResourceGroup<infer R> ? R : never;

/** 已登记的资源名 */
export type ResourceName = NameOf<(typeof RESOURCE_GROUPS)[number]>;

/** 汇总里的一项：登记项加上表所属的模块（没有表的为 null） */
export type RegisteredResource = ResourceDef<ResourceName> & { readonly module: string | null };

/** 全部资源登记 */
export const RESOURCES = RESOURCE_GROUPS.flatMap((group: ResourceGroup) =>
  group.resources.map((item) => ({ ...item, module: group.module })),
) as readonly RegisteredResource[];

/** 按表名找它的资源；这张表没有对外的资源时返回 undefined */
export function resourceByTable(table: string): RegisteredResource | undefined {
  return RESOURCES.find((item) => item.table === table);
}

/** 按资源名找登记项 */
export function resourceByName(name: string): RegisteredResource | undefined {
  return RESOURCES.find((item) => item.resource === name);
}

/** 登记过的全部视图别名 */
export const RESOURCE_ALIASES: readonly string[] = RESOURCES.flatMap((item) => item.aliases);
