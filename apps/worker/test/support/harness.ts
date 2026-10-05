// 故障注入用例的共用部分（W0-23）：造数据、读状态、等一件事发生。只给 apps/worker 的用例用。
// 断言都落在数据库的行上：投递行、定时器行、样例处理器的计数。等待一律是“等到看见为止”，不卡秒数。
import { randomUUID } from "node:crypto";

import {
  createSampleEvents,
  SAMPLE_TIMER_SUBJECT,
  sampleSystemContext,
  workerSampleCounts,
} from "@liyoxi/services/testing";
import type { TestDatabase, TestRedis } from "@liyoxi/services/testing";
import { onTestFinished } from "vitest";

import { createInstance } from "./instance.js";
import type { Instance, InstanceOptions } from "./instance.js";

/** 连库、连 Redis 的用例与钩子的时限：机器忙的时候建库、起子进程都慢 */
export const SLOW = 240_000;
/** 等一件事发生的上限 */
const PATIENCE_MS = 90_000;

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** 等到 check 为真；到上限还没等到即抛错，带上 describe 给的现场 */
export async function until(
  what: string,
  check: () => boolean | Promise<boolean>,
  describe?: () => unknown,
): Promise<void> {
  const deadline = Date.now() + PATIENCE_MS;
  while (!(await check())) {
    if (Date.now() > deadline) {
      const scene = describe === undefined ? "" : `；现场：${JSON.stringify(await describe())}`;
      throw new Error(`等了 ${PATIENCE_MS} 毫秒也没等到：${what}${scene}`);
    }
    await sleep(50);
  }
}

export interface DeliveryState {
  subscriber: string;
  status: string;
  attempts: number;
  dispatchNo: number;
  isEnqueued: boolean;
}
export interface TimerState {
  id: string;
  kind: string;
  key: string;
  status: string;
  attempts: number;
  dispatchNo: number;
  isEnqueued: boolean;
}

export async function createHarness(db: TestDatabase, redis: TestRedis) {
  const prisma = await db.prisma();
  const databaseUrl = await db.url();
  // 造数据用的装配：只为拿到 emit 与开事务的入口，登记的名字与实例里的样例相同
  const seedInstance = createInstance({ databaseUrl, redisPrefix: redis.prefix });
  const seed = createSampleEvents(prisma, {
    registrations: [seedInstance.sample.registration, seedInstance.ports.registration],
  });
  await seedInstance.close();
  const timers = seedInstance.services.timers;

  return {
    prisma,
    databaseUrl,
    redisPrefix: redis.prefix,
    /** 起一个实例（等它的入队连接就绪）；用例结束时自动收尾 */
    async instance(options: Partial<InstanceOptions> = {}): Promise<Instance> {
      const one = createInstance({ databaseUrl, redisPrefix: redis.prefix, ...options });
      onTestFinished(() => one.close());
      await until("入队连接就绪", () => one.channel.ping());
      return one;
    },
    /** 发一个样例事件（两个样例订阅者都订阅它），返回事件 id */
    async emitPlaced(): Promise<string> {
      const dramaOrderId = randomUUID();
      const result = await seed.tx.run((tx) =>
        seed.events.emit(tx, sampleSystemContext(), {
          type: "lyxtest.order.placed",
          aggregate: { type: "drama_order", id: dramaOrderId },
          payload: { v: 1, dramaOrderId },
        }),
      );
      return result.id as string;
    },
    /** 登记一个立刻到点的样例定时器，返回它的 id */
    async armTimer(kind: string): Promise<string> {
      const subject = { type: SAMPLE_TIMER_SUBJECT, id: randomUUID() };
      const armed = await seed.tx.run((tx) =>
        timers.arm(tx, {
          kind,
          subject,
          key: `${kind}:${subject.type}:${subject.id}`,
          fireAt: new Date(Date.now() - 1000),
        }),
      );
      return armed.id;
    },
    counts: () => workerSampleCounts(prisma),
    deliveries: (eventIds: readonly string[]): Promise<DeliveryState[]> =>
      prisma.$queryRawUnsafe<DeliveryState[]>(
        `SELECT subscriber, status, attempts::int AS attempts, dispatch_no::int AS "dispatchNo",
                is_enqueued AS "isEnqueued"
           FROM outbox_delivery WHERE outbox_event_id = ANY($1::uuid[])
          ORDER BY outbox_event_id, subscriber`,
        eventIds,
      ),
    timers: (ids: readonly string[]): Promise<TimerState[]> =>
      prisma.$queryRawUnsafe<TimerState[]>(
        `SELECT id::text AS id, kind, dedupe_key AS key, status, attempts::int AS attempts,
                dispatch_no::int AS "dispatchNo", is_enqueued AS "isEnqueued"
           FROM timer WHERE id = ANY($1::uuid[]) ORDER BY id`,
        ids,
      ),
    /** 某个周期任务已有的各期，按计划时刻 */
    slots: (kind: string): Promise<TimerState[]> =>
      prisma.$queryRawUnsafe<TimerState[]>(
        `SELECT id::text AS id, kind, dedupe_key AS key, status, attempts::int AS attempts,
                dispatch_no::int AS "dispatchNo", is_enqueued AS "isEnqueued"
           FROM timer WHERE kind = $1::text AND subject_type IS NULL ORDER BY dedupe_key`,
        kind,
      ),
    /** 让在途的租约立刻过期：扮“租约到期”，不用真等 2 分钟、5 分钟 */
    async expireLeases(): Promise<void> {
      await prisma.$executeRawUnsafe(
        "UPDATE outbox_delivery SET lease_until = now() - interval '1 second' WHERE status = 'leased'",
      );
      await prisma.$executeRawUnsafe(
        "UPDATE timer SET lease_until = now() - interval '1 second' WHERE status = 'dispatched'",
      );
    },
    /** 把上一条用例留下的未完成的行收掉：每条用例只看自己造的数据 */
    async settle(): Promise<void> {
      await prisma.$executeRawUnsafe(
        "UPDATE outbox_delivery SET status = 'done', consumed_at = now(), lease_until = NULL WHERE status <> 'done'",
      );
      await prisma.$executeRawUnsafe(
        "UPDATE timer SET status = 'cancelled', lease_until = NULL WHERE status IN ('scheduled', 'dispatched')",
      );
    },
  };
}
export type Harness = Awaited<ReturnType<typeof createHarness>>;
