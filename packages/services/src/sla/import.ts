import {
  CalendarImportBodySchema,
  CalendarImportResultSchema,
  CalendarYearSchema,
} from "@liyoxi/contract";
import type { CalendarListQuerySchema, z } from "@liyoxi/contract";
import { BUILTIN_CALENDARS } from "@liyoxi/shared/calendar";
import { addDays } from "@liyoxi/shared/time";
import { record } from "../audit/index.js";
import { assertAccess } from "../authz/index.js";
import type { StaffContext } from "../authz/index.js";
import type { Events } from "../events/index.js";
import { AppError } from "../kernel/index.js";
import type { Clock, IdentityContext, Tx, TxRunner, TxRunOptions } from "../kernel/index.js";
import type { AuditRequestMeta } from "../audit/index.js";
import { currentCalendarVersion, lockCalendarImport } from "./calendar.js";
import { calendarDaysOf } from "./seed.js";
import { workHoursAt } from "./work-minutes.js";

export interface CalendarAdminDeps {
  tx: TxRunner;
  clock: Clock;
  events: Pick<Events, "emit">;
}
export interface CalendarImportActor {
  staff: StaffContext;
  identity: IdentityContext;
  meta?: AuditRequestMeta;
}
const invalid = (path: string, message: string): never => {
  throw new AppError("VALIDATION_FAILED", { details: { fieldErrors: [{ path, message }] } });
};
const utc = (date: string) => new Date(`${date}T00:00:00.000Z`);
const iso = (date: Date) => date.toISOString().slice(0, 10);
function daysOf(input: z.infer<typeof CalendarImportBodySchema>) {
  const builtin = BUILTIN_CALENDARS.find((item) => item.year === input.year);
  if (input.days === undefined && !builtin)
    return invalid("days", "该年份的放假安排尚未内置，请升级版本或提供 days");
  if (input.days !== undefined && !input.source) invalid("source", "自定义例外日须说明依据");
  const source = input.days === undefined ? builtin!.source : input.source!;
  const days = calendarDaysOf(
    input.year,
    input.days === undefined
      ? builtin
      : { year: input.year, source, holidays: [], adjustedWorkdays: [] },
  );
  if (input.days) {
    const seen = new Set<string>();
    const byDate = new Map(days.map((day) => [day.day, day]));
    for (const [index, day] of input.days.entries()) {
      if (!day.date.startsWith(`${input.year}-`) || !byDate.has(day.date))
        invalid(`days.${index}.date`, "日期不在该年份");
      if (seen.has(day.date)) invalid(`days.${index}.date`, "日期不能重复");
      seen.add(day.date);
      const date = utc(day.date);
      if (day.kind === "adjusted_workday" && date.getUTCDay() !== 0 && date.getUTCDay() !== 6)
        invalid(`days.${index}.kind`, "调休上班日只能是周末");
      byDate.set(day.date, { day: day.date, kind: day.kind, note: day.note });
    }
    return { days: [...byDate.values()], source };
  }
  return { days, source };
}
export async function readCalendarYear(
  tx: Tx,
  clock: Clock,
  query: z.infer<typeof CalendarListQuerySchema>,
) {
  await lockCalendarImport(tx);
  const rows = await tx.workCalendarDay.findMany({
    where: { day: { gte: utc(`${query.year}-01-01`), lt: utc(`${query.year + 1}-01-01`) } },
    orderBy: { day: "asc" },
  });
  const items = rows
    .filter((row) => row.kind === "holiday" || row.kind === "adjusted_workday")
    .map((row) => ({
      date: iso(row.day),
      kind: row.kind as "holiday" | "adjusted_workday",
      note: row.note ?? "",
    }));
  const holidays: Array<{
    name: string;
    kind: "holiday" | "adjusted_workday";
    from: string;
    to: string;
    days: number;
  }> = [];
  for (const item of items) {
    const last = holidays.at(-1);
    if (
      last &&
      last.name === item.note &&
      last.kind === item.kind &&
      addDays(last.to, 1) === item.date
    ) {
      last.to = item.date;
      last.days++;
    } else
      holidays.push({ name: item.note, kind: item.kind, from: item.date, to: item.date, days: 1 });
  }
  const imported = await tx.auditLog.findFirst({
    where: {
      action: "sys.calendar.import",
      targetType: "work_calendar_day",
      targetKey: String(query.year),
    },
    select: { id: true },
  });
  const latest = rows.reduce<Date | null>(
    (at, row) => (!at || row.updatedAt > at ? row.updatedAt : at),
    null,
  );
  return CalendarYearSchema.parse({
    items,
    year: query.year,
    calendarVersion: await currentCalendarVersion(tx),
    holidays,
    days: query.includeAllDays
      ? rows.map((row) => ({ date: iso(row.day), kind: row.kind, isWorkday: row.isWorkday }))
      : null,
    importedAt: items.length || imported ? (latest?.toISOString() ?? null) : null,
    workHours: await workHoursAt(tx, clock.now()),
  });
}
export function createCalendarAdmin(deps: CalendarAdminDeps) {
  return {
    list: (query: z.infer<typeof CalendarListQuerySchema>) =>
      deps.tx.run((tx) => readCalendarYear(tx, deps.clock, query)),
    async import(
      ctx: CalendarImportActor,
      body: z.infer<typeof CalendarImportBodySchema>,
      options: TxRunOptions = {},
    ) {
      assertAccess(ctx.staff, { module: null, permission: "sys.param.edit" });
      if (ctx.identity.actor.type !== "staff" || ctx.identity.actor.id !== ctx.staff.staff.id)
        throw new AppError("PERMISSION_DENIED");
      const input = CalendarImportBodySchema.parse(body);
      const { days, source } = daysOf(input);
      return deps.tx.run(async (tx) => {
        // calendarVersion 是全表批次，跨年度导入也共用这把配置咨询锁。
        await lockCalendarImport(tx, "exclusive");
        const now = deps.clock.now();
        const old = await tx.workCalendarDay.findMany({
          where: { day: { gte: utc(`${input.year}-01-01`), lt: utc(`${input.year + 1}-01-01`) } },
        });
        const before = new Map(old.map((row) => [iso(row.day), row]));
        const changedDays = days
          .filter((day) => {
            const prior = before.get(day.day);
            // 缺行先铺平日/周末底；只有例外 kind 更正才发新批次。
            const baseline = utc(day.day).getUTCDay() % 6 === 0 ? "weekend" : "weekday";
            return day.kind !== (prior?.kind ?? baseline);
          })
          .map((day) => day.day);
        const previousVersion = await currentCalendarVersion(tx);
        const version = changedDays.length ? previousVersion + 1 : previousVersion;
        const changes = days.filter(
          (day) =>
            !before.has(day.day) ||
            before.get(day.day)!.kind !== day.kind ||
            before.get(day.day)!.note !== day.note,
        );
        const missing = changes.filter((day) => !before.has(day.day));
        if (missing.length)
          await tx.workCalendarDay.createMany({
            data: missing.map((day) => ({
              day: utc(day.day),
              kind: day.kind,
              note: day.note,
              isWorkday: day.kind === "weekday" || day.kind === "adjusted_workday",
              calendarVersion: changedDays.includes(day.day)
                ? version
                : Math.max(1, previousVersion),
              createdAt: now,
              updatedAt: now,
            })),
          });
        for (const day of changes.filter((day) => before.has(day.day)))
          await tx.workCalendarDay.update({
            where: { day: utc(day.day) },
            data: {
              kind: day.kind,
              note: day.note,
              isWorkday: day.kind === "weekday" || day.kind === "adjusted_workday",
              ...(changedDays.includes(day.day) ? { calendarVersion: version } : {}),
              updatedAt: now,
            },
          });
        if (changedDays.length)
          await deps.events.emit(tx, ctx.identity, {
            type: "calendar.imported",
            aggregate: null,
            dedupeKey: `calendar.imported:${version}`,
            payload: { v: 1, calendarVersion: version, year: input.year, changedDays },
          });
        const latestAudit = await tx.auditLog.findFirst({
          where: { action: "sys.calendar.import", targetKey: String(input.year) },
          orderBy: { seq: "desc" },
        });
        const oldSource =
          latestAudit?.meta &&
          typeof latestAudit.meta === "object" &&
          !Array.isArray(latestAudit.meta) &&
          "source" in latestAudit.meta
            ? latestAudit.meta.source
            : null;
        if (changes.length || oldSource !== source)
          await record(
            tx,
            ctx.identity.actor,
            ctx.meta ?? {
              requestId: ctx.identity.requestId,
              ip: ctx.identity.ip,
              userAgent: ctx.identity.userAgent,
              authMethod: null,
              sessionId: null,
            },
            {
              stream: "ops",
              category: "param",
              action: "sys.calendar.import",
              summary: "导入年度放假安排",
              target: { type: "work_calendar_day", id: String(input.year) },
              meta: { changedDays, source },
              before: {
                days: old.map((row) => ({ date: iso(row.day), kind: row.kind, note: row.note })),
              },
              after: {
                days: days.map((day) => ({ date: day.day, kind: day.kind, note: day.note })),
              },
              fields: ["days"],
            },
          );
        const calendar = await readCalendarYear(tx, deps.clock, {
          year: input.year,
          includeAllDays: false,
        });
        return CalendarImportResultSchema.parse({
          year: input.year,
          isChanged: changedDays.length > 0,
          changedDays,
          calendarVersion: calendar.calendarVersion,
          holidayCount: new Set(days.filter((day) => day.kind === "holiday").map((day) => day.note))
            .size,
          adjustedWorkdayCount: days.filter((day) => day.kind === "adjusted_workday").length,
          source,
          calendar,
        });
      }, options);
    },
  };
}
export type CalendarAdmin = ReturnType<typeof createCalendarAdmin>;
