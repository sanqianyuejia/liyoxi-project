import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app/App";
import { createAppServices } from "./app/services";
import { createAppRouter } from "./router";
import { installCssVariables } from "./theme/css-vars";
import "./theme/global.css";

async function start(): Promise<void> {
  installCssVariables(document);
  const services = createAppServices();
  // 夹具（权限数据、样例数据）只进开发与测试构建：生产构建里这一段整个被摇掉，
  // scripts/check-build.mjs 断言产物里没有夹具的标记
  if (__LYX_DEV_FIXTURES__) {
    const { installDevFixtures } = await import("./dev/install");
    installDevFixtures(services);
  }
  const router = createAppRouter(services);
  const container = document.getElementById("root");
  if (!container) throw new Error("index.html 里没有 #root");
  createRoot(container).render(
    <StrictMode>
      <App services={services} router={router} />
    </StrictMode>,
  );
}

void start();
