// 样例路由（任务书 第 11 节第 4 项）：三种骨架各一页，另有一页整行可点的表格（筛选表格骨架的 onRowClick）、
// 一页长表单（提交有错时滚到第一个出错的字段），只用夹具数据，给冒烟与看样用。W0-29 的看样页另建。
// 生产构建不包含样例页：__LYX_DEV_FIXTURES__ 为 false 时页面组件与夹具整段被摇掉，
// 这里只剩几条访问即“页面不存在”的空路由（scripts/check-build.mjs 断言产物里没有夹具的标记）。
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

/** 整行可点的表格样例（行里另有文字链与按钮；点一行开抽屉）：借用“订购单与付款单”的菜单位置 */
export const devRowsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/dev/rows",
  staticData: { pageKey: "order.list" },
  validateSearch: passthrough,
  beforeLoad: devOnly,
  component: __LYX_DEV_FIXTURES__
    ? lazyRouteComponent(() => import("../../dev/RowsSample"), "RowsSample")
    : undefined,
});

/** 表单样例（一张比一屏长的表单，提交有错时滚到第一个出错的字段）：借用“员工账号”的菜单位置 */
export const devFormRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/dev/form",
  staticData: { pageKey: "system.staff" },
  validateSearch: passthrough,
  beforeLoad: devOnly,
  component: __LYX_DEV_FIXTURES__
    ? lazyRouteComponent(() => import("../../dev/FormSample"), "FormSample")
    : undefined,
});

export const devRoutes = [
  devTableRoute,
  devQueueRoute,
  devDetailRoute,
  devRowsRoute,
  devFormRoute,
] as const;
