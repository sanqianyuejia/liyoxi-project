// Taro 构建配置（Vite 编译器）。文档：https://docs.taro.zone/docs/config
// 输出目录：小程序在 dist/（开发者工具导入 apps/weapp，miniprogramRoot 指到它）；H5 只给截图命令用，
// 在 shots/dist/h5/。两处都落在名叫 dist 的目录下，仓库里对 dist 的忽略（git、lint、格式）不用再加。
// 环境变量不读 .env：构建脚本（scripts/build.mjs）把要用的值经进程环境变量传进来，这里写进 defineConstants。
import path from "node:path";

import { defineConfig, type UserConfigExport } from "@tarojs/cli";

const root = path.resolve(__dirname, "..");
const isH5 = process.env.TARO_ENV === "h5";

/** 构建期注入的常量（types/global.d.ts 里有对应的声明）。值一律是 JSON 字面量 */
const constants = {
  __LYX_API_BASE_URL__: JSON.stringify(process.env.WEAPP_API_BASE_URL ?? ""),
  __LYX_APP_VERSION__: JSON.stringify(process.env.WEAPP_VERSION ?? "0.1.0"),
  __LYX_SENTRY_DSN__: JSON.stringify(process.env.WEAPP_SENTRY_DSN ?? ""),
};

export default defineConfig<"vite">(async (merge) => {
  const baseConfig: UserConfigExport<"vite"> = {
    projectName: "liyoxi-weapp",
    date: "2026-10-5",
    // 规范 第 4.1 节：designWidth 375，原型里的 px 原样写进样式文件（与 NutUI 一致）
    designWidth: 375,
    deviceRatio: { 640: 2.34 / 2, 750: 1, 375: 2, 828: 1.81 / 2 },
    sourceRoot: "src",
    outputRoot: isH5 ? "shots/dist/h5" : "dist",
    // NutUI React Taro 要 plugin-html 才能渲染 HTML 标签
    plugins: ["@tarojs/plugin-html"],
    defineConstants: constants,
    copy: { patterns: [], options: {} },
    framework: "react",
    compiler: { type: "vite", vitePlugins: [] },
    alias: { "@": path.resolve(root, "src") },
    sass: {
      // 每个 scss 自动可用商家端的样式变量（$lyx-*，W0-26 的生成物，只声明变量、不出样式）
      resource: [
        path.resolve(root, "node_modules/@liyoxi/shared/src/design/generated/merchant.scss"),
      ],
    },
    mini: {
      postcss: {
        // NutUI 内部已按 375 处理，跳过它的选择器
        pxtransform: { enable: true, config: { selectorBlackList: ["nut-"] } },
        cssModules: {
          enable: true,
          config: {
            namingPattern: "module",
            generateScopedName: "[name]__[local]___[hash:base64:5]",
          },
        },
      },
    },
    h5: {
      publicPath: "./",
      staticDirectory: "static",
      router: { mode: "hash" },
      postcss: {
        autoprefixer: { enable: true, config: {} },
        pxtransform: { enable: true, config: { selectorBlackList: ["nut-"] } },
        cssModules: {
          enable: true,
          config: {
            namingPattern: "module",
            generateScopedName: "[name]__[local]___[hash:base64:5]",
          },
        },
      },
    },
  };

  if (process.env.NODE_ENV === "development") {
    return merge({}, baseConfig, { logger: { quiet: false, stats: true } });
  }
  return merge({}, baseConfig, {});
});
