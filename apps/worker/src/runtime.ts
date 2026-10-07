// 任务进程的运行时（W0-23）：四个循环、两个队列的消费者、租约与关停的顺序。
// 依据：x01 第 4.3、4.4 节；D7 第 7.6 节；01 第 7.3、7.4 节；计划 第 8.4 节（M0 的四个循环与两个队列）。
// 这里只有调度：认领、执行、失败处理都在 @liyoxi/services（CLAUDE.md 第 6 节规则 5、6）。
//
//   成为主   → 起四个循环，两个队列的消费者开始领任务
//   降级     → 立刻停循环（不等在途的那一轮），消费者不再领新任务
//   关停     → 停续约与看门狗 → 停循环（等在途的一轮）→ 关消费者（等在途任务，至多 30 秒）→ 让出租约
// 循环都按“可多实例并行”写（认领用 SKIP LOCKED），单活只是省资源：不给租约时本实例直接干活（双实例的用例这么跑）。
import type { LoopId, QueueId } from "@liyoxi/contract/registry";
import type {
  DeliveryRef,
  QueueChannel,
  QueueConsumer,
  TimerRef,
  WorkerLease,
  WorkerServices,
} from "@liyoxi/services";

import { DOMAIN_LOOPS } from "./domain-loops.js";
import { createLeaseKeeper } from "./lease.js";
import type { LeaseKeeper, LeaseTiming } from "./lease.js";
import type { Logger } from "./log.js";
import { createLoop } from "./loop.js";
import type { Loop } from "./loop.js";

/** M0 的四个循环与节奏（毫秒）；名字取契约的登记 */
export const LOOP_INTERVALS_MS = {
  outbox_relay: 1_000,
  outbox_dispatch: 1_000,
  timer_scan: 20_000,
  ensure_recurring: 60_000,
} as const satisfies Partial<Record<LoopId, number>>;
export type WorkerLoop = keyof typeof LOOP_INTERVALS_MS;

/** M0 的两个队列与并发（依据文档未给，任务书 第 11 节第 6 项定） */
export const QUEUE_CONCURRENCY = {
  outbox_delivery: 4,
  timer_run: 4,
  promote: 2,
} as const satisfies Partial<Record<QueueId, number>>;
export type WorkerQueue = keyof typeof QUEUE_CONCURRENCY;

/** 关停时等在途任务的上限 */
export const SHUTDOWN_WAIT_MS = 30_000;

export interface WorkerRuntimeOptions {
  readonly services: WorkerServices;
  readonly channel: QueueChannel;
  /** 不给即绕过租约：start 之后直接干活 */
  readonly lease?: WorkerLease;
  readonly logger: Logger;
  /** 下面几项只有用例会给 */
  readonly intervals?: Partial<Record<WorkerLoop, number>>;
  /** 各域循环的节奏，按循环名 */
  readonly domainIntervals?: Readonly<Record<string, number>>;
  readonly timing?: Partial<LeaseTiming>;
  readonly monotonic?: () => number;
  readonly exit?: (code: number) => void;
}

export interface WorkerRuntime {
  readonly loops: Readonly<Record<WorkerLoop, Loop>>;
  /** 各域的循环（domain-loops.ts 的清单），按循环名 */
  readonly domainLoops: Readonly<Record<string, Loop>>;
  readonly consumers: Readonly<Record<WorkerQueue, QueueConsumer>>;
  /** 有租约时才有 */
  readonly keeper: LeaseKeeper | undefined;
  /** 现在是不是在干活 */
  readonly active: boolean;
  start(): void;
  stop(): Promise<void>;
}

export function createWorkerRuntime(options: WorkerRuntimeOptions): WorkerRuntime {
  const { services, channel, lease, logger, monotonic } = options;
  services.setProbeHolder?.(lease?.holder);
  const onError = (name: string, error: unknown): void =>
    logger.error({ loop: name, err: error }, "循环的这一轮出错，下一轮照常");
  const loop = (name: WorkerLoop, run: (beat: () => void) => Promise<unknown>): Loop =>
    createLoop({
      name,
      intervalMs: options.intervals?.[name] ?? LOOP_INTERVALS_MS[name],
      run,
      onError,
      monotonic,
    });
  const loops: Record<WorkerLoop, Loop> = {
    outbox_relay: loop("outbox_relay", (beat) => services.relay(beat)),
    outbox_dispatch: loop("outbox_dispatch", (beat) => services.dispatch({ beat })),
    timer_scan: loop("timer_scan", (beat) => services.scan({ beat })),
    ensure_recurring: loop("ensure_recurring", () => services.ensureRecurring()),
  };
  const consumers: Record<WorkerQueue, QueueConsumer> = {
    outbox_delivery: channel.consume<DeliveryRef>(
      "outbox_delivery",
      QUEUE_CONCURRENCY.outbox_delivery,
      async (ref) => void (await services.consume(ref)),
    ),
    promote: channel.consume<{ jobId: string }>("promote", QUEUE_CONCURRENCY.promote, (ref) =>
      services.promoteFile(ref),
    ),
    timer_run: channel.consume<TimerRef>(
      "timer_run",
      QUEUE_CONCURRENCY.timer_run,
      async (ref) => void (await services.runTimer(ref)),
    ),
  };
  const domainLoops: Record<string, Loop> = Object.fromEntries(
    DOMAIN_LOOPS.map((def) => [
      def.name,
      createLoop({
        name: def.name,
        intervalMs: options.domainIntervals?.[def.name] ?? def.intervalMs,
        run: (beat) => def.run(services, beat),
        onError,
        monotonic,
      }),
    ]),
  );
  const promoteRecovery = createLoop({
    name: "promote.recovery",
    intervalMs: options.domainIntervals?.["promote.recovery"] ?? 30_000,
    run: () => services.scanPromote(),
    onError,
    monotonic,
  });
  const all = [...Object.values(loops), ...Object.values(domainLoops), promoteRecovery];
  const queues = Object.values(consumers);

  let active = false;
  let stopping: Promise<void> | undefined;
  const promote = (): void => {
    active = true;
    for (const one of all) one.start();
    for (const one of queues) one.start();
  };
  const demote = (): void => {
    active = false;
    for (const one of all) void one.stop();
    for (const one of queues) void one.pause().catch(() => undefined);
  };
  const keeper =
    lease === undefined
      ? undefined
      : createLeaseKeeper({
          lease,
          loops: all,
          onPromote: promote,
          onDemote: demote,
          logger,
          timing: options.timing,
          monotonic,
          exit: options.exit,
        });

  return {
    loops,
    domainLoops,
    consumers,
    keeper,
    get active() {
      return active;
    },
    start() {
      if (keeper === undefined) promote();
      else keeper.start();
    },
    stop() {
      return (stopping ??= (async () => {
        keeper?.stop();
        active = false;
        try {
          // 一个关闭失败不能提前解绑：循环与全部消费者都收完后才清理绑定。
          const loopResults = await Promise.allSettled(all.map((one) => one.stop()));
          const queueResults = await Promise.allSettled(
            queues.map((one) => one.close(SHUTDOWN_WAIT_MS)),
          );
          const failed = [...loopResults, ...queueResults].find(
            (result) => result.status === "rejected",
          );
          if (failed?.status === "rejected") throw failed.reason;
          // 只有全部关停成功才主动让出；失败可能仍有在途任务，保持原租约语义。
          await lease
            ?.release()
            .catch((error: unknown) => logger.warn({ err: error }, "让出租约失败"));
        } finally {
          services.closeBillingTimers?.();
          services.closeOrder?.();
          services.closePublish?.();
          services.closeDelivery?.();
          services.closeWebhooks?.();
          await services.closeOps?.();
        }
      })());
    },
  };
}
