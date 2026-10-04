// 全局反馈的出口：请求层与路由不在 React 组件里，拿不到 antd 的上下文，
// 由外壳里的 <FeedbackBridge /> 把带主题的通知实例登记到这里。
// 另有两个全局状态：整页拦截（来源 IP 不允许、停机维护）与“后台已更新”。
import type { NotificationInstance } from "antd/es/notification/interface";
import { useSyncExternalStore } from "react";

import type { ApiNotice } from "../lib/api";
import type { ApiFailure } from "../lib/api-errors";

let notifier: NotificationInstance | null = null;

export function setNotifier(instance: NotificationInstance | null): void {
  notifier = instance;
}

/** 右上角通知（规范 第 5.4 节“通知”）；5xx 与编程错误带请求编号后 8 位 */
export function showApiNotice(notice: ApiNotice): void {
  const description = notice.requestIdTail ? `请求编号 ${notice.requestIdTail}` : undefined;
  if (notifier) notifier.error({ title: notice.message, description, placement: "topRight" });
  else console.error(notice.message, description ?? "");
}

export interface GlobalState {
  /** 整页拦截：有值时外壳只显示说明页 */
  blocked: ApiFailure | null;
  /** 服务端的构建号与页面不一致：顶部提示“后台已更新，请刷新” */
  serverBuild: string | null;
}

let state: GlobalState = { blocked: null, serverBuild: null };
const listeners = new Set<() => void>();

function update(patch: Partial<GlobalState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

export const globalState = {
  block: (failure: ApiFailure) => update({ blocked: failure }),
  buildMismatch: (serverBuild: string) => update({ serverBuild }),
  get: (): GlobalState => state,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export function useGlobalState(): GlobalState {
  return useSyncExternalStore(globalState.subscribe, globalState.get, globalState.get);
}
