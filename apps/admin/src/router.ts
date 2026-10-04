import { createRouter } from "@tanstack/react-router";

import type { AppServices } from "./app/services";
import { routeTree } from "./routes/tree";

export function createAppRouter(services: AppServices) {
  const router = createRouter({
    routeTree,
    context: { services },
    defaultPreload: false,
  });
  // 权限刷新后让路由重新走一遍守卫与菜单过滤（PERMISSION_DENIED 的处置，D7 第 5.4 节）
  services.onAccessRefreshed(() => void router.invalidate());
  return router;
}

export type AppRouter = ReturnType<typeof createAppRouter>;

declare module "@tanstack/react-router" {
  interface Register {
    router: AppRouter;
  }
}
