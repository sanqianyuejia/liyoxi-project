// 登记了但还没实现的页面：首页与通配路由都落到这里，按菜单登记表判定（lib/guard.ts）。
//   登记了且能进 → “页面建设中”；登记了但模块等级不够或开关没开 → 403 页；没登记 → “页面不存在”。
// 页面包合并后，它自己的路由比通配路由优先，这里自然不再接到那个地址。
import { createRoute, notFound, redirect, useRouterState } from "@tanstack/react-router";

import { UnbuiltPage } from "../components/UnbuiltPage";
import { FORBIDDEN_PATH, judgePath } from "../lib/guard";
import { matchPage } from "../lib/menu";
import type { AccessSnapshot } from "../lib/permissions";

import { NotFoundPage, rootRoute } from "./__root";

function guard(access: AccessSnapshot | null, pathname: string): void {
  // 没登录时根布局只出“请先登录”，不往下判
  if (!access) return;
  const verdict = judgePath(access, pathname);
  if (verdict === "forbidden") throw redirect({ to: FORBIDDEN_PATH });
  if (verdict === "not-found") throw notFound();
}

function RegisteredPage() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const matched = matchPage(pathname);
  return matched ? <UnbuiltPage page={matched.page} /> : <NotFoundPage />;
}

export const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: ({ context, location }) => guard(context.access, location.pathname),
  component: RegisteredPage,
});

export const splatRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "$",
  beforeLoad: ({ context, location }) => guard(context.access, location.pathname),
  component: RegisteredPage,
});
