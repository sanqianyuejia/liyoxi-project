import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// 嵌套跑的一轮：redis-isolation.test.ts 起子进程跑本目录下的 *.fixture.ts，
// 用来在真的 Vitest 里验证 useTestRedis 的收尾。平时的 pnpm test 不会直接收进这些文件。
// 不挂 globalSetup（夹具不连库，用不着模板库）：globalSetup 平时给出的并行数
//（useTestRedis 靠它确认支架挂上了）在这里直接给。
export default defineConfig({
  test: {
    root: fileURLToPath(new URL("../../../", import.meta.url)),
    include: ["src/testing/__fixtures__/*.fixture.ts"],
    // 夹具要连 Redis：机器忙的时候不用缺省的 5 秒，与外层的用例同一个时限
    testTimeout: 60_000,
    hookTimeout: 120_000,
    provide: { lyxTestMaxWorkers: 1 },
  },
});
