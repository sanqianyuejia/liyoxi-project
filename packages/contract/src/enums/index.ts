// @liyoxi/contract/enums：全库枚举，纯常量子路径。小程序与 shared 从这里拿取值，带不进 Zod 运行时：
// 本入口可达的文件不得 import zod、@hono/zod-openapi、hono（契约自测静态扫描）。Zod 枚举在 zod.ts，只从包入口给出。
// 一个模块一个文件，跨模块共用的在 shared.ts。汇总是自动收集的：加一个模块文件，在下面照样加两行；
// 漏加时契约自测会红（目录里的文件与这里收的要一一对应）。
// 与库的对账：pnpm enums:check（库里每条“列取值集合”形态的 CHECK ↔ 这里绑定了“表.列”的枚举，取值集合相等）。
import type { EnumDef } from "./define.js";
import * as shared from "./shared.js";

export { defineEnum } from "./define.js";
export type { EnumDef, EnumValue } from "./define.js";
export * from "./shared.js";

const SOURCES = { shared };

const isEnumDef = (value: unknown): value is EnumDef =>
  typeof value === "object" &&
  value !== null &&
  "name" in value &&
  "columns" in value &&
  "values" in value;

/** 按文件汇总：键是模块名（services 的模块），另有 shared 一份是跨模块共用的 */
export const ENUMS_BY_MODULE: Readonly<Record<string, readonly EnumDef[]>> = Object.fromEntries(
  Object.entries(SOURCES).map(([module, exported]) => [
    module,
    Object.values(exported).filter(isEnumDef),
  ]),
);

/** 全部枚举 */
export const ENUMS: readonly EnumDef[] = Object.values(ENUMS_BY_MODULE).flat();

let byColumn: Map<string, EnumDef> | undefined;

/** 按库里的“表.列”找它用的枚举；没有绑定的列返回 undefined */
export function enumByColumn(column: string): EnumDef | undefined {
  byColumn ??= new Map(ENUMS.flatMap((def) => def.columns.map((bound) => [bound, def] as const)));
  return byColumn.get(column);
}
