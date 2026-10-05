// 定时器登记的对照（W0-17）：装配结果里的定时器处理器、周期任务，对照契约的 x01 登记查一遍，再给出运行时要查的表。
// 依据：x01 第 4.1、4.2 节；01 分组 第 2 节通用说明（kind 取值的唯一来源是 packages/contract）；任务书 第 10 节第 1 步。
// kernel 的装配只查写法与重名；名字在不在契约里、关键类与契约一不一致、周期任务的节奏写没写，在这里查。
// 有问题即抛 TimerRegistryError，问题一次列全：createTimers 在进程启动时调，等于启动失败。
import { JOBS, TIMERS } from "@liyoxi/contract/registry";

import { MISS_SEVERITIES, RECURRING_MODES } from "../kernel/index.js";
import type {
  Assembly,
  Collected,
  RecurringJobRegistration,
  RecurringSchedule,
} from "../kernel/index.js";
import { scheduleProblem } from "./schedule.js";

/** 名字的来源：有主体的定时器（kind × 主体）与周期任务。缺省即契约的登记；用例追加样例时另造一份 */
export interface TimerCatalog {
  readonly timers: readonly {
    readonly kind: string;
    readonly subject: string;
    readonly critical: boolean;
  }[];
  readonly jobs: readonly { readonly kind: string }[];
}

export const CONTRACT_TIMER_CATALOG: TimerCatalog = { timers: TIMERS, jobs: JOBS };

/** 一个有主体的 kind */
export interface TimerKindInfo {
  readonly kind: string;
  /** 契约里登记的主体表名 */
  readonly subjects: readonly string[];
  readonly critical: boolean;
  /** 处理器声明了“跳过后可复活”；本环境没有登记处理器时为 false */
  readonly rearmAfterSkip: boolean;
}

/** 写了节奏的周期任务登记 */
export type ScheduledJob = Collected<RecurringJobRegistration> & {
  readonly schedule: RecurringSchedule;
};

export interface TimerRegistry {
  /** 有主体的 kind；不在名字的来源里即 undefined */
  timer(kind: string): TimerKindInfo | undefined;
  /** 是不是登记过的周期任务名 */
  isJob(kind: string): boolean;
  /** 本环境生效的周期任务，按 kind 排序 */
  readonly recurringJobs: readonly ScheduledJob[];
}

export class TimerRegistryError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(
      `定时器登记与契约对不上，共 ${issues.length} 处：\n${issues.map((issue) => `  - ${issue}`).join("\n")}`,
    );
    this.name = "TimerRegistryError";
    this.issues = issues;
  }
}

const isPositiveInt = (value: unknown): boolean =>
  typeof value === "number" && Number.isInteger(value) && value > 0;

export function buildTimerRegistry(
  assembly: Assembly,
  catalog: TimerCatalog = CONTRACT_TIMER_CATALOG,
): TimerRegistry {
  const issues: string[] = [];
  const jobKinds = new Set(catalog.jobs.map((job) => job.kind));
  const kinds = new Map<string, TimerKindInfo>();

  for (const kind of new Set(catalog.timers.map((item) => item.kind))) {
    const rows = catalog.timers.filter((item) => item.kind === kind);
    const critical = rows.some((row) => row.critical);
    if (rows.some((row) => row.critical !== critical)) {
      issues.push(`${kind}：契约里它的几种主体关键类不一致`);
    }
    if (jobKinds.has(kind)) issues.push(`${kind}：契约里既是定时器又是周期任务`);
    const handler = assembly.timerHandler(kind);
    kinds.set(kind, {
      kind,
      subjects: rows.map((row) => row.subject),
      critical,
      rearmAfterSkip: handler?.rearmAfterSkip === true,
    });
  }

  for (const handler of assembly.timerHandlers) {
    const at = `定时器处理器 ${handler.kind}（模块 ${handler.module}）`;
    const known = kinds.get(handler.kind);
    if (known === undefined) {
      issues.push(`${at}：名字不在契约的定时器登记里`);
    } else if ((handler.critical ?? false) !== known.critical) {
      issues.push(`${at}：critical 与契约不一致，契约登记的是${known.critical ? "" : "非"}关键类`);
    }
    if (handler.maxLateMinutes !== undefined && !isPositiveInt(handler.maxLateMinutes)) {
      issues.push(`${at}：maxLateMinutes 要是正整数`);
    }
  }

  for (const job of assembly.recurringJobs) {
    const at = `周期任务 ${job.kind}（模块 ${job.module}）`;
    if (!jobKinds.has(job.kind)) issues.push(`${at}：名字不在契约的周期任务登记里`);
    const problem = scheduleProblem(job.schedule);
    if (problem !== undefined) issues.push(`${at}：${problem}`);
    if (job.mode !== undefined && !RECURRING_MODES.includes(job.mode)) {
      issues.push(`${at}：mode 只能是 ${RECURRING_MODES.join("、")}`);
    }
    if (job.missSeverity !== undefined && !MISS_SEVERITIES.includes(job.missSeverity)) {
      issues.push(`${at}：missSeverity 只能是 ${MISS_SEVERITIES.join("、")}`);
    }
    for (const field of ["leaseSec", "maxAttempts", "deadlineMin"] as const) {
      if (job[field] !== undefined && !isPositiveInt(job[field])) {
        issues.push(`${at}：${field} 要是正整数`);
      }
    }
  }

  if (issues.length > 0) throw new TimerRegistryError(issues);
  return {
    timer: (kind) => kinds.get(kind),
    isJob: (kind) => jobKinds.has(kind),
    recurringJobs: assembly.recurringJobs as readonly ScheduledJob[],
  };
}
