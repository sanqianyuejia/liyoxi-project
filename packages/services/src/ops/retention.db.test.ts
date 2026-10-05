import type { PrismaClient } from "@liyoxi/db";
import { beforeAll, describe, expect, it } from "vitest";

import { AppError, createTxRunner, defineRegistration } from "../kernel/index.js";
import type { AlertInput, CleanupContext, TxRunner } from "../kernel/index.js";
import { assembleForTest, createClock, useTestDatabase } from "../testing/index.js";
import { RETENTION_LIMIT, RETENTION_MAX_BATCHES, runRetention } from "./retention.js";

// 任务书 第 7 节验收 7：清理登记的执行。连真库（身份是应用角色 lyx_app）。

const SLOW = 180_000;

const db = useTestDatabase("services");
const clock = createClock();
let prisma: PrismaClient;
let tx: TxRunner;

beforeAll(async () => {
  prisma = await db.prisma();
  tx = createTxRunner({ prisma, appEnv: "test" });
}, SLOW);

/** 北京时间的钟点写法 → 时刻 */
const bj = (text: string): Date => new Date(`${text}+08:00`);

/** 插一行幂等记录：expiresInHours 为负即已过期（过期时间比的是数据库时间） */
const insertIdempotency = (key: string, expiresInHours: number): Promise<number> =>
  prisma.$executeRawUnsafe(
    `INSERT INTO idempotency_record (scope, actor_key, key, request_hash, state, created_at, expires_at)
     VALUES ('lyxtest.retention', 'system:lyxtest', $1::text, repeat('a', 64), 'done',
             now() - interval '48 hours', now() + $2::int * interval '1 hour')`,
    key,
    expiresInHours,
  );
const idempotencyKeys = async (): Promise<string[]> =>
  (
    await prisma.$queryRawUnsafe<{ key: string }[]>(
      "SELECT key FROM idempotency_record WHERE scope = 'lyxtest.retention' ORDER BY key",
    )
  ).map((row) => row.key);

describe("真实装配登记的清理项", () => {
  const assembly = assembleForTest({ entry: "worker" });
  const raised: AlertInput[] = [];
  const alerts = { raise: async (input: AlertInput) => void raised.push(input) };
  const round = (scheduledFor: Date) =>
    tx.run((handle) => runRetention(handle, { assembly, clock, alerts }, { scheduledFor }));

  it("幂等行的过期清理登记在 kernel，每小时；timers 的 90 天清理每日", () => {
    expect(assembly.cleanup("kernel.idempotency_record")).toMatchObject({
      module: "kernel",
      every: "hour",
    });
    expect(assembly.cleanup("timers.recurring_fired")).toMatchObject({ every: "day" });
  });

  it(
    "每小时项每轮都跑：过期的幂等行被删、没过期的留着；每日项只在当日第一轮跑",
    async () => {
      await insertIdempotency("expired-1", -1);
      await insertIdempotency("expired-2", -24);
      await insertIdempotency("live", 1);

      const midday = await round(bj("2026-01-05T10:00"));
      expect(midday).toEqual({
        daily: false,
        rows: { "kernel.idempotency_record": 2 },
        failed: {},
      });
      expect(await idempotencyKeys()).toEqual(["live"]);

      const midnight = await round(bj("2026-01-06T00:00"));
      expect(midnight).toEqual({
        daily: true,
        rows: { "kernel.idempotency_record": 0, "timers.recurring_fired": 0 },
        failed: {},
      });
      expect(await idempotencyKeys()).toEqual(["live"]);
      expect(raised).toEqual([]);
    },
    SLOW,
  );
});

describe("样例清理项：限量、出错不连累别的项", () => {
  const calls: Record<string, CleanupContext[]> = {};
  const seen = (name: string, ctx: CleanupContext): void => {
    (calls[name] ??= []).push(ctx);
  };
  const state = { retryable: false };
  const assembly = assembleForTest({
    entry: "worker",
    isolated: true,
    extra: [
      defineRegistration("lyxtest_retention", {
        cleanups: [
          {
            // 名字排在最前：先删一行，再让数据库报错——保存点要把这次删除退回去
            name: "lyxtest.a_broken",
            every: "hour",
            run: async (handle, ctx) => {
              seen("lyxtest.a_broken", ctx);
              if (state.retryable) {
                throw Object.assign(new Error("样例：死锁"), {
                  meta: { driverAdapterError: { cause: { originalCode: "40P01" } } },
                });
              }
              await handle.$executeRawUnsafe(
                "DELETE FROM idempotency_record WHERE scope = 'lyxtest.retention' AND key = 'keep'",
              );
              await handle.$executeRawUnsafe("SELECT 1 / 0");
              return 1;
            },
          },
          {
            name: "lyxtest.b_backlog",
            every: "hour",
            // 每批都删满：说明还有，框架接着删，到批数上限为止
            run: async (_handle, ctx) => {
              seen("lyxtest.b_backlog", ctx);
              return ctx.limit;
            },
          },
          {
            name: "lyxtest.c_delete",
            every: "hour",
            run: async (handle, ctx) => {
              seen("lyxtest.c_delete", ctx);
              return handle.$executeRawUnsafe(
                "DELETE FROM idempotency_record WHERE scope = 'lyxtest.retention' AND key = 'gone'",
              );
            },
          },
          {
            name: "lyxtest.d_daily",
            every: "day",
            run: async (_handle, ctx) => {
              seen("lyxtest.d_daily", ctx);
              return 0;
            },
          },
        ],
      }),
    ],
  });
  const raised: AlertInput[] = [];
  const alerts = { raise: async (input: AlertInput) => void raised.push(input) };

  it(
    "一项出错只回滚它自己并报一条告警，别的项照常提交；删满一批接着删，至多到批数上限；每日项没轮到",
    async () => {
      await prisma.$executeRawUnsafe(
        "DELETE FROM idempotency_record WHERE scope = 'lyxtest.retention'",
      );
      await insertIdempotency("keep", 1);
      await insertIdempotency("gone", 1);

      const result = await tx.run((handle) =>
        runRetention(handle, { assembly, clock, alerts }, { scheduledFor: bj("2026-01-05T10:00") }),
      );
      expect(result).toEqual({
        daily: false,
        rows: {
          "lyxtest.b_backlog": RETENTION_LIMIT * RETENTION_MAX_BATCHES,
          "lyxtest.c_delete": 1,
        },
        failed: { "lyxtest.a_broken": expect.stringContaining("division by zero") },
      });
      expect(await idempotencyKeys()).toEqual(["keep"]);
      expect(calls["lyxtest.b_backlog"]).toHaveLength(RETENTION_MAX_BATCHES);
      expect(calls["lyxtest.c_delete"]).toEqual([{ now: clock.now(), limit: RETENTION_LIMIT }]);
      expect(calls["lyxtest.d_daily"]).toBeUndefined();
      expect(raised).toEqual([
        {
          rule: "ops.retention_failed",
          dimension: "lyxtest.a_broken",
          severity: "P3",
          detail: {
            module: "lyxtest_retention",
            error: expect.stringContaining("division by zero"),
          },
        },
      ]);
    },
    SLOW,
  );

  it(
    "单批上限可以给；死锁这类可重试的错误不接，往外抛，由事务入口重试后报 BUSY",
    async () => {
      for (const name of Object.keys(calls)) delete calls[name];
      state.retryable = true;
      try {
        await expect(
          tx.run((handle) =>
            runRetention(
              handle,
              { assembly, clock, alerts },
              { scheduledFor: bj("2026-01-05T11:00"), limit: 7 },
            ),
          ),
        ).rejects.toBeInstanceOf(AppError);
        // 整轮重试了一次：第一项被调了两次，都收到给的上限；后面的项一次都没轮到
        expect(calls["lyxtest.a_broken"]?.map((ctx) => ctx.limit)).toEqual([7, 7]);
        expect(calls["lyxtest.c_delete"]).toBeUndefined();
      } finally {
        state.retryable = false;
      }
    },
    SLOW,
  );
});
