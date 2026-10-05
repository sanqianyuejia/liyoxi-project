import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "worker",
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    // 连库、连 Redis 的用例走测试支架（W0-05b）：每轮开始时建本会话的模板库
    globalSetup: ["@liyoxi/services/testing/global-setup"],
  },
});
