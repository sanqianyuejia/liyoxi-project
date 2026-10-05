// 样例模块 alpha 的入口：对外只有这个文件。登记以 registration 这个名字给出，组合根据此收集。
export { executorPort, greeterPort, meterPort } from "./ports.js";
export type { Executor, Greeter, Meter } from "./ports.js";
export { calls, registration } from "./register.js";
