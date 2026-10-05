// 工作日历的样例数据（W0-17）：给一段日期铺上“周一至周五工作”，再标放假与调休上班。只给测试用。
// 真正的导入（年度放假安排、批次号的规矩、calendar.imported）在 M2；这里只为用例造行。
import type { PrismaClient } from "@liyoxi/db";

import type { Tx } from "../kernel/index.js";

export interface SeedCalendarOptions {
  /** 含，YYYY-MM-DD */
  readonly from: string;
  /** 含 */
  readonly to: string;
  /** 这一段里放假的日期 */
  readonly holidays?: readonly string[];
  /** 这一段里调休上班的日期（只能是周六、周日） */
  readonly adjustedWorkdays?: readonly string[];
  /** 写进 calendar_version 的批次号，缺省 1 */
  readonly version?: number;
}

/** 铺一段日历；已有的日期按这次给的覆盖。返回写了几行 */
export function seedWorkCalendar(
  db: PrismaClient | Tx,
  options: SeedCalendarOptions,
): Promise<number> {
  return db.$executeRawUnsafe(
    `INSERT INTO work_calendar_day (day, is_workday, kind, calendar_version)
     SELECT day, kind IN ('weekday', 'adjusted_workday'), kind, $5::int
       FROM (
         SELECT day,
                CASE WHEN day = ANY($3::date[]) THEN 'holiday'
                     WHEN day = ANY($4::date[]) THEN 'adjusted_workday'
                     WHEN extract(isodow FROM day) <= 5 THEN 'weekday'
                     ELSE 'weekend' END AS kind
           FROM (SELECT $1::date + offs AS day
                   FROM generate_series(0, $2::date - $1::date) AS offs) AS days
       ) AS marked
     ON CONFLICT (day) DO UPDATE
        SET is_workday = EXCLUDED.is_workday, kind = EXCLUDED.kind,
            calendar_version = EXCLUDED.calendar_version, updated_at = now()`,
    options.from,
    options.to,
    options.holidays ?? [],
    options.adjustedWorkdays ?? [],
    options.version ?? 1,
  );
}
