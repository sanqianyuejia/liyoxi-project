// sla：工作日历的读取、时限计算与时限快照（W0-17）。纯函数在 @liyoxi/shared/workcal。用法见本目录的 README.md。
export { currentCalendarVersion, loadWorkCalendar, lockCalendarImport } from "./calendar.js";
export type { DateRange, WorkHours } from "./calendar.js";
export { CALENDAR_FALLBACK_RULE, createSla, SLA_UNITS } from "./due.js";
export type {
  DueInput,
  DueResult,
  Sla,
  SlaDeps,
  SlaSnapshot,
  SlaUnit,
  WorkMinutesInput,
} from "./due.js";
export { findCalendarGaps, registration } from "./register.js";
// W0-30a：flow 的“工作分钟”端口的实现，与按句柄读工作时段
export { calendarWorkMinutes, DEFAULT_WORK_HOURS, workHoursAt } from "./work-minutes.js";
// W0-21 种子：工作日历
export { calendarDaysOf, HOLIDAY_ARRANGEMENTS, seed, seededCalendarYears } from "./seed.js";
export type { CalendarDayKind, CalendarDaySeed, HolidayArrangement } from "./seed.js";

export { createCalendarAdmin, readCalendarYear } from "./import.js";
export type { CalendarAdmin, CalendarAdminDeps, CalendarImportActor } from "./import.js";

export { calendarCoverage, bindCalendarCoverage, checkCalendarCoverage } from "./coverage.js";
export type { CalendarCoverageBinding } from "./coverage.js";
