// 周期任务的栅格时刻（W0-17）：由节奏算“最近一个已到的计划时刻”与“下一个计划时刻”。纯函数。
// 依据：D3 第 21.4 节第 1 条；D7 第 7.6 节；x01 第 4.2 节。全部按 Asia/Shanghai（没有夏令时，一天恒为 24 小时）。
// 栅格只由节奏决定，与“现在几点”“进程何时启动”无关：两个实例算出的同一期是同一个时刻，键也就相同。
import {
  addDays,
  atMinuteOfDay,
  calendarDate,
  dayOfWeek,
  formatLocalDate,
  parseHm,
  parseLocalDate,
} from "@liyoxi/shared/time";

import type { RecurringSchedule } from "../kernel/index.js";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const isIntIn = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;

function atProblem(at: unknown): string | undefined {
  try {
    if (typeof at === "string" && parseHm(at) < 24 * 60) return undefined;
  } catch {
    // 落到下面的报错
  }
  return 'at 要写 "HH:mm"，00:00 到 23:59';
}

/** 节奏写得对不对：对即 undefined，不对给出原因 */
export function scheduleProblem(schedule: RecurringSchedule | undefined): string | undefined {
  if (typeof schedule !== "object" || schedule === null) return "没有写节奏（schedule）";
  switch (schedule.every) {
    case "minutes":
      return isIntIn(schedule.minutes, 1, 24 * 60) ? undefined : "minutes 要是 1 到 1440 的整数";
    case "hour":
      return schedule.minute === undefined || isIntIn(schedule.minute, 0, 59)
        ? undefined
        : "minute 要是 0 到 59 的整数";
    case "day":
      return atProblem(schedule.at);
    case "week":
      return isIntIn(schedule.weekday, 1, 7)
        ? atProblem(schedule.at)
        : "weekday 要是 1（周一）到 7（周日）";
    case "month":
      return isIntIn(schedule.day, 1, 28)
        ? atProblem(schedule.at)
        : "day 要是 1 到 28（每个月都有的日子）";
    default:
      return "every 只能是 minutes、hour、day、week、month";
  }
}

/** 某年某月（month 可以越界，自动进位到相邻的年）的第 day 日的 minute 分 */
function monthSlot(year: number, month: number, day: number, minute: number): Date {
  const index = year * 12 + (month - 1);
  return atMinuteOfDay(formatLocalDate(Math.floor(index / 12), (index % 12) + 1, day), minute);
}

/** 最近一个已到的计划时刻：不晚于 at 的最后一格 */
export function slotAtOrBefore(schedule: RecurringSchedule, at: Date): Date {
  const now = at.getTime();
  if (Number.isNaN(now)) throw new RangeError("周期任务：无效的时刻");
  switch (schedule.every) {
    case "minutes": {
      const step = schedule.minutes * MINUTE;
      return new Date(Math.floor(now / step) * step);
    }
    case "hour": {
      // 北京时间与 UTC 差整 8 小时：整点的栅格两边相同
      const offset = (schedule.minute ?? 0) * MINUTE;
      return new Date(Math.floor((now - offset) / HOUR) * HOUR + offset);
    }
    case "day": {
      const slot = atMinuteOfDay(calendarDate(at), parseHm(schedule.at)).getTime();
      return new Date(slot <= now ? slot : slot - DAY);
    }
    case "week": {
      const today = calendarDate(at);
      const back = (dayOfWeek(today) - schedule.weekday + 7) % 7;
      const slot = atMinuteOfDay(addDays(today, -back), parseHm(schedule.at)).getTime();
      return new Date(slot <= now ? slot : slot - 7 * DAY);
    }
    case "month": {
      const { year, month } = parseLocalDate(calendarDate(at));
      const minute = parseHm(schedule.at);
      const slot = monthSlot(year, month, schedule.day, minute);
      return slot.getTime() <= now ? slot : monthSlot(year, month - 1, schedule.day, minute);
    }
  }
}

/** 下一个计划时刻：晚于 at 的第一格 */
export function slotAfter(schedule: RecurringSchedule, at: Date): Date {
  const last = slotAtOrBefore(schedule, at);
  switch (schedule.every) {
    case "minutes":
      return new Date(last.getTime() + schedule.minutes * MINUTE);
    case "hour":
      return new Date(last.getTime() + HOUR);
    case "day":
      return new Date(last.getTime() + DAY);
    case "week":
      return new Date(last.getTime() + 7 * DAY);
    case "month": {
      const { year, month } = parseLocalDate(calendarDate(last));
      return monthSlot(year, month + 1, schedule.day, parseHm(schedule.at));
    }
  }
}
