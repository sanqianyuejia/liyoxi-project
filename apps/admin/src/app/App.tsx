// 应用外层：主题、中文文案、全局反馈、查询缓存、路由。
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { App as AntApp, ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import { useEffect } from "react";

import type { AppRouter } from "../router";
import { adminTheme } from "../theme/antd";

import { setNotifier } from "./feedback";
import type { AppServices } from "./services";

/** 把带主题的通知实例交给请求层用（app/feedback.ts） */
function FeedbackBridge() {
  const { notification } = AntApp.useApp();
  useEffect(() => {
    setNotifier(notification);
    return () => setNotifier(null);
  }, [notification]);
  return null;
}

export function App({ services, router }: { services: AppServices; router: AppRouter }) {
  return (
    // 表单不显示必填星号，选填项在标签后写“（选填）”（规范 第 5.3 节）；两个字的按钮不自动加空格（原型是“驳回”不是“驳 回”）
    <ConfigProvider
      theme={adminTheme}
      locale={zhCN}
      form={{ requiredMark: false }}
      button={{ autoInsertSpace: false }}
    >
      {/* 通知在右上角，距顶 68（规范 第 5.4 节） */}
      <AntApp notification={{ placement: "topRight", top: 68 }}>
        <FeedbackBridge />
        <QueryClientProvider client={services.queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </AntApp>
    </ConfigProvider>
  );
}
