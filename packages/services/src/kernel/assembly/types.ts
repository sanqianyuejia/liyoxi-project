// 服务装配的注册接口（W0-07b）：各模块在自己的 register.ts 里登记的六类东西，全仓只在这里定义。
// 依据：计划 第 5.1、9.3 节；01 第 5 节调用规则 5；D7 第 2.3 节规则 3、第 7.6、9.6 节；15 分组 第 2.4、5.3 节。
//
//   ① 订阅者  ② 定时器处理器  ③ 周期任务  ④ 端口实现  ⑤ 不变量  ⑥ 清理
//
// 后面的包要给某一类加字段（节奏、模式、租期、关键类……）：在这里只增可选字段，不改已有字段。
// 处理函数拿到的对象（DeliveredEvent、FiredTimer、各个 Context）同理：只增字段。
// 名字在不在契约的登记里、关键类与契约一不一致，不在这里管：由 events（W0-15）、timers（W0-17）在装配后对照。
// 落库的取值（不变量的级别与模式、定时器的结果）只从契约的枚举来，不在这里另写一份。
import { INVARIANT_RUN_MODE, INVARIANT_VIOLATION_SEVERITY } from "@liyoxi/contract/enums";
import type { EnumValue, TIMER_STATUS } from "@liyoxi/contract/enums";

import type { AppEnv } from "../env.js";
import type { Tx } from "../tx.js";

/** 装配的两个入口：同一个 server 镜像的两个进程 */
export const ASSEMBLY_ENTRIES = ["api", "worker"] as const;
export type AssemblyEntry = (typeof ASSEMBLY_ENTRIES)[number];

/** 六类登记项共有：只在这些环境里登记。不写即全部环境；写了就不得为空 */
export interface EnvScoped {
  /** 如预发专用的任务写 ["stg"]：别的环境里它不进装配结果，等于不存在（D7 第 10.7 节） */
  readonly envs?: readonly AppEnv[];
}

// ---------- ① 订阅者 ----------

/** 交给订阅者的出站事件。订阅者回库读当前状态，不依赖载荷里的状态值（x01 第 2.3 节 P2） */
export interface DeliveredEvent {
  /** outbox_event.id */
  readonly id: string;
  /** outbox_event.event_type */
  readonly type: string;
  /** 载荷 { v: 1, … } */
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface SubscriberRegistration extends EnvScoped {
  /** 订阅者名，即 outbox_delivery.subscriber，写法 <模块>.on<事实> */
  readonly name: string;
  /** 订阅的事件名 */
  readonly events: readonly string[];
  /** 关键类（x01 第 2.4 节 E7）。可以不写：以契约的订阅者登记为准；写了与契约不一致，events 在装配后报错（W0-15） */
  readonly critical?: boolean;
  /** 与投递行的“已消费”同事务；要幂等（x01 第 2.4 节 E4） */
  readonly handle: (tx: Tx, event: DeliveredEvent) => Promise<void>;
}

// ---------- ② 定时器处理器 ----------

/** 到点的定时器行 */
export interface FiredTimer {
  /** timer.id */
  readonly id: string;
  readonly kind: string;
  /** 主体的表名与主键；周期任务行为空 */
  readonly subjectType: string | null;
  readonly subjectId: string | null;
  /** 登记时的参数快照 */
  readonly payload: Readonly<Record<string, unknown>> | null;
}

/** 处理结果：fired 已执行；skipped 条件已不成立而跳过。是契约 timer.status 取值里处理器能给出的两个 */
export const TIMER_OUTCOMES = ["fired", "skipped"] as const satisfies readonly EnumValue<
  typeof TIMER_STATUS
>[];
export type TimerOutcome = (typeof TIMER_OUTCOMES)[number];

export interface TimerHandlerRegistration extends EnvScoped {
  /** timer.kind（有主体的定时器） */
  readonly kind: string;
  /** 与定时器行的状态更新同事务 */
  readonly handle: (tx: Tx, timer: FiredTimer) => Promise<TimerOutcome>;
  /** 关键类：晚了也必须做，Redis 不可用时在进程内执行，失败不进终态。要与契约的登记一致；不写即否（W0-17） */
  readonly critical?: boolean;
  /** 跳过后可复活：同键 arm 遇到 skipped 行时置回 scheduled（01 分组 第 2.5 节；V1.0 只有 order.start）（W0-17） */
  readonly rearmAfterSkip?: boolean;
  /** 触发时已晚于到期时间这么多分钟就跳过、不补做；不写即不限（D3 第 21.2 节）（W0-17） */
  readonly maxLateMinutes?: number;
}

// ---------- ③ 周期任务 ----------

export interface RecurringRunContext {
  /** 本期的计划时刻（栅格时刻），不是“现在” */
  readonly scheduledFor: Date;
  /** tx 模式才有：本期所在的事务，业务写与“已触发”同事务（W0-23） */
  readonly tx?: Tx;
  /** job 模式才有：续租发现这一期已被接管或取消时中止，处理器看到即收手（W0-23） */
  readonly signal?: AbortSignal;
  /** job 模式才有：处理器在事务外执行，要写库时用它自己开小事务（W0-23） */
  readonly runTx?: <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;
}

/**
 * 周期任务的节奏（W0-17），都按 Asia/Shanghai。at 写 "HH:mm"。
 * minutes：每 N 分钟，对齐到固定栅格 floor(epoch ÷ 间隔) × 间隔；hour：每小时的第 minute 分（不写即整点）；
 * day：每日；week：每周几（1 = 周一 … 7 = 周日）；month：每月几日（1–28）。
 */
export type RecurringSchedule =
  | { readonly every: "minutes"; readonly minutes: number }
  | { readonly every: "hour"; readonly minute?: number }
  | { readonly every: "day"; readonly at: string }
  | { readonly every: "week"; readonly weekday: number; readonly at: string }
  | { readonly every: "month"; readonly day: number; readonly at: string };

/** tx：在一个事务里做完；job：认领后在事务外执行、按租期续租（x01 第 4.2 节；D7 第 7.6 节） */
export const RECURRING_MODES = ["tx", "job"] as const;
export type RecurringMode = (typeof RECURRING_MODES)[number];
/** 周期任务漏跑告警的级别 */
export const MISS_SEVERITIES = ["P1", "P2", "P3"] as const;
export type MissSeverity = (typeof MISS_SEVERITIES)[number];

export interface RecurringJobRegistration extends EnvScoped {
  /** timer.kind（无主体）。与定时器处理器共用一个名字空间，不能同名 */
  readonly kind: string;
  /** 返回的摘要写进定时器行的 result；没有摘要就不返回 */
  readonly run: (ctx: RecurringRunContext) => Promise<Readonly<Record<string, unknown>> | void>;
  /** 节奏。类型上可选（只增字段），timers 在装配后要求每个周期任务都写（W0-17） */
  readonly schedule?: RecurringSchedule;
  /** 不写即 tx（W0-17） */
  readonly mode?: RecurringMode;
  /** job 模式的租期，秒（W0-17） */
  readonly leaseSec?: number;
  /** job 模式至多执行几次，超过即 failed（W0-17） */
  readonly maxAttempts?: number;
  /** 完成期限：计划时刻之后多少分钟内应变为 fired；漏跑告警用（W0-17） */
  readonly deadlineMin?: number;
  /** 漏跑级别；不写即不告警（如只在预发的任务）（W0-17） */
  readonly missSeverity?: MissSeverity;
  /** 补登记时把“最近一个已到的计划时刻”那一格也补上，只补这一格；不写即否（D7 第 7.6 节）（W0-17） */
  readonly catchUp?: boolean;
}

// ---------- ④ 端口 ----------
// 下层定义接口，上层在装配时注册实现（01 第 5 节调用规则 5）。定义端口的模块在自己的登记里声明它（ports），
// 实现它的模块登记实现（portImplementations）。装配时：声明了、没有默认实现、又没人实现的端口即报错。

declare const PORT_SHAPE: unique symbol;

/** 单实现的端口：一个环境里至多一个模块实现它。可带默认实现，没人实现时用它 */
export interface Port<T> {
  readonly name: string;
  readonly keyed: false;
  readonly fallback: T | undefined;
}

/** 按键多实现的端口：各模块各登记自己那个键的实现（如各类审批的执行器）。可以一个实现都没有 */
export interface KeyedPort<T> {
  readonly name: string;
  readonly keyed: true;
  /** 只在类型上：记住实现的形状 */
  readonly [PORT_SHAPE]?: T;
}

export type AnyPort = Port<unknown> | KeyedPort<unknown>;

/** 定义一个单实现的端口。名字小写点分，如 alerts.raise；fallback 是没人实现时的默认实现（空实现） */
export function definePort<T>(name: string, options: { fallback?: T } = {}): Port<T> {
  return { name, keyed: false, fallback: options.fallback };
}

/** 定义一个按键多实现的端口 */
export function defineKeyedPort<T>(name: string): KeyedPort<T> {
  return { name, keyed: true };
}

/** 端口实现的一条登记。用 implement、implementKeyed 造，不手写：它们把实现的类型与端口对上 */
export interface PortImplementation extends EnvScoped {
  readonly port: AnyPort;
  /** 按键端口的键；单实现的端口没有 */
  readonly key?: string;
  readonly impl: unknown;
}

/** 登记单实现端口的实现 */
export function implement<T>(port: Port<T>, impl: T, options: EnvScoped = {}): PortImplementation {
  return { port, impl, ...options };
}

/** 登记按键端口里一个键的实现 */
export function implementKeyed<T>(
  port: KeyedPort<T>,
  key: string,
  impl: T,
  options: EnvScoped = {},
): PortImplementation {
  return { port, key, impl, ...options };
}

// ---------- ⑤ 不变量 ----------

/** 级别：契约的 invariant_violation.severity */
export const INVARIANT_SEVERITIES = INVARIANT_VIOLATION_SEVERITY.values;
export type InvariantSeverity = EnumValue<typeof INVARIANT_VIOLATION_SEVERITY>;
/** quick：只查最近有变动的主体；full：全量（D7 第 9.6 节）。契约的 invariant_run.mode */
export const INVARIANT_MODES = INVARIANT_RUN_MODE.values;
export type InvariantMode = EnumValue<typeof INVARIANT_RUN_MODE>;
/** hour：只在每小时第一次 quick 运行里执行；week：只在周一的 full 运行里执行（15 分组 第 2.4 节） */
export const INVARIANT_EVERY = ["hour", "week"] as const;
export type InvariantEvery = (typeof INVARIANT_EVERY)[number];
/** 自愈策略，不写即 none */
export const INVARIANT_HEAL = ["none", "heal_and_alert", "heal_only"] as const;
export type InvariantHeal = (typeof INVARIANT_HEAL)[number];

export interface InvariantScope {
  /** quick 运行的“上次以来” */
  readonly since?: Date;
  /** 限定主体 */
  readonly entityIds?: readonly string[];
}

/** 违规落在哪个对象上：有主键的给 id，自然键的给 key；全局性的不给 type */
export type InvariantSubject =
  | { readonly type: string; readonly id: string }
  | { readonly type: string; readonly key: string }
  | { readonly key: string };

export interface InvariantViolation {
  readonly subject?: InvariantSubject;
  readonly entityId?: string;
  /** 期望值、实际值、相关流水的 id */
  readonly detail: Readonly<Record<string, unknown>>;
  /** 已自愈的写上做了什么、何时 */
  readonly healed?: { readonly action: string; readonly at: Date };
}

/** 框架调检查项时另给的东西（W0-24）。只增字段 */
export interface InvariantRunContext {
  /** 业务时间：调度方从注入的时钟取。检查项里的“现在”用它，不自己取 */
  readonly now: Date;
}

/** 取框架给的业务时间。框架（ops）调检查项时一定给；用例直接调 run 而没给第三个参数时抛错 */
export function invariantNow(ctx: InvariantRunContext | undefined): Date {
  if (ctx === undefined) throw new TypeError("这个检查项要业务时间：run 的第三个参数写 { now }");
  return ctx.now;
}

export interface InvariantRegistration extends EnvScoped {
  /** 检查项编号 <命名空间>.<编号>，如 events.I8、flow.STUCK_TICKET */
  readonly code: string;
  readonly severity: InvariantSeverity;
  /** 只经端口上报、不由框架运行的检查项写空数组 */
  readonly modes: readonly InvariantMode[];
  readonly every?: InvariantEvery;
  readonly heal?: InvariantHeal;
  /**
   * modes 非空时必须有。返回本次查到的全部违规，没有即空数组。
   * 检查、自愈与违规落库在同一个事务里（W0-24）。第三个参数框架一定给，用不到的检查项不用收；
   * 类型上可选，是为了已有的登记与直接调 run 的用例不用改：要用它的检查项经 invariantNow 取。
   */
  readonly run?: (
    tx: Tx,
    scope: InvariantScope,
    ctx?: InvariantRunContext,
  ) => Promise<readonly InvariantViolation[]>;
}

// ---------- ⑥ 清理 ----------

/** hour：每轮都跑；day：只在当日第一轮跑（15 分组 第 5.3 节） */
export const CLEANUP_EVERY = ["hour", "day"] as const;
export type CleanupEvery = (typeof CLEANUP_EVERY)[number];

export interface CleanupContext {
  /** 业务时间，由调度方从注入的时钟取 */
  readonly now: Date;
  /** 单轮至多处理多少行 */
  readonly limit: number;
}

export interface CleanupRegistration extends EnvScoped {
  /** 清理项名，小写点分：<模块>.<表或用途>，如 kernel.idempotency_record */
  readonly name: string;
  readonly every: CleanupEvery;
  /** 物理删除或清除载荷；返回处理的行数 */
  readonly run: (tx: Tx, ctx: CleanupContext) => Promise<number>;
}

// ---------- 一个模块的登记 ----------

export interface ModuleRegistration {
  /** services 的模块名，与目录名相同 */
  readonly module: string;
  readonly subscribers: readonly SubscriberRegistration[];
  readonly timerHandlers: readonly TimerHandlerRegistration[];
  readonly recurringJobs: readonly RecurringJobRegistration[];
  readonly portImplementations: readonly PortImplementation[];
  readonly invariants: readonly InvariantRegistration[];
  readonly cleanups: readonly CleanupRegistration[];
  /** 本模块定义的端口：声明在这里，装配时才查得出“缺实现” */
  readonly ports: readonly AnyPort[];
}

/** 六类的键名，按上面的次序 */
export const REGISTRATION_KINDS = [
  "subscribers",
  "timerHandlers",
  "recurringJobs",
  "portImplementations",
  "invariants",
  "cleanups",
] as const;
export type RegistrationKind = (typeof REGISTRATION_KINDS)[number];

/**
 * 每个模块的 register.ts 调一次，结果以 registration 这个名字经模块的 index.ts 给出：
 *   // <模块>/register.ts
 *   export const registration = defineRegistration("events", { invariants: [i8] });
 *   // <模块>/index.ts
 *   export { registration } from "./register.js";
 * 没有的类别不写。
 */
export function defineRegistration(
  module: string,
  parts: Partial<Omit<ModuleRegistration, "module">> = {},
): ModuleRegistration {
  return {
    module,
    subscribers: parts.subscribers ?? [],
    timerHandlers: parts.timerHandlers ?? [],
    recurringJobs: parts.recurringJobs ?? [],
    portImplementations: parts.portImplementations ?? [],
    invariants: parts.invariants ?? [],
    cleanups: parts.cleanups ?? [],
    ports: parts.ports ?? [],
  };
}

/** 装配结果里的一项：登记项加上登记它的模块 */
export type Collected<T> = T & { readonly module: string };

/** 已声明的端口与声明它的模块。端口认的是对象本身：实现要指向 definePort 给出的那一个 */
export interface DeclaredPort {
  readonly port: AnyPort;
  readonly module: string;
}

/** 装配结果：某个入口、某个环境下生效的全部登记。各类按名字排序，两个入口拿到的次序相同 */
export interface Assembly {
  readonly entry: AssemblyEntry;
  readonly appEnv: AppEnv;
  /** 带登记的模块，按名字排序 */
  readonly modules: readonly string[];
  readonly subscribers: readonly Collected<SubscriberRegistration>[];
  readonly timerHandlers: readonly Collected<TimerHandlerRegistration>[];
  readonly recurringJobs: readonly Collected<RecurringJobRegistration>[];
  readonly portImplementations: readonly Collected<PortImplementation>[];
  readonly invariants: readonly Collected<InvariantRegistration>[];
  readonly cleanups: readonly Collected<CleanupRegistration>[];
  /** 已声明的端口，按名字排序 */
  readonly ports: readonly DeclaredPort[];
  subscriber(name: string): Collected<SubscriberRegistration> | undefined;
  timerHandler(kind: string): Collected<TimerHandlerRegistration> | undefined;
  recurringJob(kind: string): Collected<RecurringJobRegistration> | undefined;
  invariant(code: string): Collected<InvariantRegistration> | undefined;
  cleanup(name: string): Collected<CleanupRegistration> | undefined;
  /** 取单实现端口的实现；没人实现时是它的默认实现。端口没有模块声明过即抛错 */
  port<T>(port: Port<T>): T;
  /** 取按键端口的全部实现：键 → 实现 */
  portEntries<T>(port: KeyedPort<T>): ReadonlyMap<string, T>;
}
