// 定时器的样例（W0-17）：样例 kind、带样例的名字来源、一份样例登记。只给测试用，不进生产装配。
// 样例的名字带 lyxtest 前缀，不进契约的登记：建 timers 时把 SAMPLE_TIMER_CATALOG 传给 catalog。
// 后面的包要加自己的样例 kind：extendTimerCatalog 另造一份。
import { defineRegistration } from "../kernel/index.js";
import type { ModuleRegistration } from "../kernel/index.js";
import { CONTRACT_TIMER_CATALOG } from "../timers/index.js";
import type { TimerCatalog } from "../timers/index.js";

/** 样例主体的“表名”：库里只校验写法，不要求真有这张表 */
export const SAMPLE_TIMER_SUBJECT = "lyxtest_row";

export const SAMPLE_TIMER_KINDS = {
  /** 普通的定时器：非关键类，跳过后不复活 */
  plain: "lyxtest.plain",
  /** 关键类，声明了跳过后可复活（order.start 是这种） */
  revivable: "lyxtest.revivable",
} as const;

export const SAMPLE_JOB_KINDS = {
  /** 每 5 分钟，补最近一格 */
  every5: "lyxtest.every5",
  /** 每日 03:30，不补 */
  daily: "lyxtest.daily",
  /** 每月 1 日 10:00，不补 */
  monthly: "lyxtest.monthly",
  /** 只在预发登记 */
  stgOnly: "lyxtest.stg_only",
} as const;

/** 契约的登记之外再追加名字 */
export function extendTimerCatalog(extra: Partial<TimerCatalog>): TimerCatalog {
  return {
    timers: [...CONTRACT_TIMER_CATALOG.timers, ...(extra.timers ?? [])],
    jobs: [...CONTRACT_TIMER_CATALOG.jobs, ...(extra.jobs ?? [])],
  };
}

export const SAMPLE_TIMER_CATALOG: TimerCatalog = extendTimerCatalog({
  timers: [
    { kind: SAMPLE_TIMER_KINDS.plain, subject: SAMPLE_TIMER_SUBJECT, critical: false },
    { kind: SAMPLE_TIMER_KINDS.revivable, subject: SAMPLE_TIMER_SUBJECT, critical: true },
  ],
  jobs: Object.values(SAMPLE_JOB_KINDS).map((kind) => ({ kind })),
});

const noop = async (): Promise<void> => undefined;

/** 样例登记：两个定时器处理器、四个周期任务。处理器什么都不做（执行在 W0-23） */
export const sampleTimerRegistration: ModuleRegistration = defineRegistration("lyxtest_timers", {
  timerHandlers: [
    { kind: SAMPLE_TIMER_KINDS.plain, handle: async () => "fired" },
    {
      kind: SAMPLE_TIMER_KINDS.revivable,
      critical: true,
      rearmAfterSkip: true,
      handle: async () => "fired",
    },
  ],
  recurringJobs: [
    {
      kind: SAMPLE_JOB_KINDS.every5,
      schedule: { every: "minutes", minutes: 5 },
      catchUp: true,
      run: noop,
    },
    {
      kind: SAMPLE_JOB_KINDS.daily,
      schedule: { every: "day", at: "03:30" },
      mode: "job",
      run: noop,
    },
    {
      kind: SAMPLE_JOB_KINDS.monthly,
      schedule: { every: "month", day: 1, at: "10:00" },
      run: noop,
    },
    {
      kind: SAMPLE_JOB_KINDS.stgOnly,
      schedule: { every: "minutes", minutes: 5 },
      envs: ["stg"],
      run: noop,
    },
  ],
});
