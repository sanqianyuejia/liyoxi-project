// 进程中断用例的场景（crash.test.ts 经 runUntilCrash 在子进程里跑它）。子进程拿不到父进程里的对象：
// 库、Redis 前缀、事件 id、时钟的时刻都经 payload 传。本文件不引 Vitest。
import { crashPoint, createClock, WORKER_SAMPLE_SUBSCRIBERS } from "@liyoxi/services/testing";

import { createInstance } from "../support/instance.js";

export interface CrashPayload {
  databaseUrl: string;
  redisPrefix: string;
  /** 父进程发的那个事件 */
  eventId: string;
  /** 业务时钟的时刻：与父进程用同一个，周期任务的栅格才对得上 */
  clockAt: string;
}

/**
 * 一个任务进程实例：补登记周期任务 → 展开 → 派发、扫描（全部认领并入队）→ 断点 claimed
 * → 在进程内消费一条投递，订阅者做完业务写、还没提交时到断点 business-written，在那里被杀。
 */
export default async function claimThenDie(payload: CrashPayload): Promise<void> {
  const worker = createInstance({
    databaseUrl: payload.databaseUrl,
    redisPrefix: payload.redisPrefix,
    clock: createClock(new Date(payload.clockAt)),
  });
  while (!(await worker.channel.ping())) await new Promise((resolve) => setTimeout(resolve, 50));
  const { ensure_recurring, outbox_relay, outbox_dispatch, timer_scan } = worker.runtime.loops;
  await ensure_recurring.tick();
  await outbox_relay.tick();
  await outbox_dispatch.tick();
  await timer_scan.tick();
  await crashPoint("claimed");

  const { plain } = WORKER_SAMPLE_SUBSCRIBERS;
  worker.control.after = async (name) => {
    if (name === plain) await crashPoint("business-written");
  };
  await worker.services.consume({ eventId: payload.eventId, subscriber: plain, dispatchNo: 1 });
  await worker.close();
}
