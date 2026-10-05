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
  isRetryableDbError,
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

// W0-13 幂等：键的格式与请求哈希、幂等上下文（交给 tx.run 的 idem 选项）、结果脱敏、防漏用、过期清理、唯一冲突识别
export {
  canonicalJson,
  IDEMPOTENCY_KEY_PATTERN,
  isIdempotencyKey,
  requestHash,
} from "./request-hash.js";
export type { RequestHashInput } from "./request-hash.js";
export {
  createIdempotencyContext,
  IDEMPOTENCY_LOCK_WAIT_MS,
  IDEMPOTENCY_RETENTION_HOURS,
  redactForReplay,
} from "./idempotency.js";
export type { IdempotencyContext, IdempotencyContextInput } from "./idempotency.js";
export {
  assertIdempotencyUsed,
  IDEMPOTENCY_PURGE_LIMIT,
  isUniqueViolation,
  purgeExpiredIdempotencyRecords,
} from "./idempotency-tools.js";
export type { IdempotencyGuardOptions } from "./idempotency-tools.js";

// W0-13 业务单号：前缀表、格式规则、事务内取号
export {
  BIZ_NO_MIN_DIGITS,
  BIZ_NO_PREFIXES,
  BIZ_NO_STAGING_MARK,
  createBizNoIssuer,
  formatBizNo,
} from "./biz-no.js";
export type { BizNoFormatOptions, BizNoIssuer, BizNoIssuerOptions, BizNoPrefix } from "./biz-no.js";
// W0-07b 服务装配：六类注册接口、端口、收集与装配
export * from "./assembly/index.js";

// W0-20 三段式用例：占用、外呼、落结果的统一流水；外呼前钩子（接到 Provider 工厂的 beforeCall）
export { IDEMPOTENCY_LEASE_MS } from "./idempotency.js";
export { createThreePhaseRunner, guardProviderCall } from "./three-phase/index.js";
export type {
  ThreePhaseClaim,
  ThreePhaseFailure,
  ThreePhaseRunner,
  ThreePhaseRunnerOptions,
  ThreePhaseRunOptions,
  ThreePhaseUseCase,
} from "./three-phase/index.js";

// W0-20 乐观锁：内容编辑的版本关
export { bumpLockVersion, lockVersionField } from "./optimistic-lock/index.js";
export type { LockVersionTarget } from "./optimistic-lock/index.js";
// W0-14 两份密钥文件的内容类型（loadEnv 读出来的形状；密钥环在 security）
export type { BidxKeysConfig, DataKeysConfig } from "./env.js";
// W0-17 五个端口：告警、不变量上报、埋点直记、通知场景解析、提醒查询；kernel 的登记（声明这五个端口）
export * from "./ports/index.js";
export { registration } from "./register.js";

// W0-21 种子与 SQL 断言的共用形态
export { defineSeed, insertMissing, runSqlAssertion } from "./seed.js";
export type {
  AssertionViolation,
  InsertMissingOptions,
  ModuleSeed,
  SeedContext,
  SeedTableResult,
  SqlAssertion,
  SqlReader,
} from "./seed.js";

// W0-23 队列封装：连接、入队、消费者工厂、Redis 可用性探测
export * from "./queue/index.js";

// KF-1 数据库错误的原因：语句执行时与提交时（延迟约束、提交时判出的序列化失败）两种形状统一从这里取
export { dbErrorCause } from "./tx.js";
export type { DbErrorCause } from "./tx.js";
// KF-1 十二个外部能力的装配：进程装配经它拿 Providers，外呼前钩子在里面接上
export { assembleProviders } from "./assembly/providers.js";
export type { AssembleProvidersOptions } from "./assembly/providers.js";
