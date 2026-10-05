// sla 模块发出的事件的载荷（docs/api/x01-events-jobs.md 第 3.1 节；01 分组 第 4 节）。
// 载荷规则见 x01 第 2.3 节 P1–P7：{ v: 数字, … }，只放 id、业务日期、关键数字与枚举；不放 P5 列的内容。
import { DateSchema } from "../common/scalars.js";
import { z } from "../zod.js";

const ascendingAndDistinct = (days: readonly string[]): boolean =>
  days.every((day, index) => index === 0 || day > (days[index - 1] as string));

/** calendar.imported：导入年度放假安排且至少一天的 kind 变化 */
export const calendarImportedPayload = z.strictObject({
  v: z.literal(1),
  /** 本次导入取得的新批次号 */
  calendarVersion: z.int().positive(),
  /** 导入的年份 */
  year: z.int().min(2000).max(2999),
  /** kind 变化的日期，YYYY-MM-DD，升序；至少一天，一年至多 366 天 */
  changedDays: z
    .array(DateSchema)
    .min(1)
    .max(366)
    .refine(ascendingAndDistinct, "日期须升序且不重复"),
});

export const payloads = {
  "calendar.imported": calendarImportedPayload,
} as const;
