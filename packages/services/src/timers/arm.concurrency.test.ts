import type { PrismaClient } from "@liyoxi/db";
import { beforeAll, describe, expect, it } from "vitest";

import type { TxRunner } from "../kernel/index.js";
import { SAMPLE_TIMER_KINDS, useTestDatabase } from "../testing/index.js";
import {
  liveCount,
  newSubject,
  ROOMY,
  runner,
  sampleTimers,
  SLOW,
  timerRows,
} from "./__fixtures__/db.js";
import { timerKey } from "./index.js";

// 任务书 第 7 节验收 2（甲类的并发测试）：20 条连接同键并发 arm，提交后恰 1 行；一边 arm 一边 cancel 不死锁。各重复 ROUNDS 次。
// 真实的调用方先锁住主体的业务行，同一主体上的登记与取消本来就排着队；这里故意不锁，量的是 timer 表自己兜不兜得住。

const ROUNDS = 20;
const CONNECTIONS = 20;

const db = useTestDatabase("services", { max: CONNECTIONS });
const timers = sampleTimers();
let prisma: PrismaClient;
let tx: TxRunner;

beforeAll(async () => {
  prisma = await db.prisma();
  tx = runner(prisma);
}, SLOW);

const kind = SAMPLE_TIMER_KINDS.plain;
const T0 = Date.parse("2026-03-02T02:00:00.000Z");

/** 栅栏：n 方都到了才一起放行，让各个事务先都开起来再同时动手 */
function barrier(n: number): () => Promise<void> {
  let arrived = 0;
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  return () => {
    arrived += 1;
    if (arrived >= n) open();
    return opened;
  };
}

describe("并发登记", () => {
  it(
    `${CONNECTIONS} 条连接同键并发 arm：提交后恰 1 行，一个新建、其余改期；重复 ${ROUNDS} 次`,
    async () => {
      for (let round = 0; round < ROUNDS; round += 1) {
        const subject = newSubject();
        const key = timerKey(kind, subject);
        const ready = barrier(CONNECTIONS);
        const results = await Promise.all(
          Array.from({ length: CONNECTIONS }, (_, index) =>
            tx.run(async (handle) => {
              await handle.$queryRawUnsafe("SELECT 1");
              await ready();
              return timers.arm(handle, {
                kind,
                subject,
                key,
                fireAt: new Date(T0 + index * 60_000),
                payload: { index },
              });
            }, ROOMY),
          ),
        );
        const rows = await timerRows(prisma, key);
        expect(rows).toHaveLength(1);
        expect(rows[0]!.status).toBe("scheduled");
        expect(await liveCount(prisma, key)).toBe(1);
        expect(new Set(results.map((result) => result.id))).toEqual(new Set([rows[0]!.id]));
        expect(results.filter((result) => result.outcome === "created")).toHaveLength(1);
        expect(results.filter((result) => result.outcome === "rescheduled")).toHaveLength(
          CONNECTIONS - 1,
        );
        // 留下的到期时间与参数出自同一次登记
        const index = (rows[0]!.payload as { index: number }).index;
        expect(rows[0]!.fire_at).toEqual(new Date(T0 + index * 60_000));
      }
    },
    SLOW,
  );

  it(
    `一边 arm 一边 cancel：不死锁、不重试，任一键未取消的行不超过 1；重复 ${ROUNDS} 次`,
    async () => {
      const suffixes = ["a", "b", "c"];
      let bodies = 0;
      let transactions = 0;
      for (let round = 0; round < ROUNDS; round += 1) {
        const subject = newSubject();
        const keys = suffixes.map((suffix) => timerKey(kind, subject, suffix));
        // 先各登记一行，让取消有东西可锁
        await tx.run(async (handle) => {
          for (const key of keys) {
            await timers.arm(handle, { kind, subject, key, fireAt: new Date(T0) });
          }
        }, ROOMY);

        const ready = barrier(CONNECTIONS);
        const work = Array.from({ length: CONNECTIONS }, (_, index) =>
          tx.run(async (handle) => {
            bodies += 1; // 死锁、锁等待超时会让 tx.run 把函数体再跑一遍：数得出来
            await handle.$queryRawUnsafe("SELECT 1");
            await ready();
            if (index % 2 === 0) {
              const key = keys[(index / 2) % keys.length]!;
              await timers.arm(handle, { kind, subject, key, fireAt: new Date(T0 + index) });
            } else {
              await timers.cancel(handle, { subject });
            }
          }, ROOMY),
        );
        transactions += work.length;
        const settled = await Promise.allSettled(work);
        expect(settled.filter((item) => item.status === "rejected")).toEqual([]);
        for (const key of keys) expect(await liveCount(prisma, key)).toBeLessThanOrEqual(1);
      }
      expect(bodies).toBe(transactions);
    },
    SLOW,
  );
});
