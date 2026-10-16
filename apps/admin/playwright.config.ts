// 后台冒烟的 Playwright 配置（任务书 第 7 节第 2、3、11 条；第 11 节第 8 项）。
// 对着已构建的静态产物跑：pnpm admin:e2e 先出一份带样例页的构建（dist/e2e-app），这里起它的预览；
// samples 项目的接口由夹具拦截；live 项目的真实服务由 scripts/live.mjs 起，使用一次登录准备和共享 storageState。
// 浏览器：缺省用 Playwright 自带的 Chromium（CI 里先 playwright install）。本机没装那一版时，
// 可用 LYX_E2E_CHANNEL=chrome 改用已装的 Chrome。
// 产物都在 dist/ 下（不入库）：dist/e2e-shots 是截图（01–04 外壳与三种骨架，05–12 几个状态），
// dist/e2e-results 是失败时的现场。
import { defineConfig, devices } from "@playwright/test";

const PORT = 4183;
const channel = process.env.LYX_E2E_CHANNEL || undefined;
const live = process.env.LYX_ADMIN_LIVE === "1";

export default defineConfig({
  testDir: "./test/e2e",
  outputDir: live ? "./dist/e2e-live-results" : "./dist/e2e-results",
  projects: live
    ? [
        { name: "live-auth", testMatch: /live-auth\.setup\.ts$/ },
        {
          name: "live",
          dependencies: ["live-auth"],
          testMatch: /(?:^|[/\\])live-[^/\\]*\.spec\.ts$/,
          use: { storageState: process.env.LYX_ADMIN_LIVE_STATE },
        },
      ]
    : [{ name: "samples", testIgnore: [/(?:^|[/\\])live-[^/\\]*$/, /cover-upload\.spec\.ts$/] }],
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
    baseURL: live ? process.env.LYX_ADMIN_LIVE_ORIGIN : `http://127.0.0.1:${PORT}`,
    // 最小支持的视口（规范 第 5.1 节）；截图那几步临时换成 1440 × 900
    viewport: { width: 1366, height: 768 },
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: live
    ? undefined
    : {
        command: `pnpm exec vite preview --mode e2e --host 127.0.0.1 --port ${PORT} --strictPort`,
        url: `http://127.0.0.1:${PORT}/build.json`,
        reuseExistingServer: false,
        timeout: 60_000,
      },
});
