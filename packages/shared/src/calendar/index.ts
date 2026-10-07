import { CALENDAR_2026 } from "./2026.js";
export { CALENDAR_2026 } from "./2026.js";
export const BUILTIN_CALENDARS = [CALENDAR_2026] as const;
export const SUPPORTED_CALENDAR_YEARS = BUILTIN_CALENDARS.map((year) => year.year);
