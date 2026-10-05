// 路由登记入口。669 条路由元数据已由 routemap.json 接管（W0-10）：一份接口文档一个目录（docs.ts 汇总），
// 一个顶层资源一个文件，现在都是“只有元数据”的形态；各域的请求与响应结构随该域第一个后端 PR 补
//（把 merchantMeta(...) 换成 merchantRoute(...) 并补 request、responses）。
// 往后加路由：在所属文档目录的资源文件里写好并导出，新文件加进该目录的 index.ts；
// 归属的里程碑写进 milestones.ts；同 PR 改 routemap.json 与分组文档，pnpm contract:docs-check 对账。
import { buildRouteCatalog } from "./catalog.js";
import { ROUTE_DOCS } from "./docs.js";
import { ROUTE_PLACEMENTS } from "./milestones.js";
import { defineRouteRegistry } from "./registry.js";

export * from "./builders.js";
export * from "./catalog.js";
export * from "./doc.js";
export * from "./meta-only.js";
export * from "./meta.js";
export * from "./registry.js";
export * from "./resource-paths.js";
export { pathParamNames, routeProblems, type RouteCheckInput } from "./validate.js";
// W0-22b：按 operationId 的两张登记——限流档位（约定 C68）、三段式用例（约定 C51）
export * from "./rate-limits.js";
export * from "./three-phase.js";
export { ROUTE_DOCS, ROUTE_PLACEMENTS };

/** 全部路由、只有元数据的路由与只登记的条目 */
export const routeRegistry = defineRouteRegistry({
  routes: ROUTE_DOCS.flatMap((doc) => doc.routes),
  metaOnly: ROUTE_DOCS.flatMap((doc) => doc.metaOnly),
  registryOnly: ROUTE_DOCS.flatMap((doc) => doc.registryOnly),
});

/** 有结构的路由：生成脚本据此出三份 OpenAPI；api 据此注册处理器 */
export const allRoutes = routeRegistry.routes;

/** 只有元数据、还没有结构的路由：不进 OpenAPI，api 不挂 */
export const allMetaOnlyRoutes = routeRegistry.metaOnly;

/** 只登记的条目（探活）：不进 OpenAPI */
export const allRegistryOnly = routeRegistry.registryOnly;

/** 路由清单：一条路由一行，带文档、版本、里程碑；生成物 generated/routes.json 就是它 */
export const routeCatalog = buildRouteCatalog(ROUTE_DOCS, ROUTE_PLACEMENTS);
