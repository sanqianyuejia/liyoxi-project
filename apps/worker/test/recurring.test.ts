import { LOOPS, QUEUES } from "@liyoxi/contract/registry";
import {
  createClock,
  SAMPLE_JOB_KINDS,
  useTestDatabase,
  useTestRedis,
} from "@liyoxi/services/testing";
import { beforeAll, describe, expect, it } from "vitest";

import { recurringTable } from "../src/recurring.js";
import { LOOP_INTERVALS_MS, QUEUE_CONCURRENCY } from "../src/runtime.js";
import { createHarness, SLOW } from "./support/harness.js";
import type { Harness } from "./support/harness.js";

// 任务书 第 7 节验收 10（D7 第 10.4 节 R9）：周期补登记循环每 60 秒一轮；
// 标 envs: ["stg"] 的样例任务在生产配置下不出现在登记表与处理器表。另：循环名、队列名取契约的登记。

const { every5, daily, stgOnly } = SAMPLE_JOB_KINDS;
const db = useTestDatabase("worker");
const redis = useTestRedis();
let h: Harness;

beforeAll(async () => {
  h = await createHarness(db, redis);
}, SLOW);

describe("循环与队列的登记", () => {
  it("四个循环的节奏：中继与派发每秒、扫描每 20 秒、补登记每 60 秒；名字都在契约的登记里", () => {
    expect(LOOP_INTERVALS_MS).toEqual({
      outbox_relay: 1_000,
      outbox_dispatch: 1_000,
      timer_scan: 20_000,
      ensure_recurring: 60_000,
    });
    const loops = new Set<string>(LOOPS.map((loop) => loop.id));
    for (const name of Object.keys(LOOP_INTERVALS_MS)) expect(loops).toContain(name);
    const queues = new Set<string>(QUEUES.map((queue) => queue.id));
    for (const name of Object.keys(QUEUE_CONCURRENCY)) expect(queues).toContain(name);
    expect(QUEUE_CONCURRENCY).toEqual({ outbox_delivery: 4, timer_run: 4 });
  });
});

describe("周期补登记（验收 10）", () => {
  it(
    "只在预发登记的任务：生产配置下登记表与处理器表里都没有它，补登记也不建它的行；预发配置下有",
    async () => {
      const prod = await h.instance({ appEnv: "prod" });
      expect(recurringTable(prod.services).map((job) => job.kind)).toEqual([daily, every5]);
      expect(prod.services.assembly.recurringJob(stgOnly)).toBeUndefined();
      expect(recurringTable(prod.services)).toContainEqual({
        kind: every5,
        module: "lyxtest_worker",
        schedule: { every: "minutes", minutes: 5 },
        mode: "tx",
        deadlineMin: undefined,
        missSeverity: undefined,
        catchUp: true,
      });
      await prod.runtime.loops.ensure_recurring.tick();
      expect(await h.slots(stgOnly)).toEqual([]);
      expect((await h.slots(every5)).length).toBeGreaterThan(0);

      const stg = await h.instance({ appEnv: "stg" });
      expect(recurringTable(stg.services).map((job) => job.kind)).toEqual([daily, every5, stgOnly]);
      expect(stg.services.assembly.recurringJob(stgOnly)).toBeDefined();
      await stg.runtime.loops.ensure_recurring.tick();
      expect(await h.slots(stgOnly)).toHaveLength(1);
    },
    SLOW,
  );

  it(
    "每一轮按登记表补上下一期；同一格只登记一次；时钟走到下一格，下一轮接着补",
    async () => {
      const clock = createClock(new Date("2026-06-01T00:02:00Z"));
      const worker = await h.instance({ clock });
      const tick = () => worker.runtime.loops.ensure_recurring.tick();
      const june = async (): Promise<string[]> =>
        (await h.slots(every5)).map((row) => row.key).filter((key) => key.includes("2026-06-01"));

      await tick();
      expect(await june()).toEqual([
        `${every5}:2026-06-01T00:00:00Z`, // 补的最近一格
        `${every5}:2026-06-01T00:05:00Z`, // 下一期
      ]);
      await tick();
      await tick();
      expect(await june()).toHaveLength(2);

      clock.advance(5 * 60_000);
      await tick();
      expect(await june()).toEqual([
        `${every5}:2026-06-01T00:00:00Z`,
        `${every5}:2026-06-01T00:05:00Z`,
        `${every5}:2026-06-01T00:10:00Z`,
      ]);
    },
    SLOW,
  );
});
