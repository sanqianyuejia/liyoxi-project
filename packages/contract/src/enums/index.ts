// @liyoxi/contract/enums：全库枚举，纯常量子路径。小程序与 shared 从这里拿取值，带不进 Zod 运行时：
// 本入口可达的文件不得 import zod、@hono/zod-openapi、hono（契约自测静态扫描）。Zod 枚举在 zod.ts，只从包入口给出。
// 一个模块一个文件，跨模块共用的在 shared.ts。汇总是自动收集的：加一个模块文件，在下面照样加三行；
// 漏加时契约自测会红（目录里的文件与这里收的要一一对应）。
// 与库的对账：pnpm enums:check（库里每条“列取值集合”形态的 CHECK ↔ 这里绑定了“表.列”的枚举，取值集合相等）。
import type { EnumDef } from "./define.js";
import * as shared from "./shared.js";
import * as ad from "./ad.js";
import * as analytics from "./analytics.js";
import * as audit from "./audit.js";
import * as billing from "./billing.js";
import * as config from "./config.js";
import * as content from "./content.js";
import * as delivery from "./delivery.js";
import * as docs from "./docs.js";
import * as events from "./events.js";
import * as exportsModule from "./exports.js";
import * as identity from "./identity.js";
import * as kernel from "./kernel.js";
import * as media from "./media.js";
import * as notify from "./notify.js";
import * as ops from "./ops.js";
import * as order from "./order.js";
import * as portal from "./portal.js";
import * as profile from "./profile.js";
import * as publish from "./publish.js";
import * as reports from "./reports.js";
import * as security from "./security.js";
import * as sla from "./sla.js";
import * as staff from "./staff.js";
import * as support from "./support.js";
import * as tenant from "./tenant.js";
import * as timers from "./timers.js";

export { defineEnum } from "./define.js";
export type { EnumDef, EnumValue } from "./define.js";
export * from "./shared.js";
export * from "./ad.js";
export * from "./analytics.js";
export * from "./audit.js";
export * from "./billing.js";
export * from "./config.js";
export * from "./content.js";
export * from "./delivery.js";
export * from "./docs.js";
export * from "./events.js";
export * from "./exports.js";
export * from "./identity.js";
export * from "./kernel.js";
export * from "./media.js";
export * from "./notify.js";
export * from "./ops.js";
export * from "./order.js";
export * from "./portal.js";
export * from "./profile.js";
export * from "./publish.js";
export * from "./reports.js";
export * from "./security.js";
export * from "./sla.js";
export * from "./staff.js";
export * from "./support.js";
export * from "./tenant.js";
export * from "./timers.js";

const SOURCES = {
  shared,
  ad,
  analytics,
  audit,
  billing,
  config,
  content,
  delivery,
  docs,
  events,
  exports: exportsModule,
  identity,
  kernel,
  media,
  notify,
  ops,
  order,
  portal,
  profile,
  publish,
  reports,
  security,
  sla,
  staff,
  support,
  tenant,
  timers,
};

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
