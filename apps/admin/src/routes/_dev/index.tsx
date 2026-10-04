// 样例路由（任务书 第 11 节第 4 项）：三种骨架各一页，只用夹具数据，给冒烟与看样用。W0-29 的看样页另建。
// 生产构建不包含样例页：__LYX_DEV_FIXTURES__ 为 false 时页面组件与夹具整段被摇掉，
// 这里只剩三条访问即“页面不存在”的空路由（scripts/check-build.mjs 断言产物里没有夹具的标记）。
// 本文件会进生产构建，不得静态引入 src/dev/ 下的任何模块。
import { createRoute, lazyRouteComponent, notFound } from "@tanstack/react-router";

import { rootRoute } from "../__root";

const devOnly = (): void => {
  if (!__LYX_DEV_FIXTURES__) throw notFound();
};

/** 查询参数原样放行：筛选、页码这些由样例页按各自的骨架去读（lib/table-search.ts、lib/queue.ts） */
const passthrough = (raw: Record<string, unknown>): Record<string, unknown> => raw;

/** 筛选表格样例：借用“商家列表”的菜单位置 */
export const devTableRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/dev/table",
  staticData: { pageKey: "merchant.list" },
  validateSearch: passthrough,
  beforeLoad: devOnly,
  component: __LYX_DEV_FIXTURES__
    ? lazyRouteComponent(() => import("../../dev/TableSample"), "TableSample")
    : undefined,
});

/** 审核工作台样例：借用“资质审核”的菜单位置 */
export const devQueueRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/dev/queue",
  staticData: { pageKey: "merchant.review" },
  validateSearch: passthrough,
  beforeLoad: devOnly,
  component: __LYX_DEV_FIXTURES__
    ? lazyRouteComponent(() => import("../../dev/QueueSample"), "QueueSample")
    : undefined,
});

/** 详情页样例：借用“商家详情”的菜单位置（父列表保持选中） */
export const devDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/dev/detail/$storeId",
  staticData: { pageKey: "merchant.detail" },
  validateSearch: passthrough,
  beforeLoad: devOnly,
  component: __LYX_DEV_FIXTURES__
    ? lazyRouteComponent(() => import("../../dev/DetailSample"), "DetailSample")
    : undefined,
});

export const devRoutes = [devTableRoute, devQueueRoute, devDetailRoute] as const;
