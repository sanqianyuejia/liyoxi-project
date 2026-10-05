/**
 * M0 的演示（W0-30）：一条命令把样例链路走一遍，逐步打印做了什么、库里多了什么。根脚本：pnpm demo:m0。
 *
 * 用法（在仓库根目录；要本地的 PostgreSQL 与 Redis 在运行，连接参数见 CLAUDE.md 第 9 节）：
 *   APP_ENV=test DATABASE_URL=… REDIS_URL=… pnpm demo:m0
 *   … pnpm demo:m0 --keep     跑完不删演示库（想连上去看行时用；之后用 pnpm test:db:prune --all 清，或自己删）
 *
 * 做什么：建演示库 lyx_test_demo_m0_<进程号>（lyx_ 开头，也过测试库的守卫）→ 跑全部迁移 → 播种并核对种子断言
 * → 走样例链路（../src/testing/m0-chain.ts 的 runM0Chain，与用例 m0-chain.db.test.ts 是同一个函数）
 * → 打印演示的核对结果与四个计数 → 删掉演示库与自己在 Redis 里的键。可以反复跑，每次都是新库。
 * 只动自己建的库与自己前缀下的键；主机与账号取 DATABASE_URL，库名换成上面那个。连接串与口令不打印。
 * 退出码：0 走通且各步与预期相符；1 有一步不符；2 环境变量缺、库或 Redis 连不上。
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { createPrismaClient } from "@liyoxi/db";
import { dropTestDatabase, testDatabaseUrl } from "@liyoxi/db/testing/standalone";
import { Redis } from "ioredis";

import { createSeededDatabase } from "../src/testing/data/seeded-db.js";
import { M0ChainError, runM0Chain } from "../src/testing/m0-chain.js";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

const line = (text = ""): void => void process.stdout.write(`${text}\n`);

/** 清掉本次演示在 Redis 里的键：只用 SCAN 加 UNLINK，只删自己前缀下的 */
async function flushPrefix(redisUrl: string, prefix: string): Promise<number> {
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
  try {
    let cursor = "0";
    let removed = 0;
    do {
      const [next, keys] = await redis.scan(cursor, "MATCH", `${prefix}*`, "COUNT", 500);
      cursor = next;
      const own = keys.filter((key) => key.startsWith(prefix));
      if (own.length > 0) removed += await redis.unlink(...own);
    } while (cursor !== "0");
    return removed;
  } finally {
    redis.disconnect();
  }
}

async function main(): Promise<number> {
  const { values } = parseArgs({ options: { keep: { type: "boolean", default: false } } });
  const redisUrl = process.env.REDIS_URL;
  if (!process.env.DATABASE_URL || !redisUrl) {
    console.error(
      "demo:m0：要给 DATABASE_URL 与 REDIS_URL（本地的取值见 CLAUDE.md 第 9 节；依赖没起先跑 pnpm infra:up）",
    );
    return 2;
  }
  const name = `lyx_test_demo_m0_${process.pid}`;
  // 形状同测试支架的前缀 lyx:test:<会话标识>:<worker 编号>:，与别的会话、本地开发的键不相干
  const redisPrefix = `lyx:test:demo${process.pid % 100_000_000}:0:`;

  line("狸有戏 · M0 演示：样例链路重放");
  line();
  line(`准备：建演示库 ${name}，跑全部迁移并播种……`);
  let seeded;
  try {
    seeded = await createSeededDatabase(name);
  } catch (error) {
    // 只打印错误的类型与说明：连接串可能出现在驱动的报错对象里
    console.error(
      `demo:m0 没建成演示库：${error instanceof Error ? `${error.name}: ${error.message.split("\n")[0]}` : "出错"}`,
    );
    return 2;
  }
  line(`      迁移已跑完；种子新增 ${seeded.report.inserted} 行，种子断言 0 条违规`);
  line();

  const prisma = createPrismaClient({ connectionString: testDatabaseUrl(name), max: 5 });
  let code = 0;
  try {
    const report = await runM0Chain({
      prisma,
      redisUrl,
      redisPrefix,
      say(title, lines) {
        line(title);
        for (const detail of lines) line(`      ${detail}`);
        line();
      },
    });
    line("演示核对（计划 第 6.3 节“退出：演示”）");
    line(`  ✓ 写请求重放返回同一结果（用例函数体只执行了 ${report.executions} 次）`);
    line(
      `  ✓ 状态历史 ${report.rows.history} 条、审计 ${report.rows.audit} 条、出站事件 ${report.rows.events} 条`,
    );
    line(`  ✓ 订阅者执行 ${report.runs.subscriber} 次、定时器执行 ${report.runs.timer} 次`);
    line(
      `  ✓ 全量不变量 ${report.invariants.checksRun} 个检查项，违规 ${report.invariants.violationsFound} 条`,
    );
    line();
  } catch (error) {
    code = error instanceof M0ChainError ? 1 : 2;
    console.error(
      error instanceof M0ChainError
        ? error.message
        : `demo:m0 中途出错：${error instanceof Error ? `${error.name}: ${error.message.split("\n")[0]}` : "出错"}`,
    );
  } finally {
    await prisma.$disconnect();
    const removed = await flushPrefix(redisUrl, redisPrefix).catch(() => -1);
    if (values.keep) {
      line(`收尾：演示库 ${name} 留着没删（--keep）；Redis 里本次的键已清（${removed} 个）`);
    } else {
      await dropTestDatabase(name);
      line(`收尾：演示库 ${name} 已删；Redis 里本次的键已清（${removed} 个）`);
    }
    line();
  }
  if (code !== 0) return code;

  // 四个计数：仓库里现在的数，与演示库无关（脚本的口径见 infra/ci/four-counts.mjs 开头的注释）
  const counts = spawnSync(process.execPath, ["infra/ci/four-counts.mjs"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  process.stdout.write(counts.stdout);
  if (counts.status !== 0) {
    process.stderr.write(counts.stderr);
    return 1;
  }
  return 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(
      `demo:m0 失败：${error instanceof Error ? `${error.name}: ${error.message.split("\n")[0]}` : "出错"}`,
    );
    process.exitCode = 2;
  },
);
