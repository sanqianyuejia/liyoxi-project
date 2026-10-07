// 工作日历的读取（W0-17）：读 work_calendar_day 的一段日期，组成 @liyoxi/shared/workcal 要的日历。
// 依据：01 分组 第 2.7 节；D3 第 22.2 节。全部按 Asia/Shanghai；工作时段是参数（work.start、work.end），由调用方传入。
// 这一段里库里没有的日期，isWorkday 返回 undefined：纯函数按“周一至周五工作”兜底并标出来。
import { parseHm } from "@liyoxi/shared/time";
import type { LocalDate } from "@liyoxi/shared/time";
import type { WorkCalendar } from "@liyoxi/shared/workcal";

import type { Tx } from "../kernel/index.js";

/** 工作时段：参数 work.start、work.end 的值，"HH:mm" */
export interface WorkHours {
  readonly start: string;
  readonly end: string;
}

export interface DateRange {
  /** 含 */
  readonly from: LocalDate;
  /** 含 */
  readonly to: LocalDate;
}

/** 读 [from, to] 这一段的日历 */
export async function loadWorkCalendar(
  tx: Tx,
  range: DateRange,
  hours: WorkHours,
): Promise<WorkCalendar> {
  const rows = await tx.$queryRawUnsafe<{ day: string; is_workday: boolean }[]>(
    `SELECT to_char(day, 'YYYY-MM-DD') AS day, is_workday FROM work_calendar_day
      WHERE day BETWEEN $1::date AND $2::date`,
    range.from,
    range.to,
  );
  const days = new Map(rows.map((row) => [row.day, row.is_workday]));
  return {
    isWorkday: (date) => days.get(date),
    workStartMinute: parseHm(hours.start),
    workEndMinute: parseHm(hours.end),
  };
}

/** 全表最大的导入批次号；表为空时是 0（01 分组 第 2.7 节：时限快照的 calendarVersion 记它） */
export async function currentCalendarVersion(tx: Tx): Promise<number> {
  const [row] = await tx.$queryRawUnsafe<{ version: number }[]>(
    "SELECT COALESCE(max(calendar_version), 0)::int AS version FROM work_calendar_day",
  );
  return row?.version ?? 0;
}

/** 同一批次号与日期事实的读取边界；年度导入持排他锁，其余 SLA 计算持共享锁。 */
export async function lockCalendarImport(
  tx: Tx,
  mode: "shared" | "exclusive" = "shared",
): Promise<void> {
  if (mode === "exclusive")
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('config.calendar.import',0))`;
  else
    await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtextextended('config.calendar.import',0))`;
}
