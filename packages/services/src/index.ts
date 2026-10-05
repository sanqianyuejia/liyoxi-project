export {};

// W0-07b 服务装配：组合根。api、worker 启动时各调一次 assembleServices
export { assembleServices } from "./assembly.js";
export type { AssembleServicesOptions } from "./assembly.js";
export { AssemblyError } from "./kernel/index.js";
export type { Assembly, AssemblyEntry, AssemblyIssue } from "./kernel/index.js";
