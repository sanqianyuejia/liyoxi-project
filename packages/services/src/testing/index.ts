// @liyoxi/services/testing：测试支撑设施的出口（D7 第 10.1 节）。只给测试用，不进生产装配。
// 各包只往这里加自己的导出行：W0-19 的 Provider 替身在 ./providers；测试库支架、可拨时钟、故障注入属 W0-05b。

export * from "./providers/index.js";

// W0-05b：测试库支架（守卫、按 worker 建库、重置）转导出自 @liyoxi/db/testing；
// 另有 Redis 的前缀隔离、可拨时钟、四种故障注入。用法见本目录的 README.md。
export * from "@liyoxi/db/testing";
export * from "./clock.js";
export * from "./fault/index.js";
export * from "./redis.js";

// W0-07b：测试装配（真实模块的登记之外追加样例登记）
export * from "./assembly.js";
