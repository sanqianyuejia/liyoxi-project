import {
  createClock,
  DEFAULT_CLOCK_START,
  runUntilCrash,
  SAMPLE_JOB_KINDS,
  SAMPLE_TIMER_KINDS,
  useTestDatabase,
  useTestRedis,
  WORKER_SAMPLE_SUBSCRIBERS,
} from "@liyoxi/services/testing";
import { beforeAll, describe, expect, it } from "vitest";

import { createHarness, SLOW, until } from "../support/harness.js";
import type { DeliveryState, Harness } from "../support/harness.js";
import type { CrashPayload } from "./crash-scenario.js";

// 任务书 第 7 节验收 2（D7 第 10.3 节 C13 的前半）：进程中断。一个实例认领并入队之后被 SIGKILL，
// 其中一条投递的订阅者已做完业务写、还没提交。
// 判据：租约到期后被重新认领并完成；原 is_enqueued = true 的 attempts + 1；业务动作各 1 次。
// 周期任务被中断的那一格以“认领序号 2、失败次数 1”完成：失败次数与认领序号是两列（01 分组 第 2.5 节），
// 任务书写的“attempts = 2”是草案里把两者合成一列时的说法。

const { critical, plain } = WORKER_SAMPLE_SUBSCRIBERS;
const { every5, daily } = SAMPLE_JOB_KINDS;
const db = useTestDatabase("worker");
const redis = useTestRedis();
let h: Harness;

beforeAll(async () => {
  h = await createHarness(db, redis);
}, SLOW);

describe("进程中断（验收 2）", () => {
  it(
    "认领后被杀：没提交的业务写回滚；租约到期后由另一个实例重新认领并完成，动作各 1 次",
    async () => {
      const before = await h.counts();
      const eventId = await h.emitPlaced();
      const timerIds = [
        await h.armTimer(SAMPLE_TIMER_KINDS.plain),
        await h.armTimer(SAMPLE_TIMER_KINDS.revivable),
      ];
      const timerRows = async () => [
        ...(await h.timers(timerIds)),
        ...(await h.slots(every5)),
        ...(await h.slots(daily)),
      ];

      let inFlight:
        { counts: Awaited<ReturnType<Harness["counts"]>>; rows: DeliveryState[] } | undefined;
      const payload: CrashPayload = {
        databaseUrl: h.databaseUrl,
        redisPrefix: h.redisPrefix,
        eventId,
        clockAt: DEFAULT_CLOCK_START,
      };
      const crashed = await runUntilCrash({
        module: new URL("./crash-scenario.ts", import.meta.url),
        payload,
        crashAt: "business-written",
        timeoutMs: 180_000,
        // 子进程停在断点上：订阅者的业务写还在它没提交的事务里，别的连接看不到
        onReach: async () => {
          inFlight = { counts: await h.counts(), rows: await h.deliveries([eventId]) };
        },
      });
      // 没走到断点时把子进程的输出带进报错
      expect(crashed, crashed.output).toMatchObject({
        killed: true,
        reached: ["claimed", "business-written"],
      });
      const claimed = { status: "leased", attempts: 0, dispatchNo: 1, isEnqueued: true };
      expect(inFlight?.rows).toEqual([
        { subscriber: critical, ...claimed },
        { subscriber: plain, ...claimed },
      ]);
      expect(inFlight?.counts).toEqual(before);

      // 被杀之后：业务写随事务回滚，行还停在“已认领、已入队”
      expect(await h.counts()).toEqual(before);
      expect(await h.deliveries([eventId])).toEqual(inFlight?.rows);
      const dispatched = await timerRows();
      expect(dispatched).toHaveLength(5); // 两个定时器，every5 两格，daily 一格
      for (const row of dispatched) {
        expect(row).toMatchObject({
          status: "dispatched",
          attempts: 0,
          dispatchNo: 1,
          isEnqueued: true,
        });
      }

      // 租约到期，另一个实例接着干。先重新认领、再让消费者开始领：被杀的那个实例入队的任务还在 Redis 里，
      // 它们带的是旧的认领序号，送达时不落结果
      await h.expireLeases();
      const worker = await h.instance({ clock: createClock(new Date(DEFAULT_CLOCK_START)) });
      await worker.runtime.loops.outbox_dispatch.tick();
      await worker.runtime.loops.timer_scan.tick();
      worker.runtime.start();
      await until(
        "投递、定时器、周期任务都完成",
        async () =>
          (await h.deliveries([eventId])).every((row) => row.status === "done") &&
          (await timerRows()).every((row) => row.status === "fired"),
        async () => ({ deliveries: await h.deliveries([eventId]), timers: await timerRows() }),
      );
      await worker.runtime.stop();

      for (const row of [...(await h.deliveries([eventId])), ...(await timerRows())]) {
        expect(row).toMatchObject({ attempts: 1, dispatchNo: 2 });
      }
      const after = await h.counts();
      expect(after).toEqual({
        [critical]: before[critical] + 1,
        [plain]: before[plain] + 1,
        [SAMPLE_TIMER_KINDS.plain]: before[SAMPLE_TIMER_KINDS.plain] + 1,
        [SAMPLE_TIMER_KINDS.revivable]: before[SAMPLE_TIMER_KINDS.revivable] + 1,
        [every5]: before[every5] + 2,
        [daily]: before[daily] + 1,
      });
    },
    SLOW,
  );
});
