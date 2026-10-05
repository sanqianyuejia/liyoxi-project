// 任务进程的服务装配（W0-23）：apps/worker 启动时调一次，拿到四个循环与两个队列消费者要调的用例函数。
// 依据：D7 第 2.3 节规则 7、8，第 8.3 节“应用侧的数据库会话设置与连接池”；计划 第 5.1 节。
// 应用层不引数据包（CLAUDE.md 第 6 节规则 5）：连接池在这里建，apps/worker 只把拿到的对象原样传回来。
import { createPrismaClient } from "@liyoxi/db";
import type { PrismaClient } from "@liyoxi/db";

import {
  assertAggregateTables,
  consumeDelivery,
  createEvents,
  dispatchDue,
  EXPAND_BATCH_SIZE,
} from "../events/index.js";
import type {
  ConsumeOutcome,
  DeliveryRef,
  DispatchOptions,
  DispatchResult,
  Events,
  TestEventDefinition,
} from "../events/index.js";
import { alertsOf, createTxRunner, systemClock } from "../kernel/index.js";
import type { AppEnv, Assembly, Clock, KernelViolation, QueueChannel } from "../kernel/index.js";
import { createTimers, runTimer, scanDue } from "../timers/index.js";
import type {
  EnsureRecurringResult,
  RunTimerOutcome,
  ScanOptions,
  ScanResult,
  TimerCatalog,
  TimerRef,
  Timers,
} from "../timers/index.js";
import { bindOps } from "./binding.js";

/** worker 主池（D7 第 8.3 节）：10 条连接，语句 30 秒、等锁 3 秒、事务内空闲 60 秒 */
export function connectWorkerDatabase(connectionString: string): {
  prisma: PrismaClient;
  close(): Promise<void>;
} {
  const prisma = createPrismaClient({
    connectionString,
    max: 10,
    statementTimeoutMs: 30_000,
    lockTimeoutMs: 3_000,
    idleInTransactionSessionTimeoutMs: 60_000,
  });
  return { prisma, close: () => prisma.$disconnect() };
}

export interface WorkerServicesOptions {
  readonly appEnv: AppEnv;
  /** 业务连接池：connectWorkerDatabase 给的；用例传测试库的客户端 */
  readonly prisma: PrismaClient;
  /** assembleServices({ entry: "worker" }) 的结果；用例传测试装配 */
  readonly assembly: Assembly;
  readonly channel: Pick<QueueChannel, "enqueue" | "downForMs">;
  /** 业务时钟，缺省系统时钟 */
  readonly clock?: Clock;
  /** stg、prod 下内核违规往哪报 */
  readonly report?: (violation: KernelViolation) => void;
  /** 只给测试装配：样例事件与样例 kind 的名字来源 */
  readonly testEvents?: readonly TestEventDefinition[];
  readonly timerCatalog?: TimerCatalog;
}

export interface WorkerServices {
  readonly assembly: Assembly;
  readonly events: Events;
  readonly timers: Timers;
  /** 启动自检：契约登记的聚合类型都是库里存在的表。有对不上的即抛错 */
  selfCheck(): Promise<void>;
  /** 出站中继的一轮：把未展开的事件展开到没有更多；返回展开的事件数 */
  relay(beat?: () => void): Promise<number>;
  /** 出站派发的一轮 */
  dispatch(options?: DispatchOptions): Promise<DispatchResult>;
  /** 出站投递队列的处理器 */
  consume(ref: DeliveryRef): Promise<ConsumeOutcome>;
  /** 定时器扫描的一轮 */
  scan(options?: ScanOptions): Promise<ScanResult>;
  /** 定时器执行队列的处理器 */
  runTimer(ref: TimerRef): Promise<RunTimerOutcome>;
  /** 周期任务补登记的一轮 */
  ensureRecurring(): Promise<EnsureRecurringResult>;
}

/**
 * 建 events、timers（两者在构造时对照契约校验订阅者、处理器、周期任务的登记，对不上即抛错）并绑好依赖。
 * 这里不连 Redis、不查库：selfCheck 才查库。
 */
export function buildWorkerServices(options: WorkerServicesOptions): WorkerServices {
  const { assembly, prisma, channel } = options;
  const clock = options.clock ?? systemClock;
  const tx = createTxRunner({ prisma, appEnv: options.appEnv, report: options.report });
  const events = createEvents({ assembly, clock, tx, testEvents: options.testEvents });
  const timers = createTimers({ assembly, catalog: options.timerCatalog });
  const alerts = alertsOf(assembly);
  // ops 的周期任务与违规上报端口要连接、时钟与装配结果（W0-24）
  bindOps({ db: prisma, tx, clock, assembly });
  const delivery = { tx, subscribers: events.subscribers, channel, alerts };
  const timing = { tx, assembly, registry: timers.registry, clock, alerts, channel };
  return {
    assembly,
    events,
    timers,
    selfCheck: () => assertAggregateTables(prisma),
    async relay(beat) {
      let total = 0;
      for (;;) {
        const { events: expanded } = await events.expand();
        total += expanded;
        beat?.();
        if (expanded < EXPAND_BATCH_SIZE) return total;
      }
    },
    dispatch: (dispatchOptions) => dispatchDue(delivery, dispatchOptions),
    consume: (ref) => consumeDelivery(delivery, ref),
    scan: (scanOptions) => scanDue(timing, scanOptions),
    runTimer: (ref) => runTimer(timing, ref),
    ensureRecurring: () => tx.run((handle) => timers.ensureRecurring(handle, clock.now())),
  };
}
