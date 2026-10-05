// x01 名称登记的声明形态（docs/api/x01-events-jobs.md 第 2–4 节；计划 第 5.7 节“登记表”“x01 归属”两行）。
// 这里只登记名字、所属模块、归属里程碑与“关键类”。订阅关系、载荷结构、节奏、处理器都不在这里：
// 随实现它们的包写进各模块的 register.ts，装配时对照这里的名字校验（任务书 W0-09a 第 11 节第 7 项）。
// 纯常量：本目录的文件不引任何包。

/** 归属里程碑：该条目应在哪个里程碑落地（计划 第 8.4 节）。M8 不新增处理器，不在取值之内 */
export const MILESTONES = ["M0", "M1", "M2", "M3", "M4", "M5", "M6", "M7"] as const;
export type Milestone = (typeof MILESTONES)[number];

/** 事件的状态：v1 是 V1.0 发出；not_emitted 是不发（名字占住，不挪作他用）；reserved 是预留（x01 第 3.16 节） */
export const EVENT_STATUSES = ["v1", "not_emitted", "reserved"] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

/** 出站事件（x01 第 3 节）。不带里程碑：事件随发出它的接口或任务落地 */
export interface EventDef<N extends string = string, A extends string = string> {
  /** 事件名，即 outbox_event.event_type */
  readonly name: N;
  /** 前缀：事件名去掉最后一段，带结尾的点（x01 第 2.2 节的登记项） */
  readonly prefix: string;
  /**
   * 聚合，即 outbox_event.aggregate_type。绝大多数事件恰好一个；按触发来源取不同聚合的列出全部；
   * 空数组表示不带聚合（calendar.imported），或这个事件不发
   */
  readonly aggregates: readonly A[];
  readonly status: EventStatus;
}

/** 订阅者（x01 第 2.5 节） */
export interface SubscriberDef<N extends string = string> {
  /** 订阅者名，即 outbox_delivery.subscriber */
  readonly name: N;
  /** 关键类：Redis 不可用时由派发循环在进程内直接执行（x01 第 2.4 节 E7） */
  readonly critical: boolean;
  readonly milestone: Milestone;
}

/** 定时器（x01 第 4.1 节）：一行是“kind × 主体”，同一个 kind 可以有几种主体 */
export interface TimerDef<K extends string = string, S extends string = string> {
  /** timer.kind */
  readonly kind: K;
  /** 主体，即 timer.subject_type（最终表名） */
  readonly subject: S;
  /** 关键类：Redis 不可用时在进程内执行 */
  readonly critical: boolean;
  readonly milestone: Milestone;
}

/** 周期任务（x01 第 4.2 节）：也是定时器行，主体为空 */
export interface JobDef<K extends string = string> {
  /** timer.kind */
  readonly kind: K;
  readonly milestone: Milestone;
}

/** 进程内循环、队列通道、命令行在 x01 里写的是叫法，不是标识符：两样都登记 */
interface LabeledDef<I extends string> {
  /** 代码标识符，小写蛇形（本包定） */
  readonly id: I;
  /** x01 表格首列的原文，对账用 */
  readonly label: string;
  readonly milestone: Milestone;
}
/** 进程内循环（x01 第 4.3 节） */
export type LoopDef<I extends string = string> = LabeledDef<I>;
/** 队列通道（x01 第 4.4 节） */
export type QueueDef<I extends string = string> = LabeledDef<I>;
/** 命令行（x01 第 4.6 节） */
export type CommandDef<I extends string = string> = LabeledDef<I>;

/** 回调处理（x01 第 4.5 节） */
export interface CallbackDef<O extends string = string> {
  /** 回调路由的 operationId */
  readonly operationId: O;
  readonly milestone: Milestone;
}

/** 一个模块登记的全部名字 */
export interface ModuleRegistry<
  E extends EventDef = EventDef,
  S extends SubscriberDef = SubscriberDef,
  T extends TimerDef = TimerDef,
  J extends JobDef = JobDef,
  L extends LoopDef = LoopDef,
  Q extends QueueDef = QueueDef,
  C extends CallbackDef = CallbackDef,
  K extends CommandDef = CommandDef,
> {
  /** services 的模块名，与文件名相同 */
  readonly module: string;
  readonly events: readonly E[];
  readonly subscribers: readonly S[];
  readonly timers: readonly T[];
  readonly jobs: readonly J[];
  readonly loops: readonly L[];
  readonly queues: readonly Q[];
  readonly callbacks: readonly C[];
  readonly commands: readonly K[];
}

/** 一个模块一个文件，各调一次。没有的类别不写 */
export function defineRegistry<
  const E extends EventDef = never,
  const S extends SubscriberDef = never,
  const T extends TimerDef = never,
  const J extends JobDef = never,
  const L extends LoopDef = never,
  const Q extends QueueDef = never,
  const C extends CallbackDef = never,
  const K extends CommandDef = never,
>(
  module: string,
  parts: {
    events?: readonly E[];
    subscribers?: readonly S[];
    timers?: readonly T[];
    jobs?: readonly J[];
    loops?: readonly L[];
    queues?: readonly Q[];
    callbacks?: readonly C[];
    commands?: readonly K[];
  },
): ModuleRegistry<E, S, T, J, L, Q, C, K> {
  return {
    module,
    events: parts.events ?? [],
    subscribers: parts.subscribers ?? [],
    timers: parts.timers ?? [],
    jobs: parts.jobs ?? [],
    loops: parts.loops ?? [],
    queues: parts.queues ?? [],
    callbacks: parts.callbacks ?? [],
    commands: parts.commands ?? [],
  };
}

/** 事件。aggregate：聚合的表名；按来源取不同聚合的给数组；不带聚合或不发的给 null */
export function event<const N extends string, const A extends string = never>(
  name: N,
  aggregate: A | readonly A[] | null,
  status: EventStatus = "v1",
): EventDef<N, A> {
  const aggregates: readonly A[] =
    aggregate === null ? [] : typeof aggregate === "string" ? [aggregate] : aggregate;
  return { name, prefix: name.slice(0, name.lastIndexOf(".") + 1), aggregates, status };
}

/** 订阅者。第三个参数写 "critical" 即关键类 */
export function subscriber<const N extends string>(
  name: N,
  milestone: Milestone,
  critical?: "critical",
): SubscriberDef<N> {
  return { name, critical: critical === "critical", milestone };
}

/** 定时器的一行（kind × 主体）。第四个参数写 "critical" 即关键类 */
export function timer<const K extends string, const S extends string>(
  kind: K,
  subject: S,
  milestone: Milestone,
  critical?: "critical",
): TimerDef<K, S> {
  return { kind, subject, critical: critical === "critical", milestone };
}

/** 周期任务 */
export function job<const K extends string>(kind: K, milestone: Milestone): JobDef<K> {
  return { kind, milestone };
}

/** 进程内循环：标识符、x01 的原文叫法、里程碑 */
export function loop<const I extends string>(
  id: I,
  label: string,
  milestone: Milestone,
): LoopDef<I> {
  return { id, label, milestone };
}

/** 队列通道：标识符、x01 的原文叫法、里程碑 */
export function queue<const I extends string>(
  id: I,
  label: string,
  milestone: Milestone,
): QueueDef<I> {
  return { id, label, milestone };
}

/** 回调处理 */
export function callback<const O extends string>(
  operationId: O,
  milestone: Milestone,
): CallbackDef<O> {
  return { operationId, milestone };
}

/** 命令行：标识符、x01 的原文叫法、里程碑 */
export function command<const I extends string>(
  id: I,
  label: string,
  milestone: Milestone,
): CommandDef<I> {
  return { id, label, milestone };
}
