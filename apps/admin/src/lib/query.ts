// 查询缓存策略（D7 第 5.5 节的表）。页面包按数据种类取对应的一组选项，不各写各的。
import { keepPreviousData, QueryClient } from "@tanstack/react-query";

/** 列表：30 秒内不重取；窗口重新聚焦时刷新；翻页保留上一页数据 */
export const LIST_QUERY = {
  staleTime: 30_000,
  refetchOnWindowFocus: true,
  placeholderData: keepPreviousData,
} as const;

/** 队列：30 秒轮询，窗口不可见时暂停；翻页签时保留上一份 */
export const QUEUE_QUERY = {
  staleTime: 0,
  refetchInterval: 30_000,
  refetchIntervalInBackground: false,
  placeholderData: keepPreviousData,
} as const;

/** 菜单角标：60 秒轮询，窗口不可见时暂停 */
export const BADGE_QUERY = {
  staleTime: 0,
  refetchInterval: 60_000,
  refetchIntervalInBackground: false,
} as const;

/** 详情：进入即取最新；带 lockVersion，提交时回传（约定 C52） */
export const DETAIL_QUERY = { staleTime: 0 } as const;

/** 字典、参数元数据、菜单权限：10 分钟；保存后主动失效 */
export const DICT_QUERY = { staleTime: 600_000 } as const;

/**
 * 全局缺省。请求失败不由查询库重试：可重试的错误码在请求层按约定 C27 自动重试过了。
 * 涉及钱与积分的写操作不做乐观更新，等服务端结果（D7 第 5.5 节）。
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: LIST_QUERY.staleTime, refetchOnWindowFocus: true, retry: false },
      mutations: { retry: false },
    },
  });
}
