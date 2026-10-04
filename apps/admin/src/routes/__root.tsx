// 根路由：取权限数据、套外壳。没有登录（权限数据来源返回 null）时不出外壳，只出说明。
import { Alert, Button } from "antd";
import {
  createRootRouteWithContext,
  Outlet,
  useMatches,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";

import { useGlobalState } from "../app/feedback";
import type { AppServices } from "../app/services";
import { AppShell } from "../components/AppShell";
import { FullPageNotice } from "../components/StateBlock";
import {
  breadcrumbOf,
  findPage,
  matchPage,
  selectedMenuKey,
  visibleMenu,
  type AdminPage,
} from "../lib/menu";
import type { AccessSnapshot } from "../lib/permissions";

export interface RouterContext {
  services: AppServices;
}

declare module "@tanstack/react-router" {
  interface StaticDataRouteOption {
    /** 这条路由对应菜单登记表里的哪一页；不给时按地址去登记表里找。样例页借用真实页面的菜单位置 */
    pageKey?: string;
  }
}

export function NotFoundPage() {
  const router = useRouter();
  return (
    <FullPageNotice
      title="页面不存在"
      description="地址可能写错了，或者页面已经下线。"
      action={<Button onClick={() => router.history.push("/")}>返回工作台</Button>}
    />
  );
}

function RootLayout() {
  const { access } = rootRoute.useRouteContext();
  const router = useRouter();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const pageKey = useMatches({
    select: (matches) => matches.map((match) => match.staticData.pageKey).findLast(Boolean),
  });
  const global = useGlobalState();

  if (global.blocked) {
    return <FullPageNotice title="暂时无法访问" description={global.blocked.message} />;
  }
  if (!access) {
    // 登录页在 W1-02；接上之前，生产构建没有权限数据来源，一律停在这里
    return <FullPageNotice title="请先登录" description="登录后才能使用运营管理后台。" />;
  }

  const page: AdminPage | undefined = pageKey ? findPage(pageKey) : matchPage(pathname)?.page;
  return (
    <AppShell
      access={access}
      menu={visibleMenu(access)}
      selectedKey={page ? selectedMenuKey(page) : null}
      crumbs={page ? breadcrumbOf(page) : []}
      notice={
        global.serverBuild ? (
          <Alert
            banner
            type="info"
            title="后台已更新，请刷新页面后继续操作"
            action={
              <Button size="small" onClick={() => window.location.reload()}>
                刷新
              </Button>
            }
          />
        ) : null
      }
      onNavigate={(path) => router.history.push(path)}
    >
      <Outlet />
    </AppShell>
  );
}

export const rootRoute = createRootRouteWithContext<RouterContext>()({
  beforeLoad: async ({ context }): Promise<{ access: AccessSnapshot | null }> => ({
    access: await context.services.loadAccess(),
  }),
  component: RootLayout,
  notFoundComponent: NotFoundPage,
});
