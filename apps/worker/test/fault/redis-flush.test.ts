import {
  createClock,
  SAMPLE_JOB_KINDS,
  SAMPLE_TIMER_KINDS,
  useTestDatabase,
  useTestRedis,
  WORKER_SAMPLE_SUBSCRIBERS,
} from "@liyoxi/services/testing";
import { beforeAll, describe, expect, it } from "vitest";

import { createHarness, sleep, SLOW, until } from "../support/harness.js";
import type { Harness } from "../support/harness.js";

// 任务书 第 7 节验收 3（D7 第 7.3 节验证清单第 6 项、第 10.4 节 R8）：两个队列都有在途任务时清空 Redis，worker 不重启。
// 判据：投递与定时器在租约到期后继续；周期任务下一格照常触发；无重复副作用。
// “清空”只清本会话、本 worker 的键前缀（测试支架的 flush），不动共享实例上别的键。

const { critical, plain } = WORKER_SAMPLE_SUBSCRIBERS;
const { every5, daily } = SAMPLE_JOB_KINDS;
const EVENTS = 5;
const TIMERS = 3;

const db = useTestDatabase("worker");
const redis = useTestRedis();
let h: Harness;

beforeAll(async () => {
  h = await createHarness(db, redis);
  // 支架第一次用到这个前缀时会先清一遍上一轮的残留：放在这里做掉，用例里那一次清的就只是在途任务
  await redis.flush();
}, SLOW);

describe("清空 Redis（验收 3）", () => {
  it(
    "在途任务丢了：租约到期后重新派发并完成；下一格周期任务照常触发；没有重复副作用",
    async () => {
      const clock = createClock();
      const worker = await h.instance({ clock });
      const { loops, consumers } = worker.runtime;
      const before = await h.counts();
      const eventIds = await Promise.all(Array.from({ length: EVENTS }, h.emitPlaced));
      const timerIds = [
        ...(await Promise.all(
          Array.from({ length: TIMERS }, () => h.armTimer(SAMPLE_TIMER_KINDS.plain)),
        )),
        ...(await Promise.all(
          Array.from({ length: TIMERS }, () => h.armTimer(SAMPLE_TIMER_KINDS.revivable)),
        )),
      ];
      const rows = async () => ({
        deliveries: await h.deliveries(eventIds),
        timers: [
          ...(await h.timers(timerIds)),
          ...(await h.slots(every5)),
          ...(await h.slots(daily)),
        ],
      });

      // 四个循环先跑起来，消费者还不领任务：任务都停在队列里
      for (const loop of Object.values(loops)) loop.start();
      await until(
        "两个队列都有在途任务",
        async () => {
          const { deliveries, timers } = await rows();
          return (
            deliveries.length === EVENTS * 2 &&
            timers.length === TIMERS * 2 + 3 &&
            [...deliveries, ...timers].every((row) => row.isEnqueued)
          );
        },
        rows,
      );

      expect(await redis.flush()).toBeGreaterThan(0);
      for (const consumer of Object.values(consumers)) consumer.start();
      // 任务没了，租约还没到期：什么都不会发生
      await sleep(1000);
      const lost = await rows();
      expect(lost.deliveries.every((row) => row.status === "leased" && row.dispatchNo === 1)).toBe(
        true,
      );
      expect(lost.timers.every((row) => row.status === "dispatched" && row.dispatchNo === 1)).toBe(
        true,
      );
      expect(await h.counts()).toEqual(before);

      // 租约到期：还是同一个实例、没有重启，循环把它们重新派发出去
      await h.expireLeases();
      await until(
        "投递与定时器都处理完",
        async () => {
          const { deliveries, timers } = await rows();
          return (
            deliveries.every((row) => row.status === "done") &&
            timers.every((row) => row.status === "fired")
          );
        },
        rows,
      );
      const healed = await rows();
      for (const row of [...healed.deliveries, ...healed.timers]) {
        expect(row).toMatchObject({ attempts: 1, dispatchNo: 2 });
      }

      // 周期任务的下一格：时钟走过 5 分钟，补登记循环登记它，扫描、队列、执行照常
      clock.advance(5 * 60_000);
      await until(
        "下一格周期任务触发",
        async () => {
          const fives = await h.slots(every5);
          return fives.length === 3 && fives.every((row) => row.status === "fired");
        },
        () => h.slots(every5),
      );
      const [, , next] = await h.slots(every5);
      expect(next).toMatchObject({ attempts: 0, dispatchNo: 1 });
      await worker.runtime.stop();

      const after = await h.counts();
      expect({
        [critical]: after[critical] - before[critical],
        [plain]: after[plain] - before[plain],
        [SAMPLE_TIMER_KINDS.plain]:
          after[SAMPLE_TIMER_KINDS.plain] - before[SAMPLE_TIMER_KINDS.plain],
        [SAMPLE_TIMER_KINDS.revivable]:
          after[SAMPLE_TIMER_KINDS.revivable] - before[SAMPLE_TIMER_KINDS.revivable],
        [every5]: after[every5] - before[every5],
        [daily]: after[daily] - before[daily],
      }).toEqual({
        [critical]: EVENTS,
        [plain]: EVENTS,
        [SAMPLE_TIMER_KINDS.plain]: TIMERS,
        [SAMPLE_TIMER_KINDS.revivable]: TIMERS,
        [every5]: 3,
        [daily]: 1,
      });
      const subscriberCalls = worker.control.calls.filter((call) =>
        call.startsWith("lyxtest.onPlaced"),
      );
      expect(new Set(subscriberCalls).size).toBe(EVENTS * 2);
      expect(subscriberCalls).toHaveLength(EVENTS * 2);
    },
    SLOW,
  );
});
