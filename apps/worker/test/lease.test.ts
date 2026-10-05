import { useTestDatabase, useTestRedis } from "@liyoxi/services/testing";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createLeaseKeeper } from "../src/lease.js";
import { silentLogger } from "../src/log.js";
import type { Loop } from "../src/loop.js";
import { createHarness, SLOW, until } from "./support/harness.js";
import type { Harness } from "./support/harness.js";

// 任务书 第 7 节验收 6（D7 第 10.3 节 C12）：租约。
// 两个实例抢租约只有一个主；续约挂起 20 秒后看门狗降级并停循环；主停顿超过接任时限后备机接任，
// 原主恢复后自行降级；关停（收到 SIGTERM 走的就是它）时主动让出。
// 看门狗只读本机单调时钟：用例换成自己拨的。接任时限是数据库时间、拨不了：用例把 30 秒调成 2 秒，真等。

const TAKEOVER_SEC = 2;
const db = useTestDatabase("worker");
const redis = useTestRedis();
let h: Harness;

beforeAll(async () => {
  h = await createHarness(db, redis);
}, SLOW);
beforeEach(async () => {
  // 上一条用例留下的租约：改成“早就没人续约了”，这一条从没有主开始（行不可删）
  await h.prisma.$executeRawUnsafe(
    "UPDATE worker_lease SET holder = 'lyxtest:nobody', heartbeat_at = 'epoch'::timestamptz",
  );
}, SLOW);

const pair = () =>
  Promise.all(
    ["a", "b"].map((name) => h.instance({ lease: { name, takeoverAfterSec: TAKEOVER_SEC } })),
  );
const holder = async (): Promise<string | undefined> => {
  const rows = await h.prisma.$queryRawUnsafe<Array<{ holder: string }>>(
    "SELECT holder FROM worker_lease WHERE name = 'primary'",
  );
  return rows[0]?.holder;
};
const loopsRunning = (worker: Awaited<ReturnType<Harness["instance"]>>): boolean[] =>
  Object.values(worker.runtime.loops).map((loop) => loop.running);

describe("租约：连真库（验收 6）", () => {
  it(
    "两个实例同时抢，每一轮都只有一个主",
    async () => {
      const [a, b] = await pair();
      for (let round = 0; round < 10; round += 1) {
        await h.prisma.$executeRawUnsafe(
          "UPDATE worker_lease SET holder = 'lyxtest:nobody', heartbeat_at = 'epoch'::timestamptz",
        );
        await Promise.all([a?.runtime.keeper?.renewOnce(), b?.runtime.keeper?.renewOnce()]);
        const active = [a, b].filter((one) => one?.runtime.active);
        expect(active).toHaveLength(1);
        expect(await holder()).toBe(active[0]?.lease?.holder);
        expect(loopsRunning(active[0] as NonNullable<typeof a>)).toEqual([true, true, true, true]);
        const idle = [a, b].find((one) => one?.runtime.active === false) as NonNullable<typeof a>;
        expect(loopsRunning(idle)).toEqual([false, false, false, false]);
      }
    },
    SLOW,
  );

  it(
    "主停顿超过接任时限：备机接任；原主恢复后续约落空，自行降级",
    async () => {
      const [a, b] = (await pair()) as [
        NonNullable<Awaited<ReturnType<Harness["instance"]>>>,
        never,
      ];
      const standby = b as typeof a;
      await a.runtime.keeper?.renewOnce();
      await standby.runtime.keeper?.renewOnce();
      expect([a.runtime.active, standby.runtime.active]).toEqual([true, false]);

      // 主不再续约。备机每次来问都接不了，直到心跳老过接任时限
      await until("备机接任", async () => {
        await standby.runtime.keeper?.renewOnce();
        return standby.runtime.active;
      });
      expect(await holder()).toBe(standby.lease?.holder);
      // 这一刻原主还以为自己是主：两个实例短暂同时干活，靠 SKIP LOCKED 与幂等不出错
      expect(a.runtime.active).toBe(true);
      await a.runtime.keeper?.renewOnce();
      expect([a.runtime.active, standby.runtime.active]).toEqual([false, true]);
      expect(loopsRunning(a)).toEqual([false, false, false, false]);
      expect(await holder()).toBe(standby.lease?.holder);
    },
    SLOW,
  );

  it(
    "关停时主动让出：另一个实例不用等接任时限，下一次续约就是主",
    async () => {
      const [a, b] = (await pair()) as [
        NonNullable<Awaited<ReturnType<Harness["instance"]>>>,
        never,
      ];
      const standby = b as typeof a;
      await a.runtime.keeper?.renewOnce();
      await standby.runtime.keeper?.renewOnce();
      expect([a.runtime.active, standby.runtime.active]).toEqual([true, false]);

      await a.runtime.stop();
      expect(a.runtime.active).toBe(false);
      expect(loopsRunning(a)).toEqual([false, false, false, false]);
      const [row] = await h.prisma.$queryRawUnsafe<Array<{ yielded: boolean }>>(
        "SELECT heartbeat_at < now() - interval '1 day' AS yielded FROM worker_lease",
      );
      expect(row?.yielded).toBe(true);
      await standby.runtime.keeper?.renewOnce();
      expect(standby.runtime.active).toBe(true);
    },
    SLOW,
  );
});

describe("看门狗：只读本地变量", () => {
  /** 假的循环与租约：时间全由用例拨 */
  function rig(renew: () => Promise<boolean>) {
    const state = { now: 0, promoted: 0, demoted: 0, exits: [] as number[] };
    const loop = { name: "outbox_relay", intervalMs: 1_000, running: false, lastBeat: 0 };
    const keeper = createLeaseKeeper({
      lease: { holder: "lyxtest:rig", renew },
      loops: [loop as unknown as Loop],
      onPromote: () => {
        state.promoted += 1;
        loop.running = true;
        loop.lastBeat = state.now;
      },
      onDemote: () => {
        state.demoted += 1;
        loop.running = false;
      },
      logger: silentLogger,
      monotonic: () => state.now,
      exit: (code) => void state.exits.push(code),
    });
    return { state, loop, keeper };
  }

  it("续约挂起不返回：20 秒后降级并停循环，不退出进程；挂着的时候不叠加新的续约", async () => {
    let calls = 0;
    let hang = false;
    const { state, loop, keeper } = rig(() => {
      calls += 1;
      return hang ? new Promise<boolean>(() => undefined) : Promise.resolve(true);
    });
    await keeper.renewOnce();
    expect([keeper.primary, state.promoted, loop.running]).toEqual([true, 1, true]);

    hang = true;
    void keeper.renewOnce();
    void keeper.renewOnce();
    expect(calls).toBe(2);
    state.now = 20_000;
    loop.lastBeat = state.now;
    keeper.watch();
    expect([keeper.primary, state.demoted]).toEqual([true, 0]);
    state.now = 20_001;
    loop.lastBeat = state.now;
    keeper.watch();
    expect([keeper.primary, state.demoted, loop.running]).toEqual([false, 1, false]);
    expect(state.exits).toEqual([]);
  });

  it("续约失败（抛错）同样不算续上：到点降级", async () => {
    let fail = false;
    const { state, keeper } = rig(() =>
      fail ? Promise.reject(new Error("样例：语句超时")) : Promise.resolve(true),
    );
    await keeper.renewOnce();
    fail = true;
    state.now = 15_000;
    await keeper.renewOnce();
    keeper.watch();
    expect(keeper.primary).toBe(true);
    state.now = 20_001;
    keeper.watch();
    expect([keeper.primary, state.demoted]).toEqual([false, 1]);
  });

  it("看门狗晚到 10 秒以上（事件循环卡死）：退出进程", async () => {
    const { state, keeper } = rig(() => Promise.resolve(true));
    await keeper.renewOnce();
    keeper.watch();
    state.now += 1_000 + 10_000;
    keeper.watch();
    expect(state.exits).toEqual([]);
    state.now += 1_000 + 10_001;
    keeper.watch();
    expect(state.exits).toEqual([1]);
  });

  it("是主且某个循环连续两个周期没有进展（不少于 60 秒）：退出进程；不是主时不看", async () => {
    const { state, keeper } = rig(() => Promise.resolve(true));
    await keeper.renewOnce();
    const step = async (ms: number): Promise<void> => {
      state.now += ms;
      await keeper.renewOnce(); // 租约一直续得上
      keeper.watch();
    };
    for (let passed = 0; passed < 60_000; passed += 1_000) await step(1_000);
    expect(state.exits).toEqual([]); // 循环 60 秒没动：还在下限之内
    await step(1_000);
    expect(state.exits).toEqual([1]);

    const idle = rig(() => Promise.resolve(false));
    idle.loop.running = true;
    for (let passed = 0; passed < 120_000; passed += 1_000) {
      idle.state.now += 1_000;
      idle.keeper.watch();
    }
    expect(idle.state.exits).toEqual([]);
  });
});
