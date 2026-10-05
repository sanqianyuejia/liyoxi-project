import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "api",
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    // 每轮测试开始时建本会话的模板库（W0-05b）：连库的用例从它拷出自己的库
    globalSetup: ["@liyoxi/services/testing/global-setup"],
  },
});
