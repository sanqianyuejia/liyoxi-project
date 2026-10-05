// 进程运行时（W0-22）：api 与 worker 启动时各建一次。环境 → 日志 → 数据库与 Redis 连接 → 事务入口、业务单号、
// 配置读侧、健康检查 → 服务装配。应用层只经 @liyoxi/services 的入口拿到它，不引 @liyoxi/db（硬性规则 5）。
// 依据：D7 第 2.3 节规则 7、第 8.3 节“应用侧的数据库会话设置与连接池”、第 9.1 节；h01 第 3.12 节；
// docs/plan/tasks/README.md 第 5 节移交表第 1、2 行。
//
// 为什么是包级文件、不放 kernel/context.ts：kernel 的入口被全部模块引用，放进去每个用例都要加载数据库客户端；
// 它还要引 config、ops 的入口，会成环。包级文件不属于任何一层，只引各模块的 index.ts（与组合根 assembly.ts 同）。
//
// 数据库客户端与 Redis 连接不在返回值里：应用层用不到，也不该拿到。以后各域的服务（buildXxx(deps)）在这里装配，
// 经返回值给出用例函数。Provider 的装配没有接：驱动的入口只许 kernel 引（D7 第 2.2 节 D8），落点由 W0-20 定。
import { createPrismaClient } from "@liyoxi/db";
import { Redis } from "ioredis";

import { assembleServices } from "./assembly.js";
import { createConfig } from "./config/index.js";
import type { Config } from "./config/index.js";
import { createBizNoIssuer, createTxRunner, systemClock } from "./kernel/index.js";
import type {
  Assembly,
  AssemblyEntry,
  BizNoIssuer,
  Clock,
  Env,
  KernelViolation,
  TxRunner,
} from "./kernel/index.js";
import { createLogger } from "./logger.js";
import type { Logger } from "./logger.js";
import { createHealth } from "./ops/index.js";
import type { Health } from "./ops/index.js";

/** 一个连接池的参数：连接数上限与三个会话超时（毫秒） */
export interface DbPoolSettings {
  readonly max: number;
  readonly statementTimeoutMs?: number;
  readonly lockTimeoutMs?: number;
  readonly idleInTransactionSessionTimeoutMs?: number;
}

/**
 * 两个进程的主池，照 D7 第 8.3 节的表。读侧池（api 3 个连接、worker 3 个连接）与 worker 的租约连接
 * 等第一个用到它们的包再建。
 */
export const DB_POOLS: Readonly<Record<AssemblyEntry, DbPoolSettings>> = {
  api: {
    max: 10,
    statementTimeoutMs: 8_000,
    lockTimeoutMs: 3_000,
    idleInTransactionSessionTimeoutMs: 15_000,
  },
  worker: {
    max: 10,
    statementTimeoutMs: 30_000,
    lockTimeoutMs: 3_000,
    idleInTransactionSessionTimeoutMs: 60_000,
  },
};

/** 启动自检的一项：返回问题清单，空数组即通过。抛错也算不过 */
export interface StartupCheck {
  readonly name: string;
  run(): Promise<readonly string[]>;
}

/** 启动自检没过：进程起不来。issues 里是全部问题 */
export class StartupCheckError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`启动自检没过，共 ${issues.length} 处：\n- ${issues.join("\n- ")}`);
    this.name = "StartupCheckError";
    this.issues = issues;
  }
}

export interface RuntimeOptions {
  /** 哪个进程 */
  readonly entry: AssemblyEntry;
  /** loadEnv 的结果 */
  readonly env: Env;
  /** 镜像标签：构建时写进产物；本地与用例里是 dev */
  readonly version: string;
  /** 不给即系统时钟；用例里传可拨时钟 */
  readonly clock?: Clock;
  /** 不给即按 env.LOG_LEVEL 建一个写标准输出的；用例里传收集用的 */
  readonly logger?: Logger;
  /** Redis 键的前缀，缺省 lyx:<环境>:（D7 第 2.5 节）；用例里传测试支架给的前缀 */
  readonly redisKeyPrefix?: string;
  /** /health 的缓存时长；用例里给 0 */
  readonly healthCacheMs?: number;
}

export interface Runtime {
  readonly entry: AssemblyEntry;
  readonly env: Env;
  readonly version: string;
  readonly logger: Logger;
  readonly clock: Clock;
  /** 开事务的唯一入口 */
  readonly tx: TxRunner;
  readonly bizNo: BizNoIssuer;
  readonly config: Config;
  readonly health: Health;
  /** 各模块的登记汇成的装配结果 */
  readonly assembly: Assembly;
  /** 内核断言在 stg、prod 下的上报出口（local、test 下它们直接抛错）；防漏用断言也用它 */
  report(violation: KernelViolation): void;
  /** 启动自检的清单：由 runStartupChecks 逐项跑 */
  readonly startupChecks: readonly StartupCheck[];
  /** 断开数据库与 Redis。进程退出前调一次 */
  close(): Promise<void>;
}

/**
 * 建进程运行时。不连网也不等连接：数据库与 Redis 都是用到时才连，Redis 连不上不影响启动。
 * 会抛的两种：参数缺定义（ParamDefsError）、模块登记有重名或缺实现（AssemblyError）。
 */
export function createRuntime(options: RuntimeOptions): Runtime {
  const { entry, env, version } = options;
  const clock = options.clock ?? systemClock;
  const logger =
    options.logger ?? createLogger({ svc: entry, env: env.APP_ENV, level: env.LOG_LEVEL, version });

  const prisma = createPrismaClient({ connectionString: env.DATABASE_URL, ...DB_POOLS[entry] });

  const keyPrefix = options.redisKeyPrefix ?? `lyx:${env.APP_ENV}:`;
  // 一条命令只等一次重连：Redis 不可用时调用方很快拿到错误，各自降级（01 第 7.3 节）
  const redis = new Redis(env.REDIS_URL, { keyPrefix, maxRetriesPerRequest: 1 });
  let redisDown = false;
  redis.on("error", (error: Error) => {
    // ioredis 每次重连失败都发一次 error：只在由通转断时记一条
    if (!redisDown) logger.warn({ evt: "redis.down", err: error }, "Redis 连接出错，正在重连");
    redisDown = true;
  });
  redis.on("ready", () => {
    if (redisDown) logger.info({ evt: "redis.up" }, "Redis 连接已恢复");
    redisDown = false;
  });

  const report = (violation: KernelViolation): void => {
    logger.error({ evt: "kernel.violation", err: violation }, violation.message);
  };
  const tx = createTxRunner({ prisma, appEnv: env.APP_ENV, report });
  const config = createConfig({
    db: prisma,
    clock,
    redis,
    report: (problem) => {
      logger.error(
        { evt: "config.problem", kind: problem.kind, subject: problem.subject },
        problem.detail,
      );
    },
  });
  const health = createHealth({
    db: prisma,
    redis,
    clock,
    version,
    ...(options.healthCacheMs === undefined ? {} : { cacheMs: options.healthCacheMs }),
  });
  const assembly = assembleServices({ entry, appEnv: env.APP_ENV });

  const startupChecks: StartupCheck[] = [
    {
      // 启动阶段要求成功连上一次数据库；之后就绪与否不再看库（h01 第 3.12 节）
      name: "db.connect",
      async run() {
        await prisma.$queryRaw`SELECT 1`;
        return [];
      },
    },
    // 移交表第 1 行的四个自检（security 的加解密与盲索引、审计 target_type 对表名单、聚合类型对表名单、
    // machine 与 state_field 对库里的表与列）：各自的包合并后在这里各加一项
  ];

  return {
    entry,
    env,
    version,
    logger,
    clock,
    tx,
    bizNo: createBizNoIssuer({ clock, appEnv: env.APP_ENV }),
    config,
    health,
    assembly,
    report,
    startupChecks,
    async close() {
      redis.disconnect();
      await prisma.$disconnect();
    },
  };
}

/** 逐项跑启动自检，问题一次报全：有一项不过即抛 StartupCheckError */
export async function runStartupChecks(checks: readonly StartupCheck[]): Promise<void> {
  const issues: string[] = [];
  for (const check of checks) {
    try {
      for (const problem of await check.run()) issues.push(`${check.name}：${problem}`);
    } catch (error) {
      // 只带错误的名字与消息里的第一行：连接失败的报错里可能有主机名，不带连接串
      const reason = error instanceof Error ? (error.message.split("\n")[0] ?? error.name) : "出错";
      issues.push(`${check.name}：${reason}`);
    }
  }
  if (issues.length > 0) throw new StartupCheckError(issues);
}
