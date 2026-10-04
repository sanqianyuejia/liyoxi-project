/// <reference types="vitest/config" />
// 后台的构建与单测共用这一份配置（D7 第 10.6 节第 10 项的结论见
// docs/plan/external-verification/d7-10-admin-test-build-config.md）。
//
// 三种模式：
//   production（pnpm admin:build）     产物在 dist/app；不含样例页与夹具（__LYX_DEV_FIXTURES__ 为 false）
//   e2e（pnpm admin:e2e 先构建这一份）  产物在 dist/e2e-app；带样例页与夹具，冒烟对着它的预览跑
//   development / test（vite、vitest） 带样例页与夹具
// 产物文件名带内容哈希（Vite 的默认命名）；每次构建写入构建号：index.html 的 <meta name="lyx-build">、
// 代码里的 __LYX_BUILD__、产物根目录的 build.json 三处同值。构建号取环境变量 LYX_BUILD，
// 没有时取 git 提交的短哈希，都没有时是 dev。
import { execFileSync } from "node:child_process";

import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

function resolveBuildNumber(): string {
  const fromEnv = process.env.LYX_BUILD?.trim();
  if (fromEnv) return fromEnv;
  try {
    return execFileSync("git", ["rev-parse", "--short=12", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "dev";
  }
}

/** 把构建号写进 index.html 与 build.json */
function buildNumberPlugin(build: string, mode: string): Plugin {
  return {
    name: "lyx-build-number",
    transformIndexHtml() {
      return [{ tag: "meta", attrs: { name: "lyx-build", content: build }, injectTo: "head" }];
    },
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "build.json",
        source: `${JSON.stringify({ app: "admin", build, mode }, null, 2)}\n`,
      });
    },
  };
}

/**
 * 本地开发时由开发服务器应答样例接口：与冒烟里 Playwright 拦截用的是同一份夹具逻辑
 *（src/dev/sample-backend.ts），手工看三个样例页不用起 api。只在 vite 开发服务器里生效。
 */
function sampleBackendPlugin(): Plugin {
  const PREFIX = "/api/v1/admin/samples";
  let backend: { handle(request: unknown): { status: number; body: unknown } } | null = null;
  return {
    name: "lyx-sample-backend",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith(PREFIX)) return next();
        const chunks: Buffer[] = [];
        req.on("data", (chunk: Buffer) => chunks.push(chunk));
        req.on("end", () => {
          void (async () => {
            const module = await server.ssrLoadModule("/src/dev/sample-backend.ts");
            backend ??= module.createSampleBackend();
            const url = new URL(req.url ?? "/", "http://localhost");
            const text = Buffer.concat(chunks).toString("utf8");
            const response = backend!.handle({
              method: req.method ?? "GET",
              path: url.pathname,
              query: Object.fromEntries(url.searchParams),
              headers: Object.fromEntries(
                Object.entries(req.headers).map(([key, value]) => [key, String(value)]),
              ),
              body: text ? JSON.parse(text) : null,
            });
            res.statusCode = response.status;
            res.setHeader("Content-Type", "application/json");
            res.setHeader("X-Request-Id", String(req.headers["x-request-id"] ?? ""));
            res.end(JSON.stringify(response.body));
          })().catch(next);
        });
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const build = resolveBuildNumber();
  const withFixtures = mode !== "production";
  const apiOrigin = process.env.LYX_API_ORIGIN;
  return {
    plugins: [react(), buildNumberPlugin(build, mode), sampleBackendPlugin()],
    define: {
      __LYX_BUILD__: JSON.stringify(build),
      __LYX_DEV_FIXTURES__: JSON.stringify(withFixtures),
    },
    build: {
      outDir: mode === "e2e" ? "dist/e2e-app" : "dist/app",
      emptyOutDir: true,
      sourcemap: false,
    },
    server: {
      port: 5183,
      // 与接口同源（D7 第 5.1 节）：本地开发把 /api 转给 api 进程。api 骨架（W0-22）到位前不设 LYX_API_ORIGIN，不转发
      proxy: apiOrigin ? { "/api": { target: apiOrigin, changeOrigin: false } } : undefined,
    },
    preview: { port: 4183, strictPort: true },
    test: {
      name: "admin",
      environment: "node",
      include: ["src/**/*.test.{ts,tsx}"],
    },
  };
});
