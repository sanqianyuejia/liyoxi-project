import {
  createRedisOutage,
  SAMPLE_TIMER_KINDS,
  useTestDatabase,
  useTestRedis,
  WORKER_SAMPLE_SUBSCRIBERS,
} from "@liyoxi/services/testing";
import { beforeAll, describe, expect, it, onTestFinished } from "vitest";

import { createHarness, SLOW, until } from "../support/harness.js";
import type { Harness } from "../support/harness.js";

// 任务书 第 7 节验收 5（01 第 7.3 节；x01 第 2.4 节 E7）：Redis 不可用。
// 判据：关键类样例订阅者与关键类定时器在进程内执行完成；非关键类回到 pending、scheduled 且 attempts 不加；
// 连续不可用满 60 秒后非关键类也在进程内执行。
// “不可用”在客户端一侧造（故障注入的转发口），不停共享的 Redis；“60 秒”拨的是注入的单调时钟。

const { critical, plain } = WORKER_SAMPLE_SUBSCRIBERS;
const db = useTestDatabase("worker");
const redis = useTestRedis();
let h: Harness;

beforeAll(async () => {
  h = await createHarness(db, redis);
}, SLOW);

describe("Redis 不可用（验收 5）", () => {
  it(
    "关键类进程内执行；非关键类放回去、不计次数；满 60 秒后非关键类也在进程内执行；恢复后照常走队列",
    async () => {
      const outage = await createRedisOutage();
      onTestFinished(() => outage.close(), SLOW);
      let now = 1_000;
      const worker = await h.instance({ redisUrl: outage.url, monotonic: () => now });
      const { outbox_relay, outbox_dispatch, timer_scan } = worker.runtime.loops;
      const round = async (): Promise<void> => {
        await outbox_relay.tick();
        await outbox_dispatch.tick();
        await timer_scan.tick();
      };
      const before = await h.counts();
      const eventId = await h.emitPlaced();
      const criticalTimer = await h.armTimer(SAMPLE_TIMER_KINDS.revivable);
      const plainTimer = await h.armTimer(SAMPLE_TIMER_KINDS.plain);
      const state = async () => ({
        deliveries: await h.deliveries([eventId]),
        timers: Object.fromEntries(
          (await h.timers([criticalTimer, plainTimer])).map((row) => [row.kind, row]),
        ),
        counts: await h.counts(),
      });

      await outage.down();
      await until("入队连接断开", async () => !(await worker.channel.ping()));
      await round();
      const first = await state();
      expect(first.deliveries).toEqual([
        { subscriber: critical, status: "done", attempts: 0, dispatchNo: 1, isEnqueued: false },
        { subscriber: plain, status: "pending", attempts: 0, dispatchNo: 1, isEnqueued: false },
      ]);
      expect(first.timers[SAMPLE_TIMER_KINDS.revivable]).toMatchObject({
        status: "fired",
        attempts: 0,
      });
      expect(first.timers[SAMPLE_TIMER_KINDS.plain]).toMatchObject({
        status: "scheduled",
        attempts: 0,
        isEnqueued: false,
      });
      expect(first.counts).toMatchObject({
        [critical]: before[critical] + 1,
        [SAMPLE_TIMER_KINDS.revivable]: before[SAMPLE_TIMER_KINDS.revivable] + 1,
        [plain]: before[plain],
        [SAMPLE_TIMER_KINDS.plain]: before[SAMPLE_TIMER_KINDS.plain],
      });

      // 不可用 59 秒：非关键类还是放回去，次数不加
      now += 59_000 - worker.channel.downForMs();
      await round();
      const waiting = await state();
      expect(waiting.deliveries[1]).toMatchObject({
        status: "pending",
        attempts: 0,
        dispatchNo: 2,
      });
      expect(waiting.timers[SAMPLE_TIMER_KINDS.plain]).toMatchObject({
        status: "scheduled",
        attempts: 0,
        dispatchNo: 2,
      });
      expect(waiting.counts[plain]).toBe(before[plain]);

      // 满 60 秒：非关键类也在进程内执行
      now += 1_000;
      expect(worker.channel.downForMs()).toBeGreaterThanOrEqual(60_000);
      await round();
      const forced = await state();
      expect(forced.deliveries[1]).toMatchObject({ status: "done", attempts: 0, dispatchNo: 3 });
      expect(forced.timers[SAMPLE_TIMER_KINDS.plain]).toMatchObject({
        status: "fired",
        attempts: 0,
      });
      expect(forced.counts).toMatchObject({
        [critical]: before[critical] + 1,
        [plain]: before[plain] + 1,
        [SAMPLE_TIMER_KINDS.revivable]: before[SAMPLE_TIMER_KINDS.revivable] + 1,
        [SAMPLE_TIMER_KINDS.plain]: before[SAMPLE_TIMER_KINDS.plain] + 1,
      });

      // 恢复：不可用时长归零，新的事件照常入队、由消费者处理
      await outage.up();
      await until("入队连接恢复", () => worker.channel.ping());
      expect(worker.channel.downForMs()).toBe(0);
      const laterId = await h.emitPlaced();
      await outbox_relay.tick();
      await outbox_dispatch.tick();
      expect((await h.deliveries([laterId])).map((row) => [row.status, row.isEnqueued])).toEqual([
        ["leased", true],
        ["leased", true],
      ]);
      worker.runtime.consumers.outbox_delivery.start();
      await until("恢复后的事件由队列消费完", async () =>
        (await h.deliveries([laterId])).every((row) => row.status === "done"),
      );
    },
    SLOW,
  );
});
