// @liyoxi/contract/registry：x01 名称登记，纯常量子路径（事件、订阅者、定时器、周期任务、进程内循环、队列通道、
// 回调处理、命令行的名字，所属模块，归属里程碑）。本入口可达的文件不得 import zod、@hono/zod-openapi、hono。
// 一个模块一个文件，各导出一个 registry；汇总是从各模块的登记自动收集的，不手抄。加一个模块文件，在下面
// import 并放进 MODULE_REGISTRIES；漏加时契约自测会红（目录里的文件与这里收的要一一对应）。
// 对账：pnpm registry:check（与 x01 正文、working/frag/x01-events-jobs.json 的名称集合 0 差异；数量；里程碑；写法）。
// 归属表 docs/plan/x01-map.md 由 pnpm registry:generate 从这里生成，不手改。
import { registry as ad } from "./ad.js";
import { registry as analytics } from "./analytics.js";
import { registry as approval } from "./approval.js";
import { registry as billing } from "./billing.js";
import { registry as config } from "./config.js";
import { registry as content } from "./content.js";
import { registry as delivery } from "./delivery.js";
import { registry as docs } from "./docs.js";
import { registry as events } from "./events.js";
import { registry as exportsModule } from "./exports.js";
import { registry as identity } from "./identity.js";
import { registry as media } from "./media.js";
import { registry as notify } from "./notify.js";
import { registry as ops } from "./ops.js";
import { registry as order } from "./order.js";
import { registry as profile } from "./profile.js";
import { registry as publish } from "./publish.js";
import { registry as reports } from "./reports.js";
import { registry as security } from "./security.js";
import { registry as sla } from "./sla.js";
import { registry as staff } from "./staff.js";
import { registry as support } from "./support.js";
import { registry as tenant } from "./tenant.js";
import { registry as timers } from "./timers.js";
import type {
  CallbackDef,
  CommandDef,
  EventDef,
  JobDef,
  LoopDef,
  ModuleRegistry,
  QueueDef,
  SubscriberDef,
  TimerDef,
} from "./define.js";

// 声明用的构造函数（event、timer 之类）只给各模块文件用，不从入口给出
export { EVENT_STATUSES, MILESTONES } from "./define.js";
export type {
  CallbackDef,
  CommandDef,
  EventDef,
  EventStatus,
  JobDef,
  LoopDef,
  Milestone,
  ModuleRegistry,
  QueueDef,
  SubscriberDef,
  TimerDef,
} from "./define.js";
export * from "./formats.js";

/** 各模块的登记，按模块名排序 */
export const MODULE_REGISTRIES = [
  ad,
  analytics,
  approval,
  billing,
  config,
  content,
  delivery,
  docs,
  events,
  exportsModule,
  identity,
  media,
  notify,
  ops,
  order,
  profile,
  publish,
  reports,
  security,
  sla,
  staff,
  support,
  tenant,
  timers,
] as const;

type AnyRegistry = (typeof MODULE_REGISTRIES)[number];

/** 事件名（outbox_event.event_type），含不发与预留的 */
export type EventName = AnyRegistry["events"][number]["name"];
/** 聚合（outbox_event.aggregate_type）的已知取值；库里只校验写法 */
export type AggregateType = AnyRegistry["events"][number]["aggregates"][number];
/** 订阅者名（outbox_delivery.subscriber） */
export type SubscriberName = AnyRegistry["subscribers"][number]["name"];
/** 定时器的 kind（有主体） */
export type TimerKind = AnyRegistry["timers"][number]["kind"];
/** 定时器主体（timer.subject_type）的已知取值；库里只校验写法 */
export type TimerSubjectType = AnyRegistry["timers"][number]["subject"];
/** 周期任务的 kind（无主体） */
export type JobKind = AnyRegistry["jobs"][number]["kind"];
export type LoopId = AnyRegistry["loops"][number]["id"];
export type QueueId = AnyRegistry["queues"][number]["id"];
export type CallbackOperationId = AnyRegistry["callbacks"][number]["operationId"];
export type CommandId = AnyRegistry["commands"][number]["id"];

/** 汇总里的一项：登记项加上它所属的模块 */
export type Registered<T> = T & { readonly module: string };

function collect<T>(pick: (registry: ModuleRegistry) => readonly T[]): Registered<T>[] {
  return MODULE_REGISTRIES.flatMap((registry: ModuleRegistry) =>
    pick(registry).map((item) => ({ ...item, module: registry.module })),
  );
}

const unique = <T extends string>(values: readonly T[]): T[] => [...new Set(values)].sort();

/** 出站事件 */
export const EVENTS = collect((r) => r.events) as readonly Registered<
  EventDef<EventName, AggregateType>
>[];
/** 订阅者 */
export const SUBSCRIBERS = collect((r) => r.subscribers) as readonly Registered<
  SubscriberDef<SubscriberName>
>[];
/** 定时器（kind × 主体） */
export const TIMERS = collect((r) => r.timers) as readonly Registered<
  TimerDef<TimerKind, TimerSubjectType>
>[];
/** 周期任务 */
export const JOBS = collect((r) => r.jobs) as readonly Registered<JobDef<JobKind>>[];
/** 进程内循环 */
export const LOOPS = collect((r) => r.loops) as readonly Registered<LoopDef<LoopId>>[];
/** 队列通道 */
export const QUEUES = collect((r) => r.queues) as readonly Registered<QueueDef<QueueId>>[];
/** 回调处理 */
export const CALLBACKS = collect((r) => r.callbacks) as readonly Registered<
  CallbackDef<CallbackOperationId>
>[];
/** 命令行 */
export const COMMANDS = collect((r) => r.commands) as readonly Registered<CommandDef<CommandId>>[];

/** outbox_event.aggregate_type 的已知取值：由事件登记得出，按字母序（01 分组 第 3.4 节） */
export const AGGREGATE_TYPES: readonly AggregateType[] = unique(
  EVENTS.flatMap((item) => item.aggregates),
);
/** timer.subject_type 的已知取值：由定时器登记得出，按字母序（01 分组 第 3.3 节） */
export const TIMER_SUBJECT_TYPES: readonly TimerSubjectType[] = unique(
  TIMERS.map((item) => item.subject),
);

/** 前缀登记的一行（x01 第 2.2 节）：由事件登记得出 */
export interface EventPrefix {
  /** 前缀，带结尾的点 */
  readonly prefix: string;
  /** 这个前缀下的事件用到的聚合 */
  readonly aggregates: readonly string[];
  /** 发出这个前缀下事件的模块；一个前缀通常只有一个模块，drama. 有两个 */
  readonly modules: readonly string[];
  /** 事件数：发出的与预留的，不含不发的（x01 第 2.2 节“事件数”一栏的口径） */
  readonly count: number;
}

/** 由事件登记得出前缀登记：前缀 → 聚合 → 发出模块，顺序照事件第一次出现的先后 */
export function eventPrefixesOf(events: readonly Registered<EventDef>[]): EventPrefix[] {
  return [...new Set(events.map((item) => item.prefix))].map((prefix) => {
    const members = events.filter((item) => item.prefix === prefix);
    return {
      prefix,
      aggregates: unique(members.flatMap((item) => [...item.aggregates])),
      modules: unique(members.map((item) => item.module)),
      count: members.filter((item) => item.status !== "not_emitted").length,
    };
  });
}

/** 前缀登记（x01 第 2.2 节） */
export const EVENT_PREFIXES: readonly EventPrefix[] = eventPrefixesOf(EVENTS);

/** 全部登记的一份快照：检查脚本与归属表的生成脚本用它，也便于拿一份改过的数据来试 */
export interface RegistrySnapshot {
  readonly events: readonly Registered<EventDef>[];
  readonly subscribers: readonly Registered<SubscriberDef>[];
  readonly timers: readonly Registered<TimerDef>[];
  readonly jobs: readonly Registered<JobDef>[];
  readonly loops: readonly Registered<LoopDef>[];
  readonly queues: readonly Registered<QueueDef>[];
  readonly callbacks: readonly Registered<CallbackDef>[];
  readonly commands: readonly Registered<CommandDef>[];
}

export const REGISTRY: RegistrySnapshot = {
  events: EVENTS,
  subscribers: SUBSCRIBERS,
  timers: TIMERS,
  jobs: JOBS,
  loops: LOOPS,
  queues: QUEUES,
  callbacks: CALLBACKS,
  commands: COMMANDS,
};
