// 这次运行跑哪些检查项（W0-24）。纯函数，不连库。依据：15 分组 第 2.4 节“检查项的登记与调度”、第 4 节 scope。
//
//   1. 只挑登记了这种方式的；只经端口上报的检查项（modes 为空）不由框架运行。
//   2. every 只对定时触发生效，按计划时刻判定（北京时间）：hour 的项在 quick 里只跑整点那一期，
//      week 的项在 full 里只跑周一那一期。发布后、演练、手工触发跑该方式的全部检查项。
//   3. scope 的 modules、codes 用来挑检查项；since、entityIds 原样传给检查项。
import type { EnumValue, INVARIANT_RUN_TRIGGER } from "@liyoxi/contract/enums";
import { calendarDate, dayOfWeek, minuteOfDay } from "@liyoxi/shared/time";

import type { Collected, InvariantMode, InvariantRegistration } from "../../kernel/index.js";

export type InvariantTrigger = EnumValue<typeof INVARIANT_RUN_TRIGGER>;

export interface CheckSelection {
  readonly mode: InvariantMode;
  readonly trigger: InvariantTrigger;
  /** 定时触发的计划时刻（栅格时刻） */
  readonly scheduledFor?: Date;
  /** 只跑这些模块登记的 */
  readonly modules?: readonly string[];
  /** 只跑这些编号 */
  readonly codes?: readonly string[];
}

type Check = Collected<InvariantRegistration>;

/** 计划时刻是不是整点（北京时间；时区是整小时的偏移，分钟数与 UTC 相同） */
export const isTopOfHour = (at: Date): boolean => minuteOfDay(at) % 60 === 0;
/** 计划时刻是不是周一（北京时间） */
export const isMonday = (at: Date): boolean => dayOfWeek(calendarDate(at)) === 1;

function dueThisRound(check: Check, selection: CheckSelection): boolean {
  if (check.every === undefined || selection.trigger !== "schedule") return true;
  const at = selection.scheduledFor;
  if (at === undefined) return true;
  if (check.every === "hour") return selection.mode !== "quick" || isTopOfHour(at);
  return selection.mode !== "full" || isMonday(at);
}

/** 挑出这次要跑的检查项，次序同装配结果（按编号） */
export function selectChecks(invariants: readonly Check[], selection: CheckSelection): Check[] {
  const { modules, codes } = selection;
  return invariants.filter(
    (check) =>
      check.run !== undefined &&
      check.modes.includes(selection.mode) &&
      dueThisRound(check, selection) &&
      (modules === undefined || modules.includes(check.module)) &&
      (codes === undefined || codes.includes(check.code)),
  );
}
