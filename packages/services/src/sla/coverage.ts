import { addDays, calendarDate } from "@liyoxi/shared/time";
import type { AlertInput, Alerts, Clock, Tx } from "../kernel/index.js";
import { lockCalendarImport } from "./calendar.js";

/** 业务 clock 与真实日期/导入审计事实；播种下一年的 weekday/weekend 底不代表已导入。 */
export async function calendarCoverage(tx: Tx, clock: Clock): Promise<readonly AlertInput[]> {
  await lockCalendarImport(tx);
  const today = calendarDate(clock.now());
  const end = addDays(today, 59);
  const year = Number(today.slice(0, 4));
  const rows = await tx.workCalendarDay.findMany({
    where: { day: { gte: new Date(`${today}T00:00:00Z`), lte: new Date(`${end}T00:00:00Z`) } },
    select: { day: true },
  });
  const existing = new Set(rows.map((row) => row.day.toISOString().slice(0, 10)));
  const missingDates: string[] = [];
  for (let day = today; day <= end; day = addDays(day, 1))
    if (!existing.has(day)) missingDates.push(day);
  const alerts: AlertInput[] = [];
  if (missingDates.length)
    alerts.push({
      rule: "calendar.coverage_gap",
      dimension: String(year),
      severity: "P3",
      detail: { from: today, to: end, missingDates },
    });
  if (today >= `${year}-12-01`) {
    const next = year + 1;
    const imported = await tx.auditLog.findFirst({
      where: {
        action: "sys.calendar.import",
        targetType: "work_calendar_day",
        targetKey: String(next),
      },
      select: { id: true },
    });
    // 种子中的已公布安排具有例外日，下一年的兜底行没有；不以365行覆盖数证明官方已导入。
    const exceptions = await tx.workCalendarDay.count({
      where: {
        day: {
          gte: new Date(`${next}-01-01T00:00:00Z`),
          lt: new Date(`${next + 1}-01-01T00:00:00Z`),
        },
        kind: { in: ["holiday", "adjusted_workday"] },
      },
    });
    if (!imported && exceptions === 0)
      alerts.push({
        rule: "calendar.next_year_missing",
        dimension: String(next),
        severity: "P3",
        detail: { year: next },
      });
  }
  return alerts;
}
export interface CalendarCoverageBinding {
  readonly clock: Clock;
  readonly alerts: Pick<Alerts, "raise">;
  /** 实际接 kernel 公口；只隔离独立告警事务，不放宽 Provider 的存活祖先守卫。 */
  readonly detach: <T>(fn: () => Promise<T>) => Promise<T>;
}
let binding: CalendarCoverageBinding | undefined;
export function bindCalendarCoverage(deps: CalendarCoverageBinding): () => void {
  const previous = binding;
  binding = deps;
  return () => {
    if (binding === deps) binding = previous;
  };
}
export async function checkCalendarCoverage(
  tx: Tx,
  deps: CalendarCoverageBinding,
): Promise<{ alerts: number }> {
  const alerts = await calendarCoverage(tx, deps.clock);
  for (const input of alerts) await deps.detach(() => deps.alerts.raise(input));
  return { alerts: alerts.length };
}
export async function runCalendarCoverage(tx: Tx | undefined) {
  if (!tx) throw new TypeError("calendar.coverage_check 缺少周期任务事务");
  if (!binding) throw new TypeError("calendar.coverage_check 尚未装配独立告警边界");
  return checkCalendarCoverage(tx, binding);
}
