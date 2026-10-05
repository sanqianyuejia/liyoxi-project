// 用例里的“一个任务进程实例”（W0-23）：测试装配（样例订阅者、定时器处理器、周期任务）之上的服务、队列与运行时。
// 本文件不引 Vitest：进程中断的场景在子进程里也要加载它。库与 Redis 前缀由调用方给（测试支架发的）。
import {
  buildWorkerServices,
  connectWorkerDatabase,
  createQueueChannel,
  createWorkerLease,
} from "@liyoxi/services";
import type { AppEnv, Clock, WorkerLease } from "@liyoxi/services";
import {
  assembleForTest,
  createClock,
  createRecordingPorts,
  createWorkerSample,
  SAMPLE_EVENTS,
  SAMPLE_TIMER_CATALOG,
} from "@liyoxi/services/testing";
import type { WorkerSampleOptions } from "@liyoxi/services/testing";

import type { LeaseTiming } from "../../src/lease.js";
import { silentLogger } from "../../src/log.js";
import { createWorkerRuntime } from "../../src/runtime.js";
import type { WorkerLoop } from "../../src/runtime.js";

/** 用例里循环的节奏：比生产快得多，等的时候不用按分钟算 */
export const FAST_INTERVALS: Record<WorkerLoop, number> = {
  outbox_relay: 50,
  outbox_dispatch: 50,
  timer_scan: 100,
  ensure_recurring: 200,
};

export interface InstanceOptions extends WorkerSampleOptions {
  /** 测试库的连接串（测试支架给的） */
  readonly databaseUrl: string;
  /** 本 worker 的 Redis 键前缀（测试支架给的） */
  readonly redisPrefix: string;
  /** Redis 的连接串；缺省取 REDIS_URL。造“不可用”时换成故障注入的转发口 */
  readonly redisUrl?: string;
  /** 业务时钟；几个实例共用一只时传进来 */
  readonly clock?: Clock;
  readonly appEnv?: AppEnv;
  /** 带租约时给实例名；不给即绕过租约 */
  readonly lease?: { readonly name: string; readonly takeoverAfterSec?: number };
  readonly timing?: Partial<LeaseTiming>;
  /** 单调时钟与退出：用例换成自己的 */
  readonly monotonic?: () => number;
  readonly exit?: (code: number) => void;
}

export function createInstance(options: InstanceOptions) {
  const redisUrl = options.redisUrl ?? process.env.REDIS_URL;
  if (!redisUrl) throw new Error("REDIS_URL 未设置");
  const sample = createWorkerSample(options);
  const ports = createRecordingPorts();
  const assembly = assembleForTest({
    entry: "worker",
    appEnv: options.appEnv,
    extra: [sample.registration, ports.registration],
  });
  const clock = options.clock ?? createClock();
  const database = connectWorkerDatabase(options.databaseUrl);
  const channel = createQueueChannel({
    redisUrl,
    prefix: `${options.redisPrefix}bull`,
    monotonic: options.monotonic,
  });
  const services = buildWorkerServices({
    appEnv: "test",
    prisma: database.prisma,
    assembly,
    channel,
    clock,
    testEvents: SAMPLE_EVENTS,
    timerCatalog: SAMPLE_TIMER_CATALOG,
  });
  const lease: WorkerLease | undefined =
    options.lease === undefined
      ? undefined
      : createWorkerLease({
          connectionString: options.databaseUrl,
          holder: `lyxtest:${options.lease.name}`,
          version: "test",
          takeoverAfterSec: options.lease.takeoverAfterSec,
        });
  const exits: number[] = [];
  const runtime = createWorkerRuntime({
    services,
    channel,
    lease,
    logger: silentLogger,
    intervals: FAST_INTERVALS,
    timing: options.timing,
    monotonic: options.monotonic,
    exit: options.exit ?? ((code) => void exits.push(code)),
  });
  return {
    sample,
    control: sample.control,
    ports,
    clock,
    services,
    channel,
    lease,
    runtime,
    /** 看门狗要求退出进程的记录（没换 exit 时） */
    exits,
    /** 收尾：停运行时，断开队列、租约与库的连接 */
    async close(): Promise<void> {
      await runtime.stop().catch(() => undefined);
      await Promise.allSettled([channel.close(), lease?.close(), database.close()]);
    },
  };
}
export type Instance = ReturnType<typeof createInstance>;
