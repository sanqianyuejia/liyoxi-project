import {
  createClock,
  SAMPLE_JOB_KINDS,
  SAMPLE_TIMER_KINDS,
  useTestDatabase,
  useTestRedis,
  WORKER_SAMPLE_SUBSCRIBERS,
} from "@liyoxi/services/testing";
import { beforeAll, describe, expect, it } from "vitest";

import { createHarness, SLOW, until } from "../support/harness.js";
import type { Harness } from "../support/harness.js";

// 任务书 第 7 节验收 4（D7 第 10.3 节 C7、C8、C13 的后半）：两个实例绕过租约，同时跑四个循环与两个队列的消费者。
// 判据：每个事件每个订阅者副作用 1 次；每个定时器动作 1 次；同一格周期任务只有一行。

const { critical, plain } = WORKER_SAMPLE_SUBSCRIBERS;
const { every5, daily } = SAMPLE_JOB_KINDS;
const EVENTS = 30;
const TIMERS = 10;

const db = useTestDatabase("worker");
const redis = useTestRedis();
let h: Harness;

beforeAll(async () => {
  h = await createHarness(db, redis);
}, SLOW);

describe("双 worker（验收 4）", () => {
  it(
    "两个实例同时干活：不重不漏",
    async () => {
      const clock = createClock();
      const [a, b] = await Promise.all([h.instance({ clock }), h.instance({ clock })]);
      const before = await h.counts();
      // 一半的数据在两个实例起来之前就有，另一半在它们跑着的时候进来
      const eventIds = await Promise.all(Array.from({ length: EVENTS / 2 }, h.emitPlaced));
      const timerIds = await Promise.all(
        Array.from({ length: TIMERS }, (_, n) =>
          h.armTimer(n % 2 === 0 ? SAMPLE_TIMER_KINDS.plain : SAMPLE_TIMER_KINDS.revivable),
        ),
      );
      a.runtime.start();
      b.runtime.start();
      eventIds.push(...(await Promise.all(Array.from({ length: EVENTS / 2 }, h.emitPlaced))));
      timerIds.push(
        ...(await Promise.all(
          Array.from({ length: TIMERS }, (_, n) =>
            h.armTimer(n % 2 === 0 ? SAMPLE_TIMER_KINDS.plain : SAMPLE_TIMER_KINDS.revivable),
          ),
        )),
      );

      const settled = async (): Promise<boolean> => {
        const [deliveries, timers, fives, dailies] = await Promise.all([
          h.deliveries(eventIds),
          h.timers(timerIds),
          h.slots(every5),
          h.slots(daily),
        ]);
        return (
          deliveries.length === EVENTS * 2 &&
          deliveries.every((row) => row.status === "done") &&
          timers.every((row) => row.status === "fired") &&
          fives.length === 2 &&
          dailies.length === 1 &&
          [...fives, ...dailies].every((row) => row.status === "fired")
        );
      };
      await until("事件、定时器、周期任务都处理完", settled, async () => ({
        deliveries: (await h.deliveries(eventIds)).filter((row) => row.status !== "done"),
        timers: (await h.timers(timerIds)).filter((row) => row.status !== "fired"),
        slots: [...(await h.slots(every5)), ...(await h.slots(daily))],
      }));
      await Promise.all([a.runtime.stop(), b.runtime.stop()]);

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
        [every5]: 2, // 两格：下一期与补的最近一格
        [daily]: 1,
      });
      // 订阅者没有自己的守卫：被调到的次数就是执行的次数，两个实例合起来每对（事件, 订阅者）恰一次
      const calls = [...a.control.calls, ...b.control.calls].filter((call) =>
        call.startsWith("lyxtest.onPlaced"),
      );
      expect(calls).toHaveLength(EVENTS * 2);
      expect(new Set(calls).size).toBe(EVENTS * 2);
      // 两个实例都干了活
      expect(a.control.calls.length).toBeGreaterThan(0);
      expect(b.control.calls.length).toBeGreaterThan(0);
      // 两个实例各补登记了许多轮：同一格只有一行
      const duplicated = await h.prisma.$queryRawUnsafe<unknown[]>(
        `SELECT dedupe_key FROM timer WHERE subject_type IS NULL AND status <> 'cancelled'
          GROUP BY dedupe_key HAVING count(*) > 1`,
      );
      expect(duplicated).toEqual([]);
    },
    SLOW,
  );
});
