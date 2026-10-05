export {};

// W0-07b 服务装配：组合根。api、worker 启动时各调一次 assembleServices
export { assembleServices } from "./assembly.js";
export type { AssembleServicesOptions } from "./assembly.js";
export { AssemblyError } from "./kernel/index.js";
export type { Assembly, AssemblyEntry, AssemblyIssue } from "./kernel/index.js";

// W0-15 出站事件：api、worker 启动时各调一次 createEvents（装配之后），拿到 emit 与展开；另有 events.I8 与聚合类型自检
export {
  assertAggregateTables,
  createEvents,
  EventEmitError,
  findI8Violations,
  SubscriberRegistryError,
} from "./events/index.js";
export type {
  EmitContext,
  EmitInput,
  EmitResult,
  Events,
  EventsOptions,
  ExpandResult,
  SubscriberEntry,
  SubscriberTable,
} from "./events/index.js";
// W0-17 定时器与时限：进程启动时各建一次（createTimers 同时对照契约校验登记）；端口的日志口由进程装配接上
export { createTimers, TimerRegistryError } from "./timers/index.js";
export type { Timers, TimersDeps } from "./timers/index.js";
export { createSla } from "./sla/index.js";
export type { Sla, SlaDeps } from "./sla/index.js";
export { setPortLogger } from "./kernel/index.js";
export type { PortLogger } from "./kernel/index.js";
