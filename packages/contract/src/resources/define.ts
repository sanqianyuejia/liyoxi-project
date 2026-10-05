// 资源登记的声明形态（约定 C9–C11）：资源名与数据表的对应。
// 一张表只对应一个资源名，三端同名；路径参数名全仓唯一；视图别名逐条登记，没登记的别名不放行。
// 这里只登记数据。“路径里的每个资源段都在登记表里、参数名与登记一致”要对着路由查，随路由元数据（W0-10）。
// 纯常量：本文件只引类型，不引任何包。
import type { RouteGroup } from "../routes/meta.js";

export interface ResourceDef<R extends string = string> {
  /** 数据表（最终表名）。不对应单表的为 null：只读聚合视图、命名空间、无表的动作资源、回调入口、V1.1 占位 */
  readonly table: string | null;
  /** 资源名：路径里的资源段，短横线小写复数。回调入口带渠道前缀（如 wechatpay/transactions） */
  readonly resource: R;
  /** 路径参数名，驼峰，以 Id 结尾；不按 id 访问的为 null */
  readonly param: string | null;
  /** 出现在哪几组接口里 */
  readonly surfaces: readonly RouteGroup[];
  /** 登记过的视图别名：完整路径，写法同约定，不带 /api/v1 */
  readonly aliases: readonly string[];
}

/** 一个文件的资源登记 */
export interface ResourceGroup<R extends string = string> {
  /** 表所属的 services 模块，与文件名相同；没有表的那一份为 null */
  readonly module: string | null;
  readonly resources: readonly ResourceDef<R>[];
}

/** 一个模块一个文件，各调一次 */
export function defineResources<const R extends string>(
  module: string | null,
  resources: readonly ResourceDef<R>[],
): ResourceGroup<R> {
  return { module, resources };
}

/** 一个资源：表、资源名、参数名、端、别名（没有不写） */
export function resource<const R extends string>(
  table: string | null,
  name: R,
  param: string | null,
  surfaces: readonly RouteGroup[],
  aliases: readonly string[] = [],
): ResourceDef<R> {
  return { table, resource: name, param, surfaces, aliases };
}
