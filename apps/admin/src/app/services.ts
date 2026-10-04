// 应用级的单例：查询缓存、权限数据来源、请求客户端。页面包从这里取，不各建各的。
import type { paths as AdminPaths } from "@liyoxi/contract/types/admin";
import { queryOptions, type QueryClient } from "@tanstack/react-query";
import createQueryHooks, { type OpenapiQueryClient } from "openapi-react-query";

import { createAdminApi, type AdminApi } from "../lib/api";
import { BUILD_NUMBER } from "../lib/build";
import { NO_ACCESS_SOURCE, type AccessSnapshot, type AccessSource } from "../lib/permissions";
import { createQueryClient, DICT_QUERY } from "../lib/query";

import { globalState, showApiNotice } from "./feedback";

export const ACCESS_QUERY_KEY = ["admin", "access"] as const;

export interface AppServices {
  queryClient: QueryClient;
  api: AdminApi<AdminPaths>;
  /**
   * 带类型的查询钩子（openapi-react-query）：query.useQuery("get", "/admin/…", { params })，
   * 路径、参数、响应都按契约推出。它用的就是 api.client，请求头与统一错误处置一样生效
   */
  query: OpenapiQueryClient<AdminPaths>;
  /** 权限数据来源：缺省是“没有登录”；W1-02 接上 GET /admin/auth/me，夹具只在开发与测试构建里换上 */
  setAccessSource(source: AccessSource): void;
  loadAccess(): Promise<AccessSnapshot | null>;
  /** 路由建好后登记：权限刷新后要让路由重新走一遍守卫 */
  onAccessRefreshed(listener: () => void): void;
}

export function createAppServices(): AppServices {
  const queryClient = createQueryClient();
  let accessSource: AccessSource = NO_ACCESS_SOURCE;
  let accessRefreshed: () => void = () => {};

  const accessQuery = () =>
    queryOptions({
      queryKey: ACCESS_QUERY_KEY,
      queryFn: () => accessSource.load(),
      ...DICT_QUERY,
    });

  const api = createAdminApi({
    build: BUILD_NUMBER,
    handlers: {
      // 登录页在 W1-02；这里只负责带着当前地址过去
      redirectToLogin() {
        const current = `${window.location.pathname}${window.location.search}`;
        window.location.assign(`/login?redirect=${encodeURIComponent(current)}`);
      },
      // 再验证弹层在 W1-02；接上之前一律算没通过，把 403 交还调用方
      stepUp: () => Promise.resolve(false),
      refreshAccess() {
        void queryClient.invalidateQueries({ queryKey: ACCESS_QUERY_KEY }).then(accessRefreshed);
      },
      invalidateQueries() {
        void queryClient.invalidateQueries({
          predicate: (query) => query.queryKey[1] !== ACCESS_QUERY_KEY[1],
        });
      },
      notify: showApiNotice,
      showBlocked: globalState.block,
      buildMismatch: globalState.buildMismatch,
    },
  });

  return {
    queryClient,
    api,
    query: createQueryHooks(api.client),
    setAccessSource(source) {
      accessSource = source;
    },
    loadAccess: () => queryClient.ensureQueryData(accessQuery()),
    onAccessRefreshed(listener) {
      accessRefreshed = listener;
    },
  };
}
