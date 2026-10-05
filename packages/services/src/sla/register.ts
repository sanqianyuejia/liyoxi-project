// sla 模块的登记（W0-17）：不变量 sla.N8。调度在 invariant.full（W0-24），这里只登记。
// 依据：01 分组 第 2.7 节“不变量”：已铺满的年份内日期连续、无缺口；severity P2，modes full，heal none；
// 每个缺口日期一条违规，对象是自然键（subject_type = work_calendar_day，subject_key = 缺失的日期），不带 entityId。
import { defineRegistration } from "../kernel/index.js";
import type { InvariantViolation, Tx } from "../kernel/index.js";

/** 从库里最早那一年的 1 月 1 日到最晚那一年的 12 月 31 日，缺行的每一天各报一条；表为空时不报 */
export async function findCalendarGaps(tx: Tx): Promise<InvariantViolation[]> {
  const rows = await tx.$queryRawUnsafe<{ day: string }[]>(
    `WITH span AS (
       SELECT date_trunc('year', min(day))::date AS first_day,
              (date_trunc('year', max(day)) + interval '1 year')::date - 1 AS last_day
         FROM work_calendar_day
     )
     SELECT to_char(span.first_day + offs, 'YYYY-MM-DD') AS day
       FROM span, generate_series(0, span.last_day - span.first_day) AS offs
      WHERE NOT EXISTS (SELECT 1 FROM work_calendar_day w WHERE w.day = span.first_day + offs)
      ORDER BY 1`,
  );
  return rows.map((row) => ({
    subject: { type: "work_calendar_day", key: row.day },
    detail: { missingDay: row.day },
  }));
}

export const registration = defineRegistration("sla", {
  invariants: [
    { code: "sla.N8", severity: "P2", modes: ["full"], heal: "none", run: findCalendarGaps },
  ],
});
