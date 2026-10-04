/// <reference types="vitest/config" />
// 下载页是单独的 Vite 应用，不与后台共用登录态与路由（D7 第 6 节）。M0 只有空壳：能构建、有一个占位页；
// 页面与扫码登录在 M6（G6-B）。构建与单测共用这一份配置，做法同 apps/admin/vite.config.ts：
// 产物在 dist/app，文件名带内容哈希；构建号写进 index.html 的 <meta name="lyx-build">、代码里的 __LYX_BUILD__
// 与产物根目录的 build.json。构建号取环境变量 LYX_BUILD，没有时取 git 提交的短哈希。
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
        source: `${JSON.stringify({ app: "portal", build, mode }, null, 2)}\n`,
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const build = resolveBuildNumber();
  return {
    plugins: [react(), buildNumberPlugin(build, mode)],
    define: { __LYX_BUILD__: JSON.stringify(build) },
    build: { outDir: "dist/app", emptyOutDir: true, sourcemap: false },
    server: { port: 5184 },
    test: { name: "portal", environment: "node", include: ["src/**/*.test.{ts,tsx}"] },
  };
});
