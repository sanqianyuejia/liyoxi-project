// flow 的“工作分钟”端口的实现（W0-30a）：两个时刻之间落在工作时段内的分钟数，按库里的工作日历与工作时段算。
// 依据：01 分组 第 2.6、2.7 节；D3 第 22.1、22.2 节；14 分组 第 2.3 节。登记在本目录的 register.ts。
//
//   1. 端口的实现是装配时静态登记的，手里只有 flow 传进来的事务句柄：日历与工作时段都经这个句柄读，
//      与迁移同一个事务。工作时段不走配置服务的缓存：算出来的数写进只增表，事后改不了。
//   2. 工作时段取“写入那一刻”（span.to）生效的 work.start、work.end，整段都按它算；库里没有即代码默认值。
//      库里配反了（上班不早于下班）用代码默认值，不让迁移失败；配错由 config 的自检报。
//   3. 日历里没有的日期照纯函数按“周一至周五工作”兜底，不抛错。这里拿不到装配结果，不告警：
//      缺行由不变量 sla.N8 与日历覆盖检查报。要告警的调用方用 createSla 给的 workMinutesBetween。
//   4. 不扣午休（01 分组 第 2.7 节）。
import { checkParamPairs, paramDef } from "@liyoxi/shared/params";
import { calendarDate } from "@liyoxi/shared/time";
import { workingMinutesBetween } from "@liyoxi/shared/workcal";

import { paramsAt } from "../config/index.js";
import type { WorkMinutes } from "../flow/index.js";
import type { Tx } from "../kernel/index.js";
import { loadWorkCalendar } from "./calendar.js";
import type { WorkHours } from "./calendar.js";

const WORK_HOURS_KEYS = ["work.start", "work.end"] as const;

/** 代码里的默认工作时段：两个参数定义的默认值 */
export const DEFAULT_WORK_HOURS: WorkHours = {
  start: paramDef("work.start")?.default as string,
  end: paramDef("work.end")?.default as string,
};

/** 某一时刻生效的工作时段：经给定的句柄读参数 work.start、work.end，不走缓存 */
export async function workHoursAt(tx: Tx, at: Date): Promise<WorkHours> {
  const values = await paramsAt(tx, WORK_HOURS_KEYS, at);
  if (checkParamPairs(values).length > 0) return DEFAULT_WORK_HOURS;
  return { start: values["work.start"], end: values["work.end"] };
}

/** 端口 flow.workMinutes 的实现：读库里的工作日历与工作时段 */
export const calendarWorkMinutes: WorkMinutes = {
  async between(tx, { from, to }) {
    const hours = await workHoursAt(tx, to);
    const range = { from: calendarDate(from), to: calendarDate(to) };
    const calendar = await loadWorkCalendar(tx, range, hours);
    return workingMinutesBetween(calendar, from, to).minutes;
  },
};
