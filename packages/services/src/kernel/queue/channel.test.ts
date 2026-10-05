import type { PrismaClient } from "@liyoxi/db";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { createRedisOutage, useTestDatabase, useTestRedis } from "../../testing/index.js";
import { createTxRunner, KernelViolation } from "../tx.js";
import { createQueueChannel } from "./channel.js";
import type { QueueChannel } from "./channel.js";

// 队列封装（W0-23）：入队与消费、同名任务只进一次、Redis 不可用时入队立刻报错并记下不可用时长、
// 事务内入队即违规。连的是测试支架发的 Redis 前缀；“不可用”在客户端一侧造。

const SLOW = 120_000;
const PATIENCE_MS = 60_000;
const redis = useTestRedis();
const db = useTestDatabase("services");
let prisma: PrismaClient;
const opened: QueueChannel[] = [];

beforeAll(async () => {
  // 先清一遍本前缀，支架从这一刻起接管它（文件跑完再清一遍）：通道只拿前缀自己建连接，
  // 不调这一下的话键会留在共享的 Redis 上，下一轮同名的任务号会被上一轮留下的任务吞掉
  await redis.flush();
  prisma = await db.prisma();
}, SLOW);
afterEach(async () => {
  await Promise.all(opened.splice(0).map((channel) => channel.close()));
}, SLOW);

async function until(what: string, check: () => boolean | Promise<boolean>): Promise<void> {
  const deadline = Date.now() + PATIENCE_MS;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`等了 ${PATIENCE_MS} 毫秒也没等到：${what}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
async function open(options: { redisUrl?: string; monotonic?: () => number } = {}) {
  const channel = createQueueChannel({
    redisUrl: options.redisUrl ?? (process.env.REDIS_URL as string),
    prefix: `${redis.prefix}bull`,
    monotonic: options.monotonic,
  });
  opened.push(channel);
  await until("入队连接就绪", () => channel.ping());
  return channel;
}

describe("队列封装", () => {
  it(
    "入队的任务送到消费者；同一个任务号只进一次；暂停之后再开始照常领",
    async () => {
      const channel = await open();
      const seen: unknown[] = [];
      const consumer = channel.consume<{ n: number }>("outbox_delivery", 2, async (data) => {
        seen.push(data);
      });
      await channel.enqueue("outbox_delivery", "evt-1-lyxtest.onA-1", { n: 1 });
      await channel.enqueue("outbox_delivery", "evt-1-lyxtest.onA-1", { n: 99 });
      await channel.enqueue("outbox_delivery", "evt-1-lyxtest.onA-2", { n: 2 });
      consumer.start();
      await until("两条任务送达", () => seen.length >= 2);
      expect(seen).toEqual(expect.arrayContaining([{ n: 1 }, { n: 2 }]));
      expect(seen).toHaveLength(2);

      await consumer.pause();
      consumer.start();
      await channel.enqueue("outbox_delivery", "evt-1-lyxtest.onA-3", { n: 3 });
      await until("恢复后又送达一条", () => seen.length >= 3);
      expect(channel.downForMs()).toBe(0);
    },
    SLOW,
  );

  it(
    "Redis 不可用：入队立刻报错、不排队等，不可用时长从第一次发现起算；恢复后归零",
    async () => {
      const outage = await createRedisOutage();
      try {
        let now = 0;
        const channel = await open({ redisUrl: outage.url, monotonic: () => now });
        await outage.down();
        await until("发现连接断开", async () => !(await channel.ping()));
        const startedAt = Date.now();
        await expect(channel.enqueue("timer_run", "tmr-1-1", {})).rejects.toThrow();
        // 快速失败：远小于入队的总时限。这里只要求“没有一直等”，不卡具体的毫秒数
        expect(Date.now() - startedAt).toBeLessThan(PATIENCE_MS / 2);
        now += 42_000;
        expect(channel.downForMs()).toBe(42_000);

        await outage.up();
        await until("连接恢复", () => channel.ping());
        expect(channel.downForMs()).toBe(0);
        await channel.enqueue("timer_run", "tmr-1-2", {});
      } finally {
        await outage.close();
      }
    },
    SLOW,
  );

  it(
    "事务内入队即违规：入队要放在提交之后",
    async () => {
      const channel = await open();
      const tx = createTxRunner({ prisma, appEnv: "test" });
      await expect(
        tx.run(() => channel.enqueue("timer_run", "tmr-2-1", {})),
      ).rejects.toBeInstanceOf(KernelViolation);
    },
    SLOW,
  );
});
