import type { PrismaClient } from "@liyoxi/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createTxRunner, uuidv7 } from "../kernel/index.js";
import {
  createSampleEvents,
  SAMPLE_SUBSCRIBERS,
  sampleSystemContext,
  useTestDatabase,
} from "../testing/index.js";
import type { SampleEvents } from "../testing/index.js";
import { openClient, SLOW } from "./__fixtures__/db.js";
import { EXPAND_BATCH_SIZE } from "./expand.js";

// 验收第 5 条：一个事件按订阅者各展开一行投递；再跑一次行数不变；没有订阅者的事件 0 行投递且 published_at 非空。
// 另：按 seq 从老到新、分批；已有的投递行不动；别的事务正锁着的事件跳过不等；在调用方的事务里展开随它回滚。

const db = useTestDatabase("services");
let prisma: PrismaClient;
let other: PrismaClient;
let sample: SampleEvents;

beforeAll(async () => {
  prisma = await db.prisma();
  other = await openClient(db);
  sample = createSampleEvents(prisma);
}, SLOW);

afterAll(async () => {
  await other?.$disconnect();
});

const system = sampleSystemContext();
const emitPlaced = async (): Promise<string> => {
  const dramaOrderId = uuidv7();
  const result = await sample.tx.run((tx) =>
    sample.events.emit(tx, system, {
      type: "lyxtest.order.placed",
      aggregate: { type: "drama_order", id: dramaOrderId },
      payload: { v: 1, dramaOrderId },
    }),
  );
  return result.id as string;
};
const emitPinged = async (): Promise<string> => {
  const result = await sample.tx.run((tx) =>
    sample.events.emit(tx, system, { type: "lyxtest.pinged", payload: { v: 1, n: 1 } }),
  );
  return result.id as string;
};
const deliveriesOf = (outboxEventId: string) =>
  prisma.outboxDelivery.findMany({ where: { outboxEventId }, orderBy: { subscriber: "asc" } });
const publishedAt = async (id: string): Promise<Date | null> =>
  (await prisma.outboxEvent.findUniqueOrThrow({ where: { id } })).publishedAt;
/** 把库里还没展开的都展开掉：每条用例从“没有待展开的事件”开始 */
const drain = async (): Promise<void> => {
  while ((await sample.events.expand()).events > 0);
};

beforeEach(drain, SLOW);

describe("展开：一个事件按订阅者各一行投递（验收 5）", () => {
  it("有 3 个订阅者的事件：恰 3 行 pending，published_at 非空；再跑一次行数不变", async () => {
    const eventId = await emitPlaced();
    expect(await publishedAt(eventId)).toBeNull();

    expect(await sample.events.expand()).toEqual({ events: 1, deliveries: 3 });
    const rows = await deliveriesOf(eventId);
    expect(rows.map((row) => row.subscriber)).toEqual([...SAMPLE_SUBSCRIBERS]);
    for (const row of rows) {
      expect(row).toMatchObject({
        status: "pending",
        attempts: 0,
        dispatchNo: 0,
        isEnqueued: false,
        leaseUntil: null,
        consumedAt: null,
      });
    }
    const published = await publishedAt(eventId);
    expect(published).toBeInstanceOf(Date);

    expect(await sample.events.expand()).toEqual({ events: 0, deliveries: 0 });
    expect(await deliveriesOf(eventId)).toHaveLength(3);
    expect(await publishedAt(eventId)).toEqual(published);
    // 展开只建投递行，不调处理器：消费在 W0-23
    expect(sample.handled).toEqual([]);
  });

  it("没有订阅者的事件：0 行投递，published_at 同样写上", async () => {
    const eventId = await emitPinged();
    expect(await sample.events.expand()).toEqual({ events: 1, deliveries: 0 });
    expect(await deliveriesOf(eventId)).toEqual([]);
    expect(await publishedAt(eventId)).toBeInstanceOf(Date);
  });

  it("契约里有订阅者、当前装配里还没有处理器的事件：不建投递行", async () => {
    // calendar.imported 在契约里有 8 个订阅者（x01 第 3.1 节），处理器要到各域落地才登记
    const { id } = await sample.tx.run((tx) =>
      sample.events.emit(tx, system, {
        type: "calendar.imported",
        payload: { v: 1, calendarVersion: 1, year: 2027, changedDays: ["2027-01-01"] },
      }),
    );
    expect(sample.events.subscribers.forEvent("calendar.imported")).toEqual([]);
    expect(await sample.events.expand()).toEqual({ events: 1, deliveries: 0 });
    expect(await deliveriesOf(id as string)).toEqual([]);
  });

  it("按 seq 从老到新、按批量分批", async () => {
    const ids = [await emitPlaced(), await emitPinged(), await emitPlaced()];
    expect(await sample.events.expand(2)).toEqual({ events: 2, deliveries: 3 });
    expect(await Promise.all(ids.map(publishedAt))).toEqual([
      expect.any(Date),
      expect.any(Date),
      null,
    ]);
    expect(await sample.events.expand(2)).toEqual({ events: 1, deliveries: 3 });
  });

  it("批量只收 1 到上限的整数", async () => {
    for (const limit of [0, -1, 1.5, EXPAND_BATCH_SIZE + 1]) {
      await expect(sample.events.expand(limit)).rejects.toThrow(RangeError);
    }
  });

  it("已有的投递行不动（ON CONFLICT DO NOTHING），只补缺的", async () => {
    const eventId = await emitPlaced();
    const [first] = SAMPLE_SUBSCRIBERS;
    await prisma.outboxDelivery.create({
      data: { outboxEventId: eventId, subscriber: first, status: "retry", attempts: 3 },
    });
    expect(await sample.events.expand()).toEqual({ events: 1, deliveries: 2 });
    const rows = await deliveriesOf(eventId);
    expect(rows.map((row) => [row.subscriber, row.status, row.attempts])).toEqual([
      [SAMPLE_SUBSCRIBERS[0], "retry", 3],
      [SAMPLE_SUBSCRIBERS[1], "pending", 0],
      [SAMPLE_SUBSCRIBERS[2], "pending", 0],
    ]);
  });

  it("在调用方的事务里展开：事务回滚，投递行与 published_at 都没有", async () => {
    const eventId = await emitPlaced();
    await expect(
      sample.tx.run(async (tx) => {
        expect(await sample.events.expandPending(tx)).toEqual({ events: 1, deliveries: 3 });
        throw new Error("回滚");
      }),
    ).rejects.toThrow("回滚");
    expect(await deliveriesOf(eventId)).toEqual([]);
    expect(await publishedAt(eventId)).toBeNull();
  });

  it(
    "别的事务正锁着的事件跳过、不等它（SKIP LOCKED）；它放手后下一轮补上",
    async () => {
      const held = await emitPlaced();
      const free = await emitPlaced();
      let release!: () => void;
      const released = new Promise<void>((resolve) => (release = resolve));
      let locked!: () => void;
      const lockedOne = new Promise<void>((resolve) => (locked = resolve));
      // 另一条连接扮“另一个中继实例”：先拿到最老的一条，占着不放
      const holding = createTxRunner({ prisma: other, appEnv: "test" }).run(
        async (tx) => {
          const got = await sample.events.expandPending(tx, 1);
          locked();
          await released;
          return got;
        },
        { timeoutMs: 60_000 },
      );
      await lockedOne;
      // 这一边不等：只拿到没被锁的那一条
      expect(await sample.events.expand()).toEqual({ events: 1, deliveries: 3 });
      expect(await publishedAt(free)).toBeInstanceOf(Date);
      expect(await publishedAt(held)).toBeNull();
      release();
      expect(await holding).toEqual({ events: 1, deliveries: 3 });
      expect(await publishedAt(held)).toBeInstanceOf(Date);
      expect(await deliveriesOf(held)).toHaveLength(3);
      expect(await deliveriesOf(free)).toHaveLength(3);
    },
    SLOW,
  );
});
