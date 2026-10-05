// 队列封装（W0-23）：连接、入队、消费者工厂、Redis 可用性探测。全仓只有这里引 bullmq。
// 依据：x01 第 4.4 节；D7 第 2.3 节规则 7、第 2.5 节、第 7.3 节“Redis 客户端配置”；D3 第 20.2、21.3 节。
//
//   1. BullMQ 只是执行通道：任务一律 attempts: 1，不用它的重试、调度器、重复任务。重试、到期、租约都在数据库行上。
//   2. 入队要快速失败：Redis 不通时立刻抛错，由调用方决定“进程内执行”还是“放回去”。所以入队连接不排离线队列、
//      命令 500 毫秒超时；外面再套一层总时限，防连接还没建起来时一直等。消费连接照 BullMQ 的要求不限重试次数。
//      这些参数是降级设计的一部分，写死在这里，不做成配置。
//   3. 入队报了错不等于任务没进队列（超时的那一次可能其实进去了）：没关系，消费时按 dispatch_no 认，过期的那次不落结果。
//   4. 借自参考工程 packages/services/src/queue/connection.ts（连接的建法）；队列名取契约的登记，键前缀 lyx:{env}:bull。
import type { QueueId } from "@liyoxi/contract/registry";
import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";

import type { AppEnv } from "../env.js";
import { assertNotInTransaction } from "../tx.js";

/** BullMQ 的键前缀（D7 第 2.5 节）：前缀不同，误连同一个 Redis 也不会互相消费 */
export const bullPrefix = (appEnv: AppEnv): string => `lyx:${appEnv}:bull`;

/** Redis 连续不可用满这么久，非关键类也在进程内执行（D3 第 21.3 节） */
export const REDIS_DOWN_FALLBACK_MS = 60_000;
/** 已完成、已失败的任务在 Redis 里留多久（秒）：只为排障时看一眼 */
const KEEP_JOB_SEC = 3600;

export interface QueueChannelOptions {
  readonly redisUrl: string;
  /** BullMQ 的键前缀：生产用 bullPrefix(env)，测试用测试支架给的前缀 */
  readonly prefix: string;
  /** 一次入队的总时限，毫秒；缺省 2000 */
  readonly enqueueTimeoutMs?: number;
  /** 单调时钟，毫秒；缺省 performance.now。只有用例会换它 */
  readonly monotonic?: () => number;
  /** 连接与消费者报的错往哪记；不给即丢弃（Redis 不通时这类错每秒都有） */
  readonly onError?: (source: string, error: unknown) => void;
}

export interface QueueConsumer {
  /** 开始领任务；暂停之后再调即恢复 */
  start(): void;
  /** 不再领新任务。在途的照常跑完，不等它们 */
  pause(): Promise<void>;
  /** 关闭：等在途任务，至多 timeoutMs 毫秒，到点强行关 */
  close(timeoutMs: number): Promise<void>;
}

export interface QueueChannel {
  /** 入队。Redis 不可用、超时即抛错，不重试、不排队等。不得在事务里调 */
  enqueue(queue: QueueId, jobId: string, data: Readonly<Record<string, unknown>>): Promise<void>;
  /** 建一个消费者（建好不自动开始）。handler 抛错只让这条任务失败，不重试：后续由数据库行的租约驱动 */
  consume<T>(
    queue: QueueId,
    concurrency: number,
    handler: (data: T) => Promise<void>,
  ): QueueConsumer;
  /** Redis 已连续不可用多久，毫秒；可用即 0 */
  downForMs(): number;
  /** 探一下 Redis 通不通；结果同时记进 downForMs */
  ping(): Promise<boolean>;
  close(): Promise<void>;
}

const withTimeout = <T>(work: Promise<T>, ms: number, what: string): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what}超过 ${ms} 毫秒`)), ms);
    work.then(resolve, reject).finally(() => clearTimeout(timer));
  });

export function createQueueChannel(options: QueueChannelOptions): QueueChannel {
  const { redisUrl, prefix } = options;
  const monotonic = options.monotonic ?? (() => performance.now());
  const enqueueTimeoutMs = options.enqueueTimeoutMs ?? 2000;
  const report = options.onError ?? (() => undefined);

  let downSince: number | undefined;
  const markDown = (): void => void (downSince ??= monotonic());
  const markUp = (): void => void (downSince = undefined);

  // 入队连接：不通即报错，不拖住循环（D7 第 7.3 节“BullMQ 入队”一行）
  const producer = new Redis(redisUrl, {
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    commandTimeout: 500,
    connectTimeout: 1000,
  });
  producer.on("ready", markUp);
  producer.on("close", markDown);
  producer.on("error", (error) => report("queue.producer", error));

  const queues = new Map<QueueId, Queue>();
  const queueOf = (id: QueueId): Queue => {
    let queue = queues.get(id);
    if (queue === undefined) {
      queue = new Queue(id, { connection: producer, prefix });
      queue.on("error", (error) => report(`queue.${id}`, error));
      queues.set(id, queue);
    }
    return queue;
  };
  const closers: Array<() => Promise<void>> = [];

  return {
    async enqueue(queue, jobId, data) {
      assertNotInTransaction(`queue.enqueue(${queue})`);
      try {
        // 连接没就绪（还在连、正在重连）就不等：BullMQ 会一直等到连上为止
        if (producer.status !== "ready") throw new Error("Redis 未连接");
        await withTimeout(
          queueOf(queue).add(queue, data, {
            jobId,
            attempts: 1,
            removeOnComplete: { age: KEEP_JOB_SEC },
            removeOnFail: { age: KEEP_JOB_SEC },
          }),
          enqueueTimeoutMs,
          "入队",
        );
        markUp();
      } catch (error) {
        markDown();
        throw error;
      }
    },

    consume<T>(queue: QueueId, concurrency: number, handler: (data: T) => Promise<void>) {
      // 消费连接：BullMQ 要求 maxRetriesPerRequest 为 null；Redis 不通时它自己等着重连
      const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
      connection.on("error", (error) => report(`queue.${queue}.consumer`, error));
      const worker = new Worker<T>(queue, (job) => handler(job.data), {
        connection,
        prefix,
        concurrency,
        autorun: false,
      });
      worker.on("error", (error) => report(`queue.${queue}.consumer`, error));
      let running = false;
      // BullMQ 的 close 只认第一次调用的参数：到点还没等完就不再等，直接断开连接
      const close = async (timeoutMs: number): Promise<void> => {
        const force = timeoutMs <= 0;
        await withTimeout(worker.close(force), force ? 1000 : timeoutMs, "等在途任务").catch(
          () => undefined,
        );
        connection.disconnect();
      };
      closers.push(() => close(0));
      return {
        start() {
          if (running) return void worker.resume();
          running = true;
          worker.run().catch((error: unknown) => report(`queue.${queue}.consumer`, error));
        },
        pause: () => worker.pause(true),
        close,
      };
    },

    downForMs: () => (downSince === undefined ? 0 : monotonic() - downSince),

    async ping() {
      const alive =
        producer.status === "ready" && (await producer.ping().catch(() => "")) === "PONG";
      if (alive) markUp();
      else markDown();
      return alive;
    },

    async close() {
      await Promise.allSettled(closers.splice(0).map((close) => close()));
      await Promise.allSettled([...queues.values()].map((queue) => queue.close()));
      producer.disconnect();
    },
  };
}
