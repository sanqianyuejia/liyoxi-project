// 进程运行时的连库用例（任务书 W0-22 第 7 节第 7 条；移交表第 1、2 行）。
// 走测试支架：连接串换成本文件的测试库，Redis 用测试支架给的前缀。
import { describe, expect, it } from "vitest";

import { createTxRunner, detach, KernelViolation, loadEnv } from "./kernel/index.js";
import type { Env } from "./kernel/index.js";
import { createLogger } from "./logger.js";
import { createRuntime, DB_POOLS, runStartupChecks, StartupCheckError } from "./runtime.js";
import type { RuntimeOptions } from "./runtime.js";
import {
  createFakeProviders,
  createClock,
  fakeKeyEnv,
  SAMPLE_PROVIDER_INPUTS,
  useTestDatabase,
  useTestRedis,
} from "./testing/index.js";

import { bindCalendarCoverage } from "./sla/index.js";
import { armRecurringSlot, claimTimers, runTimer } from "./timers/index.js";
import type { TimerRunDeps } from "./timers/index.js";

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
  it("coverage runtime 实际绑定，close 后恢复此前的公开绑定", TIMEOUT, async () => {
    const clock = createClock(new Date("2035-01-01T02:00:00Z"));
    let previousCalls = 0;
    const unbind = bindCalendarCoverage({
      clock,
      detach,
      alerts: {
        raise: async () => {
          previousCalls++;
        },
      },
    });
    const { runtime } = await start(
      {},
      { entry: "worker", clock, providers: createFakeProviders({ clock }) },
    );
    let closed = false;
    const deps: TimerRunDeps = {
      tx: runtime.tx,
      assembly: runtime.assembly,
      registry: runtime.timers.registry,
      clock,
      alerts: { raise: async () => {} },
    };
    const runSlot = async (at: string, input: TimerRunDeps) => {
      await input.tx.run((tx) => armRecurringSlot(tx, "calendar.coverage_check", new Date(at)));
      const refs = await input.tx.run((tx) => claimTimers(tx, input.registry, clock.now(), 1));
      expect(refs.claimed).toHaveLength(1);
      expect(await runTimer(input, refs.claimed[0]!)).toBe("fired");
      return refs.claimed[0]!;
    };
    try {
      const ref = await runSlot("2026-01-01T02:00:00Z", deps);
      const prisma = await db.prisma();
      expect(await prisma.timer.findUnique({ where: { id: ref.timerId } })).toMatchObject({
        status: "fired",
        result: { alerts: 1 },
      });
      expect(previousCalls).toBe(0);
      await runtime.close();
      closed = true;
      await runSlot("2026-02-01T02:00:00Z", {
        ...deps,
        tx: createTxRunner({ prisma, appEnv: "test" }),
      });
      expect(previousCalls).toBe(1);
    } finally {
      try {
        if (!closed) await runtime.close();
      } finally {
        unbind();
      }
    }
  });

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
      // 连库一项加移交表第 1 行的四个自检（KF-1 接齐）；清单与 worker 的是同一份（ops/startup.ts）
      expect(runtime.startupChecks.map((check) => check.name)).toEqual([
        "db.connect",
        "security.crypto",
        "audit.target_type",
        "events.aggregate_types",
        "flow.state_columns",
        // W1-01a：后台登录的三把密钥，只有 api 进程查
        "security.auth_keys",
      ]);
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

describe("createRuntime：进程装配接齐（KF-1）", () => {
  const sms = SAMPLE_PROVIDER_INPUTS.sms.sendActivationCode;
  const sentIn = (lines: Record<string, unknown>[]) =>
    lines.filter((line) => String(line.msg).includes("员工激活码")).length;

  it("十二个 Provider 已装配并把生效状态打进启动日志；events、timers 已建", TIMEOUT, async () => {
    const { runtime, lines } = await start();
    try {
      expect(Object.keys(runtime.providers)).toHaveLength(12);
      expect(lines.some((line) => line.msg === "providers ready")).toBe(true);
      // 构造 events、timers 时对照契约校验过订阅者、定时器处理器、周期任务的登记
      expect(runtime.events.subscribers).toBeDefined();
      expect(runtime.timers.registry.isJob("lyxtest.no_such_job")).toBe(false);
    } finally {
      await runtime.close();
    }
  });

  it(
    "事务里调 Provider 的方法：抛 KernelViolation，请求发不出去；事务外照常（外呼前钩子在真实装配里接着）",
    TIMEOUT,
    async () => {
      const { runtime, lines } = await start();
      try {
        const failure = await runtime.tx
          .run(async () => {
            await runtime.providers.sms.sendActivationCode(sms);
          })
          .catch((error: unknown) => error);
        expect(failure).toBeInstanceOf(KernelViolation);
        expect(failure).toMatchObject({ kind: "external_call_in_transaction" });
        expect((failure as Error).message).toContain("sms.sendActivationCode");
        expect(sentIn(lines)).toBe(0);

        expect(await runtime.providers.sms.sendActivationCode(sms)).toMatchObject({ ok: true });
        expect(sentIn(lines)).toBe(1);
      } finally {
        await runtime.close();
      }
    },
  );

  it("预发、生产下事务里外呼：上报一条 kernel.violation，调用照常进行", TIMEOUT, async () => {
    const { runtime, lines } = await start({ APP_ENV: "stg" });
    try {
      const result = await runtime.tx.run(() => runtime.providers.sms.sendActivationCode(sms));
      // 预发没配短信：调用照常走到未配置的实现
      expect(result).toMatchObject({ ok: false, reason: "unconfigured" });
      const reported = lines.filter((line) => line.evt === "kernel.violation");
      expect(reported).toHaveLength(1);
      expect(String(reported[0]?.msg)).toContain("sms.sendActivationCode");
    } finally {
      await runtime.close();
    }
  });

  it("用例换成替身：替身缺省也带着同一个钩子", TIMEOUT, async () => {
    const fakes = createFakeProviders();
    const { runtime } = await start({}, { providers: fakes });
    try {
      expect(runtime.providers).toBe(fakes);
      await expect(
        runtime.tx.run(() => runtime.providers.sms.sendActivationCode(sms)),
      ).rejects.toBeInstanceOf(KernelViolation);
      expect(fakes.sms.calls).toHaveLength(0);
      // 专门要它空转的，显式传
      const loose = createFakeProviders({ beforeCall: () => {} });
      await runtime.tx.run(() => loose.sms.sendActivationCode(sms));
      expect(loose.sms.calls).toHaveLength(1);
    } finally {
      await runtime.close();
    }
  });

  it("预发没配密钥：启动自检不过，字段加密与后台登录的密钥各报一条", TIMEOUT, async () => {
    const { runtime } = await start({ APP_ENV: "stg" });
    try {
      const failure = await runStartupChecks(runtime.startupChecks).catch(
        (error: unknown) => error,
      );
      expect(failure).toBeInstanceOf(StartupCheckError);
      expect((failure as StartupCheckError).issues).toEqual([
        expect.stringMatching(/^security\.crypto：没有配置密钥/),
        expect.stringMatching(/^security\.auth_keys：没有配置后台登录的密钥/),
      ]);
    } finally {
      await runtime.close();
    }
  });

  it(
    "后台登录与会话（W1-01a）：没配密钥时取 staffAuth 即抛，进程照样起得来；配了就装得起来，自检照跑",
    TIMEOUT,
    async () => {
      const bare = await start();
      try {
        expect(() => bare.runtime.staffAuth).toThrow(/没有配置/);
        // local、test 下放行，记一条告警
        await expect(runStartupChecks(bare.runtime.startupChecks)).resolves.toBeUndefined();
        expect(
          bare.lines.filter((line) => String(line.msg).includes("AUTH_KEYS_FILE")),
        ).toHaveLength(1);
      } finally {
        await bare.runtime.close();
      }
      const keyed = await start({ ...fakeKeyEnv(), APP_ENV: "stg" });
      try {
        await expect(runStartupChecks(keyed.runtime.startupChecks)).resolves.toBeUndefined();
        expect(keyed.runtime.staffAuth).toBe(keyed.runtime.staffAuth);
        expect(typeof keyed.runtime.flow.transition).toBe("function");
        // worker 进程不签票据、不建会话：清单里没有这一项
        const worker = createRuntime({
          entry: "worker",
          env: keyed.runtime.env,
          version: "sha-test",
          redisKeyPrefix: redis.prefix,
          logger: createLogger({
            svc: "worker",
            env: "stg",
            level: "error",
            version: "sha-test",
            destination: { write: () => undefined },
          }),
        });
        try {
          expect(worker.startupChecks.map((check) => check.name)).not.toContain(
            "security.auth_keys",
          );
        } finally {
          await worker.close();
        }
      } finally {
        await keyed.runtime.close();
      }
    },
  );
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
