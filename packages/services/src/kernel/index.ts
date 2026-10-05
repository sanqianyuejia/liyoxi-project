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

// W0-07 事务单元：开事务的唯一入口与带品牌的事务句柄；服务层的业务错误
export { AppError, isAppError } from "./errors.js";
export type { AppErrorOptions, ErrorSymbol } from "./errors.js";
export {
  assertNotInTransaction,
  createTxRunner,
  isInTransaction,
  KernelViolation,
  savepoint,
  sqlStateOf,
  TX_MAX_WAIT_MS,
  TX_RETRIES,
  TX_TIMEOUT_MAX_MS,
  TX_TIMEOUT_MS,
} from "./tx.js";
export type { KernelViolationKind, Tx, TxRunner, TxRunnerOptions, TxRunOptions } from "./tx.js";

// W0-07 时钟与主键
export { systemClock } from "./clock.js";
export type { Clock } from "./clock.js";
export { isUuid, uuidv7 } from "./ids.js";

// W0-07 加锁顺序：常量、锁序断言、加锁函数
export { assertLockOrder, checkLockOrder, LOCK_ORDER } from "./lock-order.js";
export type { LockTable } from "./lock-order.js";
export { lockRows } from "./lock.js";
export type { RowLockMode, RowLockTable } from "./lock.js";

// W0-07 操作人与身份上下文
export { actorColumns, actorKey, createActor, createIdentityContext } from "./actor.js";
export type {
  Actor,
  ActorClient,
  ActorInput,
  IdentityContext,
  IdentityContextInput,
  MerchantActor,
  StaffActor,
  SystemActor,
} from "./actor.js";

// W0-07b 服务装配：六类注册接口、端口、收集与装配
export * from "./assembly/index.js";

// W0-17 五个端口：告警、不变量上报、埋点直记、通知场景解析、提醒查询；kernel 的登记（声明这五个端口）
export * from "./ports/index.js";
export { registration } from "./register.js";
