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
