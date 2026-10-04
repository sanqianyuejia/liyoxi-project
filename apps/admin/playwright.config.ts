// 后台冒烟的 Playwright 配置（任务书 第 7 节第 2、3、11 条；第 11 节第 8 项）。
// 对着已构建的静态产物跑：pnpm admin:e2e 先出一份带样例页的构建（dist/e2e-app），这里起它的预览；
// 接口由用例用路由拦截给夹具，不起 api。
// 浏览器：缺省用 Playwright 自带的 Chromium（CI 里先 playwright install）。本机没装那一版时，
// 可用 LYX_E2E_CHANNEL=chrome 改用已装的 Chrome。
// 产物都在 dist/ 下（不入库）：dist/e2e-shots 是四张截图，dist/e2e-results 是失败时的现场。
import { defineConfig, devices } from "@playwright/test";

const PORT = 4183;
const channel = process.env.LYX_E2E_CHANNEL || undefined;

export default defineConfig({
  testDir: "./test/e2e",
  outputDir: "./dist/e2e-results",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  reporter: [["list"]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    ...devices["Desktop Chrome"],
    channel,
    baseURL: `http://127.0.0.1:${PORT}`,
    // 最小支持的视口（规范 第 5.1 节）；截图那几步临时换成 1440 × 900
    viewport: { width: 1366, height: 768 },
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `pnpm exec vite preview --mode e2e --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}/build.json`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
