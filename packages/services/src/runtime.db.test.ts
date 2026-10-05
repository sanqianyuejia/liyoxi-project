// 进程运行时的连库用例（任务书 W0-22 第 7 节第 7 条；移交表第 1、2 行）。
// 走测试支架：连接串换成本文件的测试库，Redis 用测试支架给的前缀。
import { describe, expect, it } from "vitest";

import { loadEnv } from "./kernel/index.js";
import type { Env } from "./kernel/index.js";
import { createLogger } from "./logger.js";
import { createRuntime, DB_POOLS, runStartupChecks, StartupCheckError } from "./runtime.js";
import type { RuntimeOptions } from "./runtime.js";
import { useTestDatabase, useTestRedis } from "./testing/index.js";

const db = useTestDatabase("services");
const redis = useTestRedis();
const TIMEOUT = { timeout: 60_000 };

async function start(overrides: Partial<Env> = {}, options: Partial<RuntimeOptions> = {}) {
  const lines: Record<string, unknown>[] = [];
  const env: Env = { ...loadEnv(), DATABASE_URL: await db.url(), ...overrides };
  const runtime = createRuntime({
    entry: "api",
    env,
    version: "sha-test",
    redisKeyPrefix: redis.prefix,
    healthCacheMs: 0,
    logger: createLogger({
      svc: "api",
      env: env.APP_ENV,
      level: "debug",
      version: "sha-test",
      destination: { write: (text: string) => void lines.push(JSON.parse(text)) },
    }),
    ...options,
  });
  return { runtime, lines };
}

describe("createRuntime", () => {
  it("api 主池的三个会话超时照 D7 第 8.3 节的表下发到连接上", TIMEOUT, async () => {
    const { runtime } = await start();
    try {
      const [row] = await runtime.tx.run(
        (tx) =>
          tx.$queryRaw<{ statement: string; lock: string; idle: string }[]>`
          SELECT current_setting('statement_timeout') AS statement,
                 current_setting('lock_timeout') AS lock,
                 current_setting('idle_in_transaction_session_timeout') AS idle`,
      );
      expect(row).toEqual({ statement: "8s", lock: "3s", idle: "15s" });
      expect(DB_POOLS.api).toEqual({
        max: 10,
        statementTimeoutMs: 8_000,
        lockTimeoutMs: 3_000,
        idleInTransactionSessionTimeoutMs: 15_000,
      });
    } finally {
      await runtime.close();
    }
  });

  it("启动自检通过；配置读侧、健康检查、装配都已就位", TIMEOUT, async () => {
    const { runtime } = await start();
    try {
      await expect(runStartupChecks(runtime.startupChecks)).resolves.toBeUndefined();
      expect(runtime.startupChecks.map((check) => check.name)).toContain("db.connect");
      expect(runtime.assembly.entry).toBe("api");
      expect(await runtime.config.params.get("work.start")).toBe("09:00");
      expect(await runtime.health.summary()).toMatchObject({ db: "ok", redis: "ok" });
    } finally {
      await runtime.close();
    }
  });

  it("库连不上：建运行时不抛，启动自检失败，报错里不带口令", TIMEOUT, async () => {
    const { runtime } = await start({
      DATABASE_URL: "postgresql://nobody:s3cret-not-real@127.0.0.1:1/lyx_test_unreachable",
    });
    try {
      const failure = await runStartupChecks(runtime.startupChecks).catch(
        (error: unknown) => error,
      );
      expect(failure).toBeInstanceOf(StartupCheckError);
      const { issues, message } = failure as StartupCheckError;
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatch(/^db\.connect：/);
      expect(message).not.toContain("s3cret-not-real");
    } finally {
      await runtime.close();
    }
  });

  it("Redis 连不上：不影响启动，/health 报 redis 为 down，只记一条由通转断", TIMEOUT, async () => {
    const { runtime, lines } = await start({ REDIS_URL: "redis://127.0.0.1:1/0" });
    try {
      await expect(runStartupChecks(runtime.startupChecks)).resolves.toBeUndefined();
      expect(await runtime.health.summary()).toMatchObject({ db: "ok", redis: "down" });
      expect(await runtime.config.params.get("work.start")).toBe("09:00");
      expect(lines.filter((line) => line.evt === "redis.down")).toHaveLength(1);
    } finally {
      await runtime.close();
    }
  });
});

describe("runStartupChecks", () => {
  it("有一项不过即失败，问题一次列全；抛错的项只带消息的第一行", async () => {
    const failure = await runStartupChecks([
      { name: "ok", run: async () => [] },
      { name: "audit.target_type", run: async () => ["库里没有表 foo", "库里没有表 bar"] },
      {
        name: "security.crypto",
        run: async () => {
          throw new Error("解密结果与原文不一致\n    at 某处");
        },
      },
    ]).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(StartupCheckError);
    expect((failure as StartupCheckError).issues).toEqual([
      "audit.target_type：库里没有表 foo",
      "audit.target_type：库里没有表 bar",
      "security.crypto：解密结果与原文不一致",
    ]);
  });
});
