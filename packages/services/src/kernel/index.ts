export {
  APP_ENVS,
  ENV_GROUPS,
  ENV_KEYS,
  EnvError,
  groupIssues,
  loadEnv,
  LOG_LEVELS,
} from "./env.js";
export type { AppEnv, Env, EnvGroup, EnvIssue, EnvSource, LogLevel } from "./env.js";

// W0-07 事务单元：开事务的唯一入口与带品牌的事务句柄
export {
  createTxRunner,
  isInTransaction,
  KernelViolation,
  TX_MAX_WAIT_MS,
  TX_TIMEOUT_MAX_MS,
  TX_TIMEOUT_MS,
} from "./tx.js";
export type { KernelViolationKind, Tx, TxRunner, TxRunnerOptions, TxRunOptions } from "./tx.js";
