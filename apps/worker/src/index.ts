// 任务进程入口（W0-23）。启动与关停的骨架借自参考工程 apps/worker/src/index.ts（去掉业务任务与错误监控）。
//   node dist/index.js           起任务进程：装配 → 自检 → 抢租约，谁持有租约谁干活
//   node dist/index.js --check   只做装配与自检（不连 Redis、不抢租约），通过即以 0 退出
// 环境变量只经 loadEnv 读；缺必填项或写错：打印“键名: 原因”（不带任何值）后以 1 退出。
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { parseArgs } from "node:util";

import {
  assembleServices,
  buildWorkerServices,
  bullPrefix,
  connectWorkerDatabase,
  createQueueChannel,
  createWorkerLease,
  EnvError,
  loadEnv,
  setPortLogger,
} from "@liyoxi/services";

import { createLogger } from "./log.js";
import { recurringTable } from "./recurring.js";
import { createWorkerRuntime } from "./runtime.js";

/** 构建时由 build.mjs 写入；没经构建直接跑时是 dev */
declare const __LYX_VERSION__: string | undefined;
const VERSION = typeof __LYX_VERSION__ === "string" ? __LYX_VERSION__ : "dev";

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { check: { type: "boolean", default: false } } });
  const env = loadEnv();
  const logger = createLogger(env.LOG_LEVEL);
  setPortLogger(logger);

  // 装配：登记有重名、缺实现，订阅者、定时器处理器、周期任务与契约对不上，都在这几行抛错
  const assembly = assembleServices({ entry: "worker", appEnv: env.APP_ENV });
  const database = connectWorkerDatabase(env.DATABASE_URL);
  const channel = values.check
    ? undefined
    : createQueueChannel({
        redisUrl: env.REDIS_URL,
        prefix: bullPrefix(env.APP_ENV),
        onError: (source, error) => logger.debug({ source, err: error }, "队列连接报错"),
      });
  const services = buildWorkerServices({
    appEnv: env.APP_ENV,
    prisma: database.prisma,
    assembly,
    channel: channel ?? {
      enqueue: () => Promise.reject(new Error("自检模式不入队")),
      downForMs: () => 0,
    },
    report: (violation) => logger.error({ err: violation }, "内核违规"),
    logger,
    keys: env,
  });
  await services.selfCheck();
  const summary = {
    version: VERSION,
    env: env.APP_ENV,
    modules: assembly.modules.length,
    subscribers: assembly.subscribers.length,
    timerHandlers: assembly.timerHandlers.length,
    recurring: recurringTable(services).map((job) => job.kind),
  };
  if (channel === undefined) {
    logger.info(summary, "装配与自检通过");
    await database.close();
    return;
  }

  const lease = createWorkerLease({
    connectionString: env.DATABASE_URL,
    holder: `${hostname()}:${randomUUID()}`,
    version: VERSION,
  });
  const runtime = createWorkerRuntime({ services, channel, lease, logger });
  let stopping = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, "收到终止信号：停循环、收在途任务、让出租约");
    await runtime.stop();
    await Promise.allSettled([channel.close(), lease.close(), database.close()]);
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
  runtime.start();
  logger.info({ ...summary, holder: lease.holder }, "任务进程已启动，等租约");
}

main().catch((error: unknown) => {
  // EnvError 的 message 只有键名与原因，不带值
  console.error(error instanceof EnvError ? error.message : error);
  process.exit(1);
});
