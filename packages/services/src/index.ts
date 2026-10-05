// W0-07b 服务装配：组合根。api、worker 启动时各调一次 assembleServices
export { assembleServices } from "./assembly.js";
export type { AssembleServicesOptions } from "./assembly.js";
export { AssemblyError } from "./kernel/index.js";
export type { Assembly, AssemblyEntry, AssemblyIssue } from "./kernel/index.js";
// @liyoxi/services 的包入口：应用层只从这里取业务能力。各包只在末尾加自己的导出行。
// W0-14：敏感字段与审计。按模块名取用：security.sealPhone(…)、audit.record(…)
export * as security from "./security/index.js";
export * as audit from "./audit/index.js";

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
// W0-16 状态迁移：api、worker 启动时各调一次 createFlow（createEvents 之后），拿到 transition；另有状态列的启动自检
export { assertStateColumns, createFlow, FlowError } from "./flow/index.js";
export type { Flow, FlowOptions, TransitionInput, TransitionResult } from "./flow/index.js";
// W0-21 播种：运行器与六条配置类不变量的 SQL 断言（用法见 seed.ts 开头的注释）
export { checkSeedAssertions, runSeed, SEED_MODULES, seedAssertions } from "./seed.js";
export type { SeedDeps, SeedReport } from "./seed.js";
// W0-23 任务进程：环境与时钟、队列封装、租约、worker 的服务装配，以及队列任务带的两种引用
export { bullPrefix, createQueueChannel, EnvError, loadEnv, systemClock } from "./kernel/index.js";
export type { AppEnv, Clock, Env, LogLevel, QueueChannel, QueueConsumer } from "./kernel/index.js";
export {
  buildWorkerServices,
  connectWorkerDatabase,
  createWorkerLease,
  LEASE_RENEW_MS,
} from "./ops/index.js";
export type { WorkerLease, WorkerServices, WorkerServicesOptions } from "./ops/index.js";
export type { DeliveryRef } from "./events/index.js";
export type { TimerRef } from "./timers/index.js";

// W0-22 进程运行时：api 与 worker 启动时各建一次；日志的唯一构造；启动自检
export { createRuntime, DB_POOLS, runStartupChecks, StartupCheckError } from "./runtime.js";
export type { DbPoolSettings, Runtime, RuntimeOptions, StartupCheck } from "./runtime.js";
export { createLogger, LOG_CODE_CONTAINERS, LOG_REDACT_KEYS } from "./logger.js";
export type { Logger, LoggerOptions } from "./logger.js";
// W0-22 接口层要用的内核件：业务错误、身份上下文、幂等上下文、主键（环境 loadEnv、EnvError 与 Clock 等类型在上面 W0-23 的块里已导出）
export {
  AppError,
  assertIdempotencyUsed,
  createIdempotencyContext,
  createIdentityContext,
  isAppError,
  isUuid,
  KernelViolation,
  uuidv7,
} from "./kernel/index.js";
export type {
  Actor,
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
// W0-22b 限流器：进程运行时建好经 runtime.rateLimiter 给出；类型给 api 的限流中间件用
export { createRateLimiter, degradedLimit } from "./rate-limit.js";
export { actorKey } from "./kernel/index.js";
export type {
  RateLimitCheck,
  RateLimitDecision,
  RateLimiter,
  RateLimiterOptions,
  RateLimitStore,
} from "./rate-limit.js";
// W0-24 不变量与清理：一次运行的用例函数（发布后、演练、后台的手工触发调它）；定时的那三个任务登记在 ops 的 register.ts
export { runInvariants } from "./ops/index.js";
export type {
  InvariantRunDeps,
  InvariantRunResult,
  InvariantTrigger,
  RunInvariantsInput,
} from "./ops/index.js";
// W1-03 协议与同意、主体与门店：两个装配入口（进程启动时各建一次；用法见 docs/README.md、tenant/README.md），
// 公告的最小实现，以及接口层与别的域要用的类型
export { createDocs } from "./docs/index.js";
export type {
  AgreementListQuery,
  AssertConsentsInput,
  AssertConsentsResult,
  ConsentSigner,
  Docs,
  DocsDeps,
  SignedAgreementViewer,
} from "./docs/index.js";
export { billingAccountPort, createTenant } from "./tenant/index.js";
export type {
  ActiveMembership,
  BillingAccountOpener,
  QuotaUsage,
  StoreMembership,
  Tenant,
  TenantDeps,
} from "./tenant/index.js";
export { createNotices } from "./config/index.js";
export type { Notices, NoticesDeps } from "./config/index.js";
