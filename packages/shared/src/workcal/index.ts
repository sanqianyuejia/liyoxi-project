// 子路径 @liyoxi/shared/workcal：工作日历的六个函数，与按时限策略算截止时刻。
//
// 依据：D3 第 22.2、22.3 节；01 分组 第 2.7 节；14 分组 第 4.2 节。
// 日历由调用方传入（某天是否工作日、工作时段起止），函数自己不读库、不取当前时间。
// 全部按北京时间算。工作时段左闭右开，不扣午休。
//
// 超出日历范围：调用方的 isWorkday 对没有的日期返回 undefined，这里按“周一至周五工作”
// 兜底，并在返回值里标出用了兜底的日期，由调用方决定要不要告警。

import { assertNever } from "../assert.js";
import { addDays, atMinuteOfDay, calendarDate, dayOfWeek, startOfDay } from "../time/index.js";
import type { LocalDate } from "../time/index.js";

export interface WorkCalendar {
  /** 某天是否工作日；日历里没有这一天返回 undefined */
  isWorkday(date: LocalDate): boolean | undefined;
  /** 上班时刻，距零点的分钟数（09:00 = 540） */
  workStartMinute: number;
  /** 下班时刻，距零点的分钟数（18:00 = 1080） */
  workEndMinute: number;
}

/** 兜底标记：计算中有哪些日期不在日历里、按“周一至周五工作”算的 */
export interface FallbackInfo {
  usedFallback: boolean;
  /** 用了兜底的日期，按首次用到的先后 */
  fallbackDates: LocalDate[];
}

export interface WorkcalInstant extends FallbackInfo {
  at: Date;
}

export interface WorkcalDate extends FallbackInfo {
  date: LocalDate;
}

export interface WorkcalMinutes extends FallbackInfo {
  minutes: number;
}

/**
 * 时限策略（参数 sla.* 的值）。unit 的五个取值只在这里定义：它是参数值的一部分，不是库里的列，
 * 契约的枚举里没有对应的常量（M0 合流时核对过，W0-30）；参数定义的 SlaUnit 引的就是这里
 */
export interface SlaPolicy {
  /** same_day_cutoff 时是截止时刻距零点的分钟数（18:00 = 1080），其余是数量 */
  amount: number;
  unit: "work_minutes" | "work_days" | "natural_hours" | "natural_days" | "same_day_cutoff";
}

const MS_PER_MINUTE = 60_000;
const MINUTES_PER_DAY = 1_440;
/** 找下一个工作日最多往后看这么多天；日历配成全年无工作日时用来止损 */
const MAX_SCAN_DAYS = 366;

interface Lookup {
  isWorkday(date: LocalDate): boolean;
  startMinute: number;
  endMinute: number;
  fallbackDates: LocalDate[];
}

function count(value: number, label: string, min: 0 | 1): number {
  if (!Number.isSafeInteger(value) || value < min) {
    throw new RangeError(`工作日历：${label}必须是不小于 ${min} 的整数，收到 ${String(value)}`);
  }
  return value;
}

function createLookup(calendar: WorkCalendar): Lookup {
  const { workStartMinute: startMinute, workEndMinute: endMinute } = calendar;
  const valid =
    Number.isInteger(startMinute) &&
    Number.isInteger(endMinute) &&
    startMinute >= 0 &&
    startMinute < endMinute &&
    endMinute <= MINUTES_PER_DAY;
  if (!valid) {
    throw new RangeError(`工作日历：工作时段不合法 ${String(startMinute)}–${String(endMinute)}`);
  }
  const fallbackDates: LocalDate[] = [];
  const seen = new Set<LocalDate>();
  return {
    startMinute,
    endMinute,
    fallbackDates,
    isWorkday(date) {
      const known = calendar.isWorkday(date);
      if (known !== undefined) return known;
      if (!seen.has(date)) {
        seen.add(date);
        fallbackDates.push(date);
      }
      return dayOfWeek(date) <= 5;
    },
  };
}

const withFallback = <T extends object>(lookup: Lookup, value: T): T & FallbackInfo => ({
  ...value,
  usedFallback: lookup.fallbackDates.length > 0,
  fallbackDates: lookup.fallbackDates,
});

/** date 之后（不含）的第一个工作日 */
function nextWorkday(lookup: Lookup, date: LocalDate): LocalDate {
  let cursor = date;
  for (let scanned = 0; scanned < MAX_SCAN_DAYS; scanned += 1) {
    cursor = addDays(cursor, 1);
    if (lookup.isWorkday(cursor)) return cursor;
  }
  throw new RangeError(`工作日历：${date} 之后 ${MAX_SCAN_DAYS} 天内没有工作日`);
}

/** date 之后（不含）的第 n 个工作日；n = 0 返回 date 本身 */
function workdayAfter(lookup: Lookup, date: LocalDate, n: number): LocalDate {
  let cursor = date;
  for (let i = 0; i < n; i += 1) cursor = nextWorkday(lookup, cursor);
  return cursor;
}

function workStartRaw(lookup: Lookup, at: Date): Date {
  const date = calendarDate(at);
  if (lookup.isWorkday(date)) {
    const open = atMinuteOfDay(date, lookup.startMinute);
    if (at.getTime() < open.getTime()) return open;
    if (at.getTime() < atMinuteOfDay(date, lookup.endMinute).getTime()) return at;
  }
  return atMinuteOfDay(nextWorkday(lookup, date), lookup.startMinute);
}

/** at 在工作时段内返回 at；否则返回下一个工作时段的起点 */
export function nextWorkStart(calendar: WorkCalendar, at: Date): WorkcalInstant {
  const lookup = createLookup(calendar);
  return withFallback(lookup, { at: workStartRaw(lookup, at) });
}

/** 从 nextWorkStart(at) 起，只在工作时段内累计 minutes 分钟。恰好累计到下班时刻的，落在当日下班时刻 */
export function addWorkingMinutes(
  calendar: WorkCalendar,
  at: Date,
  minutes: number,
): WorkcalInstant {
  const lookup = createLookup(calendar);
  let remaining = count(minutes, "工作分钟数", 0) * MS_PER_MINUTE;
  let cursor = workStartRaw(lookup, at);
  for (;;) {
    const date = calendarDate(cursor);
    const room = atMinuteOfDay(date, lookup.endMinute).getTime() - cursor.getTime();
    if (remaining <= room)
      return withFallback(lookup, { at: new Date(cursor.getTime() + remaining) });
    remaining -= room;
    cursor = atMinuteOfDay(nextWorkday(lookup, date), lookup.startMinute);
  }
}

/**
 * 加 days 个工作日：at 所在日是工作日则从 at 起算，否则从下一个工作日的上班时刻起算；
 * 返回其后第 days 个工作日的同一钟点。
 */
export function addWorkingDays(calendar: WorkCalendar, at: Date, days: number): WorkcalInstant {
  const lookup = createLookup(calendar);
  count(days, "工作日数", 0);
  const date = calendarDate(at);
  const onWorkday = lookup.isWorkday(date);
  const baseDate = onWorkday ? date : nextWorkday(lookup, date);
  const clockMs = onWorkday
    ? at.getTime() - startOfDay(date).getTime()
    : lookup.startMinute * MS_PER_MINUTE;
  const target = workdayAfter(lookup, baseDate, days);
  return withFallback(lookup, { at: new Date(startOfDay(target).getTime() + clockMs) });
}

/** 日期 date 之后（不含）的第 n 个工作日，n 不小于 1 */
export function nthWorkdayAfter(calendar: WorkCalendar, date: LocalDate, n: number): WorkcalDate {
  const lookup = createLookup(calendar);
  return withFallback(lookup, { date: workdayAfter(lookup, date, count(n, "第几个工作日", 1)) });
}

/**
 * 当日截止：at 所在日是工作日且还没到截止时刻，返回当日的截止时刻；
 * 否则（已到或已过，或当天不是工作日）返回下一个工作日的截止时刻。
 */
export function sameDayCutoff(
  calendar: WorkCalendar,
  at: Date,
  cutoffMinute: number,
): WorkcalInstant {
  const lookup = createLookup(calendar);
  const date = calendarDate(at);
  if (lookup.isWorkday(date)) {
    const cutoff = atMinuteOfDay(date, cutoffMinute);
    if (at.getTime() < cutoff.getTime()) return withFallback(lookup, { at: cutoff });
  }
  return withFallback(lookup, { at: atMinuteOfDay(nextWorkday(lookup, date), cutoffMinute) });
}

/** from 到 to 之间落在工作时段内的分钟数，不足一分钟的舍去。to 不得早于 from */
export function workingMinutesBetween(
  calendar: WorkCalendar,
  from: Date,
  to: Date,
): WorkcalMinutes {
  const lookup = createLookup(calendar);
  if (to.getTime() < from.getTime()) throw new RangeError("工作日历：结束时刻早于开始时刻");
  const lastDate = calendarDate(to);
  let totalMs = 0;
  for (let date = calendarDate(from); date <= lastDate; date = addDays(date, 1)) {
    if (!lookup.isWorkday(date)) continue;
    const open = Math.max(from.getTime(), atMinuteOfDay(date, lookup.startMinute).getTime());
    const close = Math.min(to.getTime(), atMinuteOfDay(date, lookup.endMinute).getTime());
    if (close > open) totalMs += close - open;
  }
  return withFallback(lookup, { minutes: Math.floor(totalMs / MS_PER_MINUTE) });
}

/** 按时限策略算截止时刻。自然小时与自然日不看日历 */
export function dueAt(calendar: WorkCalendar, from: Date, policy: SlaPolicy): WorkcalInstant {
  const { amount, unit } = policy;
  switch (unit) {
    case "work_minutes":
      return addWorkingMinutes(calendar, from, amount);
    case "work_days":
      return addWorkingDays(calendar, from, amount);
    case "same_day_cutoff":
      return sameDayCutoff(calendar, from, amount);
    case "natural_hours":
    case "natural_days": {
      const unitMs =
        unit === "natural_hours" ? 60 * MS_PER_MINUTE : MINUTES_PER_DAY * MS_PER_MINUTE;
      const fromMs = from.getTime();
      if (Number.isNaN(fromMs)) throw new RangeError("工作日历：无效的起算时刻");
      const at = new Date(fromMs + count(amount, "时限数量", 0) * unitMs);
      return { at, usedFallback: false, fallbackDates: [] };
    }
    default:
      return assertNever(unit, "未知的时限单位");
  }
}
