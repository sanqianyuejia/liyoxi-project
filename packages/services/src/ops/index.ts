// ops：任务进程的租约与服务装配（W0-23）。不变量与清理的调度在本文件末尾（W0-24）；探针、告警在 G2-D。
export { createWorkerLease, LEASE_DOWN_SEC, LEASE_RENEW_MS, LEASE_TAKEOVER_SEC } from "./lease.js";
export type { WorkerLease, WorkerLeaseOptions } from "./lease.js";
export { buildWorkerServices, connectWorkerDatabase } from "./worker.js";
export type { WorkerServices, WorkerServicesOptions } from "./worker.js";
// ops 模块（L4）的出口。W0-22 交付健康检查的取数；租约、探针、告警、不变量的调度随 W0-23、W0-24、W0-25。
export {
  createHealth,
  FLOW_P1,
  HEALTH_CACHE_MS,
  HEALTH_PROBE_TIMEOUT_MS,
  PROBE_MAX_AGE_SEC,
  WORKER_HEARTBEAT_MAX_AGE_SEC,
} from "./health.js";
export type {
  FinanceHealth,
  FlowHealth,
  Health,
  HealthOptions,
  HealthSummary,
  OkDegraded,
  UpDown,
} from "./health.js";
// W0-24：不变量校验的运行与落库、违规上报端口的实现、清理的执行，三个周期任务登记在 register.ts
export { bindOps, boundOps } from "./binding.js";
export type { OpsBinding, SqlRunner } from "./binding.js";
export * from "./invariants/index.js";
export {
  isFirstRoundOfDay,
  RETENTION_LIMIT,
  RETENTION_MAX_BATCHES,
  runRetention,
} from "./retention.js";
export type { RetentionDeps, RetentionInput, RetentionResult } from "./retention.js";
export { registration } from "./register.js";
// KF-1 启动自检：两个进程共用的清单与运行器（runStartupChecks 原在 runtime.ts，挪到这里，那边照旧转导出）
export { createStartupChecks, runStartupChecks, StartupCheckError } from "./startup.js";
export type { StartupCheck, StartupCheckDeps } from "./startup.js";
