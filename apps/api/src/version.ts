// 镜像标签（h01 第 2.5 节 HealthSummary.version）：构建时由 scripts/build.mjs 写进产物（取构建环境的 LYX_BUILD），
// 本地直接跑源码与用例里是 dev。
declare const __LYX_BUILD__: string | undefined;

export const VERSION: string = typeof __LYX_BUILD__ === "string" ? __LYX_BUILD__ : "dev";
