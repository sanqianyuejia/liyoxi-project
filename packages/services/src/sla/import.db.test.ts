import { beforeAll, describe, expect, it } from "vitest";
import { assembleServices } from "../assembly.js";
import { createTxRunner, createIdentityContext } from "../kernel/index.js";
import { createEvents } from "../events/index.js";
import {
  createClock,
  createFactories,
  sampleStaffContext,
  useSeededDatabase,
} from "../testing/index.js";
import { createCalendarAdmin, calendarCoverage } from "./index.js";
import type { CalendarAdmin, CalendarImportActor } from "./index.js";
const db = useSeededDatabase("services");
const clock = createClock();
let prisma: Awaited<ReturnType<typeof db.prisma>>,
  calendar: CalendarAdmin,
  actor: CalendarImportActor;
beforeAll(async () => {
  prisma = await db.prisma();
  const tx = createTxRunner({ prisma, appEnv: "test" });
  const assembly = assembleServices({ entry: "api", appEnv: "test" });
  const staff = await createFactories({ db: prisma, clock }).staff({ staffRoleKey: "super_admin" });
  actor = {
    staff: await sampleStaffContext(prisma, staff.id),
    identity: createIdentityContext({ actor: { type: "staff", id: staff.id, client: "admin" } }),
  };
  calendar = createCalendarAdmin({ tx, clock, events: createEvents({ assembly, tx, clock }) });
}, 120000);
describe("W2-05 年度日历导入", { timeout: 120000 }, () => {
  it("内置2026正式7节6调休；重复零批次零事件零日期写入", async () => {
    const first = await calendar.import(actor, { year: 2026 });
    expect(first).toMatchObject({
      isChanged: false,
      holidayCount: 7,
      adjustedWorkdayCount: 6,
      source: "国办发明电〔2025〕7号",
    });
    const before = await prisma.workCalendarDay.findMany({ orderBy: { day: "asc" } });
    const events = await prisma.outboxEvent.count({ where: { eventType: "calendar.imported" } });
    const audits = await prisma.auditLog.count({ where: { action: "sys.calendar.import" } });
    const second = await calendar.import(actor, { year: 2026 });
    expect(second.isChanged).toBe(false);
    expect(await prisma.workCalendarDay.findMany({ orderBy: { day: "asc" } })).toEqual(before);
    expect(await prisma.outboxEvent.count({ where: { eventType: "calendar.imported" } })).toBe(
      events,
    );
    expect(await prisma.auditLog.count({ where: { action: "sys.calendar.import" } })).toBe(audits);
  });
  it("空年读侧无写入；缺内置年/跨年/重复/平日调休明确拒绝", async () => {
    expect((await calendar.list({ year: 2027, includeAllDays: true })).importedAt).toBeNull();
    const before = await prisma.workCalendarDay.count();
    const empty = await calendar.list({ year: 2028, includeAllDays: true });
    expect(empty).toMatchObject({ items: [], holidays: [], days: [], importedAt: null });
    expect(await prisma.workCalendarDay.count()).toBe(before);
    await expect(calendar.import(actor, { year: 2028 })).rejects.toMatchObject({
      error: "VALIDATION_FAILED",
      details: { fieldErrors: [{ path: "days" }] },
    });
    await expect(
      calendar.import(actor, { year: 2028, days: [], source: undefined }),
    ).rejects.toMatchObject({
      error: "VALIDATION_FAILED",
      details: { fieldErrors: [{ path: "source" }] },
    });
    await expect(
      calendar.import(actor, {
        year: 2028,
        days: [{ date: "2029-01-01", kind: "holiday", note: "错年" }],
        source: "测试依据",
      }),
    ).rejects.toMatchObject({ error: "VALIDATION_FAILED" });
    await expect(
      calendar.import(actor, {
        year: 2028,
        days: [{ date: "2028-01-03", kind: "adjusted_workday", note: "错日" }],
        source: "测试依据",
      }),
    ).rejects.toMatchObject({
      error: "VALIDATION_FAILED",
      details: { fieldErrors: [{ path: "days.0.kind" }] },
    });
    await expect(
      calendar.import(actor, {
        year: 2028,
        days: [
          { date: "2028-01-01", kind: "holiday", note: "甲" },
          { date: "2028-01-01", kind: "holiday", note: "乙" },
        ],
        source: "测试依据",
      }),
    ).rejects.toMatchObject({ error: "VALIDATION_FAILED" });
  });
  it("custom逐年铺底；kind变更全局升批次，同名连续合并，note-only不发事件", async () => {
    const first = await calendar.import(actor, {
      year: 2028,
      source: "人工修正依据",
      days: [
        { date: "2028-01-03", kind: "holiday", note: "测试节" },
        { date: "2028-01-04", kind: "holiday", note: "测试节" },
      ],
    });
    expect(first).toMatchObject({
      isChanged: true,
      changedDays: ["2028-01-03", "2028-01-04"],
      holidayCount: 1,
    });
    expect(first.calendar.holidays).toEqual([
      { name: "测试节", kind: "holiday", from: "2028-01-03", to: "2028-01-04", days: 2 },
    ]);
    expect((await calendar.list({ year: 2028, includeAllDays: true })).days).toHaveLength(366);
    const count = await prisma.outboxEvent.count({ where: { eventType: "calendar.imported" } });
    clock.advance(1);
    const note = await calendar.import(actor, {
      year: 2028,
      source: "名称更正依据",
      days: [
        { date: "2028-01-03", kind: "holiday", note: "更名节" },
        { date: "2028-01-04", kind: "holiday", note: "更名节" },
      ],
    });
    expect(note).toMatchObject({
      isChanged: false,
      changedDays: [],
      calendarVersion: first.calendarVersion,
    });
    expect(await prisma.outboxEvent.count({ where: { eventType: "calendar.imported" } })).toBe(
      count,
    );
    expect(note.calendar.holidays[0]?.name).toBe("更名节");
  });
  it("coverage用北京时间业务clock，到12月才拒绝只有下一年底的假导入", async () => {
    const tx = createTxRunner({ prisma, appEnv: "test" });
    clock.set(new Date("2026-11-30T15:59:59Z"));
    expect(await tx.run((t) => calendarCoverage(t, clock))).toEqual([]);
    clock.advance(1000);
    expect(await tx.run((t) => calendarCoverage(t, clock))).toEqual([
      {
        rule: "calendar.next_year_missing",
        dimension: "2027",
        severity: "P3",
        detail: { year: 2027 },
      },
    ]);
    await calendar.import(actor, { year: 2027, days: [], source: "测试安排已确认" });
    expect(await tx.run((t) => calendarCoverage(t, clock))).toEqual([]);
    clock.set(new Date("2035-01-01T02:00:00Z"));
    const alerts = await tx.run((t) => calendarCoverage(t, clock));
    expect(alerts[0]).toMatchObject({
      rule: "calendar.coverage_gap",
      severity: "P3",
      detail: { from: "2035-01-01", to: "2035-03-01" },
    });
  });
  it("跨年并发导入全局批次唯一，同年最后完整安排覆盖、不混合丢日", async () => {
    const [a, b] = await Promise.all([
      calendar.import(actor, {
        year: 2029,
        source: "甲年",
        days: [{ date: "2029-01-02", kind: "holiday", note: "甲年节" }],
      }),
      calendar.import(actor, {
        year: 2030,
        source: "乙年",
        days: [{ date: "2030-01-02", kind: "holiday", note: "乙年节" }],
      }),
    ]);
    expect(a.calendarVersion).not.toBe(b.calendarVersion);
    const values = await Promise.all([
      calendar.import(actor, {
        year: 2031,
        source: "安排甲",
        days: [{ date: "2031-01-02", kind: "holiday", note: "甲" }],
      }),
      calendar.import(actor, {
        year: 2031,
        source: "安排乙",
        days: [{ date: "2031-01-03", kind: "holiday", note: "乙" }],
      }),
    ]);
    const last = values.sort((x, y) => y.calendarVersion - x.calendarVersion)[0]!;
    expect((await calendar.list({ year: 2031, includeAllDays: false })).items).toEqual(
      last.calendar.items,
    );
    const events = await prisma.outboxEvent.findMany({ where: { eventType: "calendar.imported" } });
    expect(new Set(events.map((row) => row.dedupeKey)).size).toBe(events.length);
  });
});
