import type { PrismaClient } from "@liyoxi/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTxRunner, uuidv7 } from "../kernel/index.js";
import type { TxRunner } from "../kernel/index.js";
import { createSampleEvents, SAMPLE_SUBSCRIBERS, useTestDatabase } from "../testing/index.js";
import type { SampleEvents } from "../testing/index.js";
import { barrier, openClient, SLOW } from "./__fixtures__/db.js";

// 验收第 6 条（甲类的并发测试；D7 第 10.3 节 C7“出站中继双跑”在展开这一段的部分）：
// 两条独立连接同时展开 500 个事件，重复 20 次。每个（事件, 订阅者）恰 1 行；没有死锁；全部事件的 published_at 已写。
// 每 5 个事件里 1 个没有订阅者。两边各自循环展开到“没有更多”为止；数函数体跑了几次：死锁、锁等待超时会被 tx.run 重试，
// 函数体的次数多于事务数即说明出过。

const ROUNDS = 20;
const EVENTS_PER_ROUND = 500;
const WITH_SUBSCRIBERS = (EVENTS_PER_ROUND / 5) * 4;

const db = useTestDatabase("services");
let prisma: PrismaClient;
let left: PrismaClient;
let right: PrismaClient;
let sample: SampleEvents;

beforeAll(async () => {
  prisma = await db.prisma();
  [left, right] = await Promise.all([openClient(db), openClient(db)]);
  sample = createSampleEvents(prisma);
}, SLOW);

afterAll(async () => {
  await Promise.all([left, right].map((client) => client?.$disconnect()));
});

/** 一次插入一轮的事件：直接写表，省掉 500 次 emit；request_id 记轮次，核对时按它数 */
async function seed(round: string): Promise<void> {
  const ids = Array.from({ length: EVENTS_PER_ROUND }, () => uuidv7());
  const types = ids.map((_, index) =>
    index % 5 === 0 ? "lyxtest.pinged" : "lyxtest.order.placed",
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO outbox_event (id, event_type, payload, actor_type, request_id, occurred_at)
     SELECT id, type, '{"v":1}'::jsonb, 'system', $3, now()
     FROM unnest($1::uuid[], $2::text[]) AS seeded(id, type)`,
    ids,
    types,
    round,
  );
}

interface Tally {
  transactions: number;
  bodies: number;
  events: number;
  deliveries: number;
}

/** 一个“中继实例”：循环展开，直到一批是空的 */
async function relay(runner: TxRunner, start: () => Promise<void>): Promise<Tally> {
  const tally: Tally = { transactions: 0, bodies: 0, events: 0, deliveries: 0 };
  await start();
  for (;;) {
    tally.transactions += 1;
    const result = await runner.run((tx) => {
      tally.bodies += 1;
      return sample.events.expandPending(tx);
    });
    tally.events += result.events;
    tally.deliveries += result.deliveries;
    if (result.events === 0) return tally;
  }
}

describe("展开双跑（验收 6）", () => {
  it(
    `两条连接同时展开 ${EVENTS_PER_ROUND} 个事件，重复 ${ROUNDS} 次：不重不漏，没有死锁`,
    async () => {
      const runners = [left, right].map((client) =>
        createTxRunner({ prisma: client, appEnv: "test" }),
      );
      const share = [0, 0];
      for (let index = 0; index < ROUNDS; index += 1) {
        const round = `lyxtest-round-${index}`;
        await seed(round);
        const aligned = barrier(2);
        const tallies = await Promise.all(runners.map((runner) => relay(runner, aligned)));

        // 没有重试：函数体的次数等于事务数
        for (const tally of tallies) expect(tally.bodies).toBe(tally.transactions);
        // 每个事件恰被一边展开一次；投递行恰是“有订阅者的事件数 × 订阅者数”
        expect(tallies[0]!.events + tallies[1]!.events).toBe(EVENTS_PER_ROUND);
        expect(tallies[0]!.deliveries + tallies[1]!.deliveries).toBe(
          WITH_SUBSCRIBERS * SAMPLE_SUBSCRIBERS.length,
        );
        share[0]! += tallies[0]!.events;
        share[1]! += tallies[1]!.events;

        const inRound = { outboxEvent: { requestId: round } };
        expect(
          await prisma.outboxEvent.count({ where: { requestId: round, publishedAt: null } }),
        ).toBe(0);
        expect(await prisma.outboxDelivery.count({ where: inRound })).toBe(
          WITH_SUBSCRIBERS * SAMPLE_SUBSCRIBERS.length,
        );
        expect(
          await prisma.outboxDelivery.count({ where: { ...inRound, status: "pending" } }),
        ).toBe(WITH_SUBSCRIBERS * SAMPLE_SUBSCRIBERS.length);
        // 每个有订阅者的事件恰 3 行、每个订阅者各 1 行；没有订阅者的事件 0 行
        const perEvent = await prisma.outboxDelivery.groupBy({
          by: ["outboxEventId"],
          where: inRound,
          _count: { subscriber: true },
        });
        expect(perEvent).toHaveLength(WITH_SUBSCRIBERS);
        expect(
          perEvent.every((group) => group._count.subscriber === SAMPLE_SUBSCRIBERS.length),
        ).toBe(true);
        const perSubscriber = await prisma.outboxDelivery.groupBy({
          by: ["subscriber"],
          where: inRound,
          _count: { outboxEventId: true },
        });
        expect(
          Object.fromEntries(
            perSubscriber.map((group) => [group.subscriber, group._count.outboxEventId]),
          ),
        ).toEqual(Object.fromEntries(SAMPLE_SUBSCRIBERS.map((name) => [name, WITH_SUBSCRIBERS])));
      }
      process.stdout.write(
        `展开双跑：${ROUNDS} 轮 × ${EVENTS_PER_ROUND} 个事件，两条连接各展开 ${share[0]}、${share[1]} 个，没有重试\n`,
      );
      expect(share[0]! + share[1]!).toBe(ROUNDS * EVENTS_PER_ROUND);
    },
    SLOW * 2,
  );
});
