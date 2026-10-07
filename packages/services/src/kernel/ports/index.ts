// kernel 的五个端口（W0-17）：下层定义接口与空实现，上层在自己的 register.ts 里登记实现（06 第 3.6 节）。
// 一端口一文件；声明在 ../register.ts。用的地方经 alertsOf(assembly) 这类取用函数拿，不直接碰实现。
export { ALERT_SEVERITIES, alertsOf, alertsPort, noopAlerts } from "./alerts.js";
export type { AlertInput, Alerts, AlertSeverity } from "./alerts.js";
export { invariantsOf, invariantsPort, noopInvariants } from "./invariants.js";
export type { InvariantReport, Invariants } from "./invariants.js";
export { setPortLogger } from "./log.js";
export type { PortLogger } from "./log.js";
export { notifyReadOf, notifyReadPort } from "./notify-read.js";
export type { NotifyRead, NotifyReader } from "./notify-read.js";
export { REMINDER_RULE_KEYS, remindersOf, remindersPort } from "./reminders.js";
export type {
  ReminderQuery,
  ReminderRule,
  ReminderRuleKey,
  Reminders,
  ReminderTarget,
  ReminderVerdict,
} from "./reminders.js";
export { noopTrack, trackOf, trackPort } from "./track.js";
export type { Track, TrackEvent } from "./track.js";
export { fileRefTypePort } from "./files.js";
export type { ExpectedFileRef, FileRefType } from "./files.js";
// W1-03：商家读侧的事实端口（按来源模块分键；没人登记的键取默认值）
export {
  defaultMerchantFacts,
  implementMerchantFacts,
  MERCHANT_FACT_SOURCES,
  merchantFactsOf,
  merchantFactsPort,
} from "./merchant-facts.js";
export type {
  AdStoreFacts,
  AssetStoreFacts,
  BillingSubscriptionFacts,
  BillingWalletFacts,
  FactDictRef,
  MerchantFacts,
  MerchantFactSource,
  MerchantFactsProvider,
  MerchantFactsQuery,
  MerchantFactsReader,
  OrderStoreFacts,
  ProfileStoreFacts,
  PublishStoreFacts,
  SupportStoreFacts,
} from "./merchant-facts.js";

export { dictReferencesPort, dictReferencesOf } from "./dict-references.js";
export type { DictReferenceSource } from "./dict-references.js";
export { piiFieldsPort, piiFieldsOf, implementPiiFields } from "./pii-fields.js";
export type { PiiFactDb, PiiFieldQuery, PiiFieldFact, PiiFieldProvider } from "./pii-fields.js";
