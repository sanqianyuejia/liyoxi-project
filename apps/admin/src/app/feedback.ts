// 全局反馈的出口：请求层与路由不在 React 组件里，拿不到 antd 的上下文，
// 由外壳里的 <FeedbackBridge /> 把带主题的通知实例登记到这里。
// 另有两个全局状态：整页拦截（来源 IP 不允许、停机维护）与“后台已更新”。
import type { NotificationInstance } from "antd/es/notification/interface";
import { createElement, useSyncExternalStore, type ReactNode } from "react";

import { Icon } from "../components/Icon";
import type { ApiNotice } from "../lib/api";
import type { ApiFailure } from "../lib/api-errors";

let notifier: NotificationInstance | null = null;

export function setNotifier(instance: NotificationInstance | null): void {
  notifier = instance;
}

/** 成功的通知几秒后消失（规范 第 8 节：4 秒）；失败的不自动消失 */
export const SUCCESS_NOTICE_SECONDS = 4;

/** 通知左侧的图标：16px，成功是浅绿的对勾，失败是红色的感叹号（规范 第 5.3 节“轻提示”、第 8 节） */
function toastIcon(kind: "success" | "danger"): ReactNode {
  return createElement(Icon, {
    name: kind === "success" ? "check" : "alert-circle",
    size: 16,
    className: `lyx-toast-icon lyx-toast-icon--${kind}`,
  });
}

/**
 * 操作失败的右上角通知（规范 第 5.4 节“通知”、第 8 节）：红色感叹号，不自动消失，要手动关；
 * 5xx 与编程错误带请求编号后 8 位。同一句话只留一条（连着重试几次不会叠出几条关不完的）。
 */
export function showApiNotice(notice: ApiNotice): void {
  const description = notice.requestIdTail ? `请求编号 ${notice.requestIdTail}` : undefined;
  if (!notifier) {
    console.error(notice.message, description ?? "");
    return;
  }
  notifier.error({
    key: `failure:${notice.message}`,
    title: notice.message,
    description,
    placement: "topRight",
    duration: false,
    icon: toastIcon("danger"),
  });
}

/**
 * 操作成功的右上角通知（规范 第 8 节）：对勾，4 秒后消失，可手动关闭。文案用“已……”句式（规范 第 7 节）。
 * 操作结果用状态播报（规范 第 10 节）：role 给 status；失败的那一种沿用 antd 缺省的 alert（警示播报）。
 */
export function showSuccessNotice(message: string): void {
  notifier?.success({
    title: message,
    placement: "topRight",
    duration: SUCCESS_NOTICE_SECONDS,
    icon: toastIcon("success"),
    role: "status",
  });
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
