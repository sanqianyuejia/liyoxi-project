// 服务装配（W0-07b）的出口。用法见本目录的 README.md。
export { assemble, ASSEMBLY_ISSUE_CATEGORIES, AssemblyError } from "./assemble.js";
export type { AssembleOptions, AssemblyIssue, AssemblyIssueCategory } from "./assemble.js";
export {
  auditModuleEntries,
  collectRegistrations,
  isModuleRegistration,
  REGISTRATION_EXPORT,
  RegistrationShapeError,
} from "./collect.js";
export type { ModuleDirectory } from "./collect.js";
export {
  ASSEMBLY_ENTRIES,
  CLEANUP_EVERY,
  defineKeyedPort,
  definePort,
  defineRegistration,
  implement,
  implementKeyed,
  INVARIANT_EVERY,
  INVARIANT_HEAL,
  INVARIANT_MODES,
  INVARIANT_SEVERITIES,
  REGISTRATION_KINDS,
  TIMER_OUTCOMES,
} from "./types.js";
export type {
  AnyPort,
  Assembly,
  AssemblyEntry,
  CleanupContext,
  CleanupEvery,
  CleanupRegistration,
  Collected,
  DeclaredPort,
  DeliveredEvent,
  EnvScoped,
  FiredTimer,
  InvariantEvery,
  InvariantHeal,
  InvariantMode,
  InvariantRegistration,
  InvariantScope,
  InvariantSeverity,
  InvariantSubject,
  InvariantViolation,
  KeyedPort,
  ModuleRegistration,
  Port,
  PortImplementation,
  RecurringJobRegistration,
  RecurringRunContext,
  RegistrationKind,
  SubscriberRegistration,
  TimerHandlerRegistration,
  TimerOutcome,
} from "./types.js";

// W0-17：周期任务的节奏、模式、漏跑级别（定时器处理器与周期任务两类登记项的可选字段）
export { MISS_SEVERITIES, RECURRING_MODES } from "./types.js";
export type { MissSeverity, RecurringMode, RecurringSchedule } from "./types.js";

// W0-24：框架调检查项时给的上下文（业务时间）
export { invariantNow } from "./types.js";
export type { InvariantRunContext } from "./types.js";
