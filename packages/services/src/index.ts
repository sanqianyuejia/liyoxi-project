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
export { billingAccountPort, createTenant, membershipAuthorizationsPort } from "./tenant/index.js";
export type {
  ActiveMembership,
  BillingAccountOpener,
  MembershipAuthorizations,
  PortalGrantRevocation,
  QuotaUsage,
  StoreMembership,
  Tenant,
  TenantDeps,
} from "./tenant/index.js";
export { createNotices } from "./config/index.js";
export type { Notices, NoticesDeps } from "./config/index.js";
// W1-03 演示种子：协议的占位版本（运行器 demo-seed.ts 由 W1-01a 起头，W1-07 在里面加这一步）
export { seedPlaceholderAgreementVersions } from "./docs/index.js";
export type { PlaceholderFile, PlaceholderSeedInput } from "./docs/index.js";
// W1-06 审批执行器框架：进程启动时建一次（createFlow 之后），四个写函数与 recordExecuted 都收事务句柄；
// 各域在自己的 register.ts 里按 kind 登记处理器（approvalKindPort）。用法见 approval/README.md
export {
  approvalKindPort,
  ApprovalError,
  createApproval,
  defineApprovalKind,
} from "./approval/index.js";
export type {
  Approval,
  ApprovalDecision,
  ApprovalKindRegistration,
  ApprovalOptions,
  ApprovalRow,
  ApprovalSubmission,
  ApproveInput,
  DecisionResult,
  RecordExecutedInput,
  RejectInput,
  SubmitInput,
  SubmitResult,
  WithdrawInput,
} from "./approval/index.js";
// W1-04 identity 与商家侧授权：装配入口 createIdentity（api 启动时建一次，用法见 identity/README.md）、
// 商家鉴权链要用的类型、能力点判定与门店、主体的数据范围；微信能力的接口类型给装配处用
export { createIdentity, revokePortalGrants } from "./identity/index.js";
export type {
  Identity,
  IdentityDeps,
  PhoneLoginInput,
  PhoneLoginOptions,
  RequestMeta,
  SessionCheck,
  SessionPrincipal,
  SessionRejection,
  SilentLoginInput,
} from "./identity/index.js";
export {
  assertCapability,
  entityScopeOf,
  hasCapability,
  standingOf,
  storeScopeOf,
} from "./authz/index.js";
export type { EntityScope, MerchantStanding, StoreMode, StoreScope } from "./authz/index.js";
export type { WechatProvider } from "./providers/types.js";
// W1-01a 后台鉴权链：判定与数据范围按模块名取用（authz.authorize(…)、authz.storeScope(scope)，见 authz/README.md）；
// 凭据与会话的用例经进程运行时取（runtime.staffAuth），其余函数与常量按模块名取用（staff.staffCookieNames(…)、
// staff.buildStaffMe(…)，见 staff/README.md）；演示种子的运行器（用法见 demo-seed.ts 开头的注释）
export * as authz from "./authz/index.js";
export * as staff from "./staff/index.js";
export type { DataScope, StaffContext } from "./authz/index.js";
export type { AuthNext, SignedIn, StaffAuth, StaffPrincipal } from "./staff/index.js";
export { DEMO_SEED_STEPS, DemoSeedRefusedError, runDemoSeed } from "./demo-seed.js";
export type { DemoSeedDeps, DemoSeedReport, DemoSeedState, DemoSeedStep } from "./demo-seed.js";
export { cropMerchantView } from "./authz/index.js";
export type { MerchantViewerRole, MerchantViewSchemas } from "./authz/index.js";

// W1-11a 付款侧：对公确认在自己的事务里调用唯一入账入口；履约依赖由组合根装配。
export { createPayment, createFulfillment } from "./billing/index.js";
export {
  createBillingPurchase,
  bindBillingTimers,
  handleTransferTtl,
  proposeFinanceConfig,
  financeConfigAt,
  purchaseInvariants,
} from "./billing/index.js";
export type { BillingPurchase, BillingPurchaseDeps, PurchaseActor } from "./billing/index.js";
export type {
  Payment,
  PaymentDeps,
  ApplyPaymentInput,
  ApplyPaymentOutcome,
  ApplyPaymentResult,
  Fulfillment,
  FulfillDeps,
} from "./billing/index.js";

export * as media from "./media/index.js";
export { createMedia } from "./media/index.js";
export type { Media, MediaActor, MediaDeps, PromoteRef } from "./media/index.js";
export { seedPlaceholderFinanceConfig, PLACEHOLDER_FINANCE } from "./billing/index.js";
// W1-08a：商家档案及 initial 资质核心；后台路由随 b。
export { createProfile } from "./profile/index.js";
export type { Profile, ProfileDeps, ProfileViewer } from "./profile/index.js";
export { currentSessionOpenid } from "./identity/index.js";

export { createContent } from "./content/index.js";
export type { Content, ContentDeps, DramaPrices, DramaPrice } from "./content/index.js";
export { createMall } from "./workbench/index.js";
export type { Mall, MallDeps, MallViewer } from "./workbench/index.js";
export { seedDemoContent } from "./content/index.js";

export {
  createPublish,
  createLaunchTasks,
  getLaunchFacts,
  bindPublish,
  countPendingChannelAccountsByStore,
  launchChangedPort,
  launchHandlerPort,
  findPublishViolations,
  PUBLISH_INVARIANT_CODES,
} from "./publish/index.js";
export type {
  Publish,
  PublishDeps,
  PublishViewer,
  CreateLaunchTasksInput,
} from "./publish/index.js";

// W1-16a PR1：工单与方案，以及 W1-17 的同事务接管端口。
export {
  createDelivery,
  createDeliveryDownloads,
  bindDelivery,
  orderSidePort,
  createTickets,
  prepareTicketAssignees,
  reevaluate,
  reevaluateSweep,
  getTicketBriefByOrderItem,
  getTicketBriefsByOrder,
  getTicketTimeline,
  getPlanBriefByOrder,
} from "./delivery/index.js";
export type { DeliveryDownloads, DeliveryDownloadDeps } from "./delivery/index.js";
export type {
  Delivery,
  DeliveryDeps,
  DeliveryCoreDeps,
  DeliveryViewer,
  OrderSide,
} from "./delivery/index.js";
export {
  createOrderService,
  bindOrder,
  bindOrderStart,
  countOpenOrdersByEntity,
  countBlockingStoreOrders,
  countCartBadge,
  countOrderItemsByPhase,
} from "./order/index.js";
export type { OrderActor, OrderDeps, OrderService, OrderStartBinding } from "./order/index.js";
