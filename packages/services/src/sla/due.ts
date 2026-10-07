// 时限计算与时限快照（W0-17）。依据：D3 第 22.2–22.4 节；01 分组 第 2.7、4 节；14 分组 第 4.2 节。
//
//   1. 策略值（policy、amount、unit）与工作时段由调用方传入：本模块不读 config。
//   2. 计算是 @liyoxi/shared/workcal 的纯函数；这里只管把日历读出来、把快照拼出来。
//   3. 算的过程用到了库里没有的日期：按“周一至周五工作”兜底，并调一次告警端口（一次计算至多一条）。
//   4. 快照的 computedAt 取注入的时钟；calendarVersion 是计算时全表最大的批次号。
import { addDays, calendarDate } from "@liyoxi/shared/time";
import type { LocalDate } from "@liyoxi/shared/time";
import { dueAt as dueAtPure, workingMinutesBetween } from "@liyoxi/shared/workcal";
import type { FallbackInfo, SlaPolicy, WorkCalendar } from "@liyoxi/shared/workcal";

import { alertsOf } from "../kernel/index.js";
import type { Assembly, Clock, Tx } from "../kernel/index.js";
import { currentCalendarVersion, loadWorkCalendar, lockCalendarImport } from "./calendar.js";
import type { WorkHours } from "./calendar.js";

export type SlaUnit = SlaPolicy["unit"];
export const SLA_UNITS: readonly SlaUnit[] = [
  "work_minutes",
  "work_days",
  "natural_hours",
  "natural_days",
  "same_day_cutoff",
];

/** 全仓共用的时限快照（01 分组 第 4 节）：各表的 sla_snapshot 列与时限类 timer.payload 都是这个结构 */
export interface SlaSnapshot {
  /** 时限策略编码：参数键去掉 sla. 前缀，如 ticket.plan_confirm */
  readonly policy: string;
  /** 时限数值；same_day_cutoff 时是截止时刻距当日零点的分钟数 */
  readonly amount: number;
  readonly unit: SlaUnit;
  readonly calendarVersion: number;
  /** ISO 时间 */
  readonly computedAt: string;
}

export interface DueInput {
  readonly policy: string;
  readonly amount: number;
  readonly unit: SlaUnit;
  /** 起算时刻 */
  readonly from: Date;
  readonly workHours: WorkHours;
}

export interface DueResult {
  readonly dueAt: Date;
  readonly snapshot: SlaSnapshot;
  /** 算的过程中库里没有、按“周一至周五工作”兜底的日期；没有即空 */
  readonly fallbackDates: readonly LocalDate[];
}

export interface WorkMinutesInput {
  readonly from: Date;
  readonly to: Date;
  readonly workHours: WorkHours;
}

export interface SlaDeps {
  readonly assembly: Assembly;
  readonly clock: Clock;
}

export interface Sla {
  /** 按策略算截止时刻，并给出要存进单据的时限快照 */
  dueAt(tx: Tx, input: DueInput): Promise<DueResult>;
  /** from 到 to 之间落在工作时段内的分钟数；日历缺行时告警。flow 的“工作分钟”端口另有实现，见 work-minutes.ts */
  workMinutesBetween(tx: Tx, input: WorkMinutesInput): Promise<number>;
}

/** 日历兜底的告警规则键（本包定）：日期超出已有日历 */
export const CALENDAR_FALLBACK_RULE = "sla.calendar_fallback";

/** 先读这么多天的日历；不够（算到了窗口之外）就放大再读，至多放大到 MAX_WINDOW_DAYS */
const FIRST_WINDOW_DAYS = 45;
const MAX_WINDOW_DAYS = 2_880;

/** 不看日历的单位用它占位 */
const NO_CALENDAR: WorkCalendar = {
  isWorkday: () => undefined,
  workStartMinute: 0,
  workEndMinute: 24 * 60,
};

/** 读一段从 fromDate 起的日历去算；算到了窗口外面就放大窗口重算。返回结果与真正缺行的日期 */
async function withCalendar<T extends FallbackInfo>(
  tx: Tx,
  fromDate: LocalDate,
  hours: WorkHours,
  needDays: number,
  compute: (calendar: WorkCalendar) => T,
): Promise<{ value: T; gaps: LocalDate[] }> {
  for (let span = Math.max(FIRST_WINDOW_DAYS, needDays); ; span *= 4) {
    const to = addDays(fromDate, span);
    const value = compute(await loadWorkCalendar(tx, { from: fromDate, to }, hours));
    // 窗口里没有的日期才是库里真的缺行；窗口外面的只是还没读
    if (span >= MAX_WINDOW_DAYS || value.fallbackDates.every((date) => date <= to)) {
      return { value, gaps: value.fallbackDates };
    }
  }
}

export function createSla(deps: SlaDeps): Sla {
  const alerts = alertsOf(deps.assembly);

  const alertOnGaps = async (gaps: readonly LocalDate[], policy?: string): Promise<void> => {
    if (gaps.length === 0) return;
    await alerts.raise({
      rule: CALENDAR_FALLBACK_RULE,
      severity: "P2",
      detail: { policy, count: gaps.length, dates: gaps.slice(0, 31) },
    });
  };

  return {
    async dueAt(tx, input) {
      await lockCalendarImport(tx);
      const { policy, amount, unit, from, workHours } = input;
      if (typeof policy !== "string" || policy === "") throw new TypeError("sla：policy 不得为空");
      if (!SLA_UNITS.includes(unit)) throw new TypeError(`sla：不认识的时限单位 ${String(unit)}`);
      const calendarVersion = await currentCalendarVersion(tx);
      const fromDate = calendarDate(from);
      // 自然小时、自然日不看日历，不读库
      const natural = unit === "natural_hours" || unit === "natural_days";
      const needDays = unit === "work_days" ? amount * 2 : Math.ceil(amount / 60);
      const { value, gaps } = natural
        ? { value: dueAtPure(NO_CALENDAR, from, { amount, unit }), gaps: [] }
        : await withCalendar(tx, fromDate, workHours, needDays, (calendar) =>
            dueAtPure(calendar, from, { amount, unit }),
          );
      await alertOnGaps(gaps, policy);
      return {
        dueAt: value.at,
        snapshot: {
          policy,
          amount,
          unit,
          calendarVersion,
          computedAt: deps.clock.now().toISOString(),
        },
        fallbackDates: gaps,
      };
    },

    async workMinutesBetween(tx, { from, to, workHours }) {
      await lockCalendarImport(tx);
      const range = { from: calendarDate(from), to: calendarDate(to) };
      const calendar = await loadWorkCalendar(tx, range, workHours);
      const result = workingMinutesBetween(calendar, from, to);
      await alertOnGaps(result.fallbackDates);
      return result.minutes;
    },
  };
}
