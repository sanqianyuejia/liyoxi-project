import {
  deliverRepeatedly,
  useTestDatabase,
  useTestRedis,
  WORKER_SAMPLE_SUBSCRIBERS,
} from "@liyoxi/services/testing";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createHarness, SLOW, until } from "../support/harness.js";
import type { Harness } from "../support/harness.js";

// 任务书 第 7 节验收 1：重复投递。同一投递行被送达两次——租约过期重派一例、队列重复送达一例。
// 判据：样例订阅者的业务副作用 1 次；投递行终态 done；派发序号不符的那次不落结果。

const { critical, plain } = WORKER_SAMPLE_SUBSCRIBERS;
const db = useTestDatabase("worker");
const redis = useTestRedis();
let h: Harness;

beforeAll(async () => {
  h = await createHarness(db, redis);
}, SLOW);
beforeEach(() => h.settle(), SLOW);

/** 出站投递队列里已处理完的任务数（BullMQ 的 completed 集合） */
async function completedJobs(): Promise<number> {
  const client = await redis.raw();
  return client.zcard(`${redis.prefix}bull:outbox_delivery:completed`);
}

describe("重复投递（验收 1）", () => {
  it(
    "租约过期重派：两次派发的任务都送达，只有新的那次落结果，业务副作用 1 次",
    async () => {
      const worker = await h.instance();
      const { outbox_relay, outbox_dispatch } = worker.runtime.loops;
      const before = await h.counts();
      const doneBefore = await completedJobs();
      const eventId = await h.emitPlaced();

      await outbox_relay.tick();
      await outbox_dispatch.tick();
      const leased = { status: "leased", isEnqueued: true };
      expect(await h.deliveries([eventId])).toEqual([
        { subscriber: critical, ...leased, attempts: 0, dispatchNo: 1 },
        { subscriber: plain, ...leased, attempts: 0, dispatchNo: 1 },
      ]);
      // 消费者还没开始领：第一次派发的任务躺在队列里，租约先到期了
      await h.expireLeases();
      await outbox_dispatch.tick();
      expect(await h.deliveries([eventId])).toEqual([
        { subscriber: critical, ...leased, attempts: 1, dispatchNo: 2 },
        { subscriber: plain, ...leased, attempts: 1, dispatchNo: 2 },
      ]);

      worker.runtime.consumers.outbox_delivery.start();
      await until("四条任务都处理完", async () => (await completedJobs()) - doneBefore >= 4);
      const done = { status: "done", attempts: 1, dispatchNo: 2, isEnqueued: true };
      expect(await h.deliveries([eventId])).toEqual([
        { subscriber: critical, ...done },
        { subscriber: plain, ...done },
      ]);
      const after = await h.counts();
      expect([after[critical], after[plain]]).toEqual([before[critical] + 1, before[plain] + 1]);
      // 序号不符的那次没有调到订阅者：每个订阅者只被调了一次
      expect(worker.control.calls.sort()).toEqual([
        `${critical}:${eventId}`,
        `${plain}:${eventId}`,
      ]);
    },
    SLOW,
  );

  it(
    "队列重复送达：同一条任务同时送达 5 次、之后队列再送一次，业务副作用 1 次",
    async () => {
      const worker = await h.instance();
      const { outbox_relay, outbox_dispatch } = worker.runtime.loops;
      const before = await h.counts();
      const doneBefore = await completedJobs();
      const eventId = await h.emitPlaced();
      await outbox_relay.tick();
      await outbox_dispatch.tick();

      const ref = { eventId, subscriber: plain, dispatchNo: 1 };
      const delivered = await deliverRepeatedly((one) => worker.services.consume(one), ref, {
        times: 5,
        mode: "concurrent",
      });
      expect(delivered.rejected).toEqual([]);
      expect(delivered.fulfilled.sort()).toEqual(["done", "stale", "stale", "stale", "stale"]);

      // 队列里原本的那条任务此时才送到：行已 done，不再落结果
      worker.runtime.consumers.outbox_delivery.start();
      await until("两条任务都处理完", async () => (await completedJobs()) - doneBefore >= 2);
      const done = { status: "done", attempts: 0, dispatchNo: 1, isEnqueued: true };
      expect(await h.deliveries([eventId])).toEqual([
        { subscriber: critical, ...done },
        { subscriber: plain, ...done },
      ]);
      const after = await h.counts();
      expect([after[critical], after[plain]]).toEqual([before[critical] + 1, before[plain] + 1]);
      expect(worker.control.calls.filter((call) => call === `${plain}:${eventId}`)).toHaveLength(1);
    },
    SLOW,
  );
});
