// 应用外层：主题、中文文案、全局反馈、查询缓存、路由。
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { App as AntApp, ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import { useEffect } from "react";

import type { AppRouter } from "../router";
import { adminComponentConfig, adminTheme } from "../theme/antd";

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
    // 主题之外的组件级配置（表单不显示必填星号、弹窗居中、抽屉的缺省宽度等）在 theme/antd.ts 的 adminComponentConfig 里
    <ConfigProvider theme={adminTheme} locale={zhCN} {...adminComponentConfig}>
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
