// 只读实际队列；不认领/清理/恢复任务，不给尚未运行的未来消费者伪造统计。
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import type { AlertInput, Clock } from "../kernel/index.js";
import { assertNotInTransaction } from "../kernel/index.js";
import type { ProbeRule } from "./probe-rules.js";
export const ACTIVE_PROBE_QUEUES = { outbox_delivery: 500, timer_run: 200, promote: 100 } as const;
export function createQueueProbes(options: {
  redisUrl: string;
  prefix: string;
  clock: Clock;
  thresholds?: Readonly<Record<string, { p2: number; p1?: number }>>;
}) {
  const connection = new Redis(options.redisUrl, {
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    commandTimeout: 500,
    connectTimeout: 1_000,
  });
  connection.on("error", () => {});
  const queues = Object.entries(ACTIVE_PROBE_QUEUES).map(([name, limit]) => ({
    name,
    limit,
    queue: new Queue(name, { connection, prefix: options.prefix }),
  }));
  const pausedAt = new Map<string, number>();
  const rules: ProbeRule[] = queues.map(({ name, limit, queue }) => ({
    key: `queue.${name}`,
    fingerprints: [{ rule: "queue.backlog", dimension: name }],
    async sample() {
      assertNotInTransaction("ops.queueProbe");
      const client = connection;
      const [counts, oldest, paused, pausedIds, pausedCount, failedJobs, events] =
        await Promise.all([
          queue.getJobCounts("waiting", "active", "failed"),
          queue.getWaiting(0, 0),
          queue.isPaused(),
          client.lrange(queue.toKey("paused"), -1, -1),
          client.llen(queue.toKey("paused")),
          queue.getFailed(0, 1999),
          client.xrevrange(queue.toKey("events"), "+", "-", "COUNT", 2000),
        ]);
      const firstPaused = pausedIds[0] === undefined ? undefined : await queue.getJob(pausedIds[0]);
      const first = [oldest[0], firstPaused]
        .filter((job) => job !== undefined)
        .sort((a, b) => a.timestamp - b.timestamp)[0];
      const now = options.clock.now().getTime();
      const pauseEvent = events.find(([, fields]) =>
        fields.some((field, index) => field === "event" && fields[index + 1] === "paused"),
      );
      const pauseTime = pauseEvent === undefined ? undefined : Number(pauseEvent[0].split("-")[0]);
      if (paused && !pausedAt.has(name))
        pausedAt.set(name, Number.isFinite(pauseTime) ? pauseTime! : now);
      else if (!paused) pausedAt.delete(name);
      return {
        waiting: (counts["waiting"] ?? 0) + pausedCount,
        active: counts["active"] ?? 0,
        failed: counts["failed"] ?? 0,
        failedRecent: failedJobs.filter(
          (job) => job.finishedOn !== undefined && job.finishedOn >= now - 600_000,
        ).length,
        failedRecentTruncated:
          (counts["failed"] ?? 0) > 2000 &&
          failedJobs.every(
            (job) => job.finishedOn !== undefined && job.finishedOn >= now - 600_000,
          ),
        pausedSinceSource: paused
          ? pauseEvent === undefined
            ? "observed"
            : "queue_event"
          : "none",
        ageSec: first === undefined ? 0 : Math.max(0, (now - first.timestamp) / 1000),
        pausedForSec: paused ? Math.max(0, (now - pausedAt.get(name)!) / 1000) : 0,
      };
    },
    evaluate(value): readonly AlertInput[] {
      const threshold = options.thresholds?.[`queue.${name}`];
      return Number(value["waiting"]) > (threshold?.p2 ?? limit) ||
        Number(value["ageSec"]) > 300 ||
        Number(value["pausedForSec"]) > 600
        ? [
            {
              rule: "queue.backlog",
              dimension: name,
              severity:
                threshold?.p1 !== undefined && Number(value["waiting"]) > threshold.p1
                  ? "P1"
                  : "P2",
              detail: value,
            },
          ]
        : [];
    },
  }));
  rules.push({
    key: "redis",
    fingerprints: [{ rule: "redis.unavailable" }],
    async sample() {
      assertNotInTransaction("ops.redisProbe");
      try {
        return { available: (await connection.ping()) === "PONG" };
      } catch {
        return { available: false };
      }
    },
    evaluate: (value) =>
      value["available"] === true
        ? []
        : [{ rule: "redis.unavailable", severity: "P1", detail: { available: false } }],
  });
  return {
    rules,
    close: async () => {
      await Promise.allSettled(queues.map((item) => item.queue.close()));
      connection.disconnect();
    },
  };
}
