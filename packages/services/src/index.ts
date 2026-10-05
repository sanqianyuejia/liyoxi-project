export {};

// W0-07b 服务装配：组合根。api、worker 启动时各调一次 assembleServices
export { assembleServices } from "./assembly.js";
export type { AssembleServicesOptions } from "./assembly.js";
export { AssemblyError } from "./kernel/index.js";
export type { Assembly, AssemblyEntry, AssemblyIssue } from "./kernel/index.js";

// W0-22 进程运行时：api 与 worker 启动时各建一次；日志的唯一构造；启动自检
export { createRuntime, DB_POOLS, runStartupChecks, StartupCheckError } from "./runtime.js";
export type { DbPoolSettings, Runtime, RuntimeOptions, StartupCheck } from "./runtime.js";
export { createLogger, LOG_CODE_CONTAINERS, LOG_REDACT_KEYS } from "./logger.js";
export type { Logger, LoggerOptions } from "./logger.js";
// W0-22 接口层要用的内核件：环境、业务错误、身份上下文、幂等上下文、主键
export {
  AppError,
  assertIdempotencyUsed,
  createIdempotencyContext,
  createIdentityContext,
  EnvError,
  isAppError,
  isUuid,
  KernelViolation,
  loadEnv,
  uuidv7,
} from "./kernel/index.js";
export type {
  Actor,
  AppEnv,
  Clock,
  Env,
  ErrorSymbol,
  IdempotencyContext,
  IdentityContext,
  IdentityContextInput,
  Tx,
  TxRunner,
  TxRunOptions,
} from "./kernel/index.js";
// W0-22 探活的响应结构（h01 第 2.5 节）
export type { FinanceHealth, FlowHealth, Health, HealthSummary } from "./ops/index.js";
