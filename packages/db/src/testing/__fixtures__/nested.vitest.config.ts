import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// 嵌套跑的一轮：worker.test.ts、parallel.test.ts 起子进程跑本目录下的 *.fixture.ts，
// 用来在真的 Vitest 里验证“按 worker 建库”与收尾的钩子。平时的 pnpm test 不会直接收进这些文件。
// 不挂 globalSetup：模板库用外层那一轮建好的，会话标识经环境变量 LYX_TEST_SESSION 传进来。
// globalSetup 平时给出的并行数（useTestDatabase 靠它确认支架挂上了）在这里由 nested.ts 经环境变量给：
// 没给就不提供，夹具里的 useTestDatabase 会报“没有挂 globalSetup”（worker.test.ts 有一条专门验这个）。
const workers = Number(process.env.LYX_TEST_NESTED_WORKERS ?? "");

export default defineConfig({
  test: {
    root: fileURLToPath(new URL("../../../", import.meta.url)),
    include: ["src/testing/__fixtures__/*.fixture.ts"],
    // 夹具都要建库、连库：实例忙的时候（别的会话同时在跑）建一个库就可以慢过缺省的 5 秒，时限放宽
    testTimeout: 60_000,
    hookTimeout: 120_000,
    provide: workers > 0 ? { lyxTestMaxWorkers: workers } : {},
  },
});
