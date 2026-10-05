// 小程序的单测：请求层与四个端上封装写成不依赖小程序运行时的模块，在 Node 里跑（任务书 W0-27a 第 11 节第 7 项）。
// 根上的 pnpm test 不含三个前端；这里由 pnpm --filter @liyoxi/weapp test 跑，CI 里是单独的一步。
// 不走 Taro 的构建配置：用例不引 @tarojs/*，只要把 @/ 指到 src。
import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: { alias: { "@": path.join(here, "src") } },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
  },
});
