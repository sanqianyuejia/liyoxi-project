import * as calendars from "@liyoxi/shared/calendar";
import { describe, expect, it } from "vitest";
describe("公开内置年度数据", () => {
  it("仅公布2026且纯数据出口不假造次年", () => {
    expect(Object.keys(calendars).sort()).toEqual([
      "BUILTIN_CALENDARS",
      "CALENDAR_2026",
      "SUPPORTED_CALENDAR_YEARS",
    ]);
    expect(calendars.SUPPORTED_CALENDAR_YEARS).toEqual([2026]);
    expect(calendars.CALENDAR_2026.source).toBe("国办发明电〔2025〕7号");
    expect(calendars.CALENDAR_2026.holidays).toHaveLength(7);
    expect(calendars.CALENDAR_2026.adjustedWorkdays).toHaveLength(6);
    for (const [, day] of calendars.CALENDAR_2026.adjustedWorkdays)
      expect([0, 6]).toContain(new Date(`2026-${day}T00:00:00Z`).getUTCDay());
  });
});
