import { createPrismaClient } from "@liyoxi/db";
import type { PrismaClient } from "@liyoxi/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { TxRunner } from "../kernel/index.js";
import {
  assembleForTest,
  createClock,
  SAMPLE_JOB_KINDS,
  useTestDatabase,
} from "../testing/index.js";
import { force, ROOMY, runner, sampleTimers, SLOW, timerRows } from "./__fixtures__/db.js";
import { createTimers, recurringKey } from "./index.js";

// 任务书 第 7 节验收 5（甲类的并发测试在最后一组）：周期任务补登记。
// 样例登记：every5 每 5 分钟、补最近一格；daily 每日 03:30；monthly 每月 1 日 10:00；stgOnly 只在预发。

const db = useTestDatabase("services");
const timers = sampleTimers();
let prisma: PrismaClient;
let second: PrismaClient;
let tx: TxRunner;

beforeAll(async () => {
  prisma = await db.prisma();
  second = createPrismaClient({ connectionString: await db.url(), max: 2 });
  tx = runner(prisma);
}, SLOW);

afterAll(async () => {
  await second?.$disconnect();
});

const { every5, daily, monthly, stgOnly } = SAMPLE_JOB_KINDS;
/** 北京时间的钟点写法 → 时刻 */
const bj = (text: string): Date => new Date(`${text}+08:00`);
const ensure = (now: Date): Promise<readonly string[]> =>
  tx.run(async (handle) => (await timers.ensureRecurring(handle, now)).created, ROOMY);
/** 某个样例周期任务现有的行：键 → 状态 */
const slots = async (kind: string): Promise<Record<string, string>> =>
  Object.fromEntries(
    (await timerRows(prisma, `${kind}:`)).map((row) => [row.dedupe_key, row.status]),
  );

describe("ensureRecurring：一个实例", () => {
  const clock = createClock(bj("2026-01-05T12:00:00"));

  it(
    "每一项登记下一期；主体两列为空，键是 {kind}:{栅格时刻}，payload.scheduledFor 等于栅格时刻",
    async () => {
      const created = await ensure(clock.now());
      expect(created).toEqual([
        recurringKey(daily, bj("2026-01-06T03:30:00")),
        recurringKey(every5, bj("2026-01-05T12:05:00")),
        recurringKey(every5, bj("2026-01-05T12:00:00")), // catchUp：最近一格
        recurringKey(monthly, bj("2026-02-01T10:00:00")),
      ]);
      expect(created).toContain("lyxtest.daily:2026-01-05T19:30:00Z");

      const rows = [
        ...(await timerRows(prisma, `${daily}:`)),
        ...(await timerRows(prisma, `${every5}:`)),
        ...(await timerRows(prisma, `${monthly}:`)),
      ];
      expect(rows).toHaveLength(4);
      for (const row of rows) {
        expect(row).toMatchObject({ subject_type: null, subject_id: null, status: "scheduled" });
        const scheduledFor = new Date((row.payload as { scheduledFor: string }).scheduledFor);
        expect(row.dedupe_key).toBe(recurringKey(row.kind, scheduledFor));
        // 下一期到点才触发；补的那一格立即到点（fire_at 取当时的 now）
        const caughtUp = scheduledFor.getTime() <= clock.now().getTime();
        expect(row.fire_at).toEqual(caughtUp ? clock.now() : scheduledFor);
      }
    },
    SLOW,
  );

  it(
    "同一时刻再补一轮：什么都不新建；envs 不含当前环境的任务不登记",
    async () => {
      expect(await ensure(clock.now())).toEqual([]);
      clock.advance(60_000);
      expect(await ensure(clock.now())).toEqual([]);
      expect(await slots(stgOnly)).toEqual({});
      expect(timers.registry.recurringJobs.map((job) => job.kind)).not.toContain(stgOnly);
    },
    SLOW,
  );

  it(
    "停了一阵再补：catchUp 只补最近一格，中间漏掉的不补；没声明 catchUp 的只登记下一期",
    async () => {
      // 12:01 → 12:23：漏了 12:10、12:15、12:20 三格（12:05 那一格上一轮已登记）
      clock.set(bj("2026-01-05T12:23:00"));
      expect(await ensure(clock.now())).toEqual([
        recurringKey(every5, bj("2026-01-05T12:25:00")),
        recurringKey(every5, bj("2026-01-05T12:20:00")),
      ]);
      expect(Object.keys(await slots(every5)).sort()).toEqual(
        ["12:00", "12:05", "12:20", "12:25"].map((at) =>
          recurringKey(every5, bj(`2026-01-05T${at}:00`)),
        ),
      );

      // 拨到 01-07 05:00：daily 漏了 01-07 03:30 那一格，不补；只登记 01-08 03:30
      clock.set(bj("2026-01-07T05:00:00"));
      const created = await ensure(clock.now());
      expect(created.filter((key) => key.startsWith(`${daily}:`))).toEqual([
        recurringKey(daily, bj("2026-01-08T03:30:00")),
      ]);
      expect(Object.keys(await slots(daily)).sort()).toEqual([
        recurringKey(daily, bj("2026-01-06T03:30:00")),
        recurringKey(daily, bj("2026-01-08T03:30:00")),
      ]);
    },
    SLOW,
  );

  it(
    "拨时钟跨日、跨月、跨年：下一期落在对的那一天",
    async () => {
      clock.set(bj("2026-01-31T23:58:00"));
      let created = await ensure(clock.now());
      expect(created).toContain(recurringKey(every5, bj("2026-02-01T00:00:00"))); // 跨日又跨月
      expect(created).toContain(recurringKey(daily, bj("2026-02-01T03:30:00")));
      expect(created.filter((key) => key.startsWith(`${monthly}:`))).toEqual([]); // 02-01 10:00 早已登记

      clock.set(bj("2026-02-01T10:00:00")); // 正好到点：这一格算已到，下一期是 3 月
      created = await ensure(clock.now());
      expect(created).toContain(recurringKey(monthly, bj("2026-03-01T10:00:00")));

      clock.set(bj("2026-12-31T23:59:30"));
      created = await ensure(clock.now());
      expect(created).toContain(recurringKey(every5, bj("2027-01-01T00:00:00")));
      expect(created).toContain(recurringKey(daily, bj("2027-01-01T03:30:00")));
      expect(created).toContain(recurringKey(monthly, bj("2027-01-01T10:00:00")));
      expect(created).toContain("lyxtest.monthly:2027-01-01T02:00:00Z");
    },
    SLOW,
  );

  it(
    "同键的行不论什么状态都算已登记：失败的、已取消的那一期不复活、不重建",
    async () => {
      const now = bj("2027-03-10T08:02:00");
      await ensure(now);
      const next = recurringKey(every5, bj("2027-03-10T08:05:00"));
      const last = recurringKey(every5, bj("2027-03-10T08:00:00"));
      const idOf = async (key: string): Promise<string> => (await timerRows(prisma, key))[0]!.id;
      await force(prisma, await idOf(last), "failed");
      await force(prisma, await idOf(next), "cancelled");
      expect(await ensure(now)).toEqual([]);
      expect((await timerRows(prisma, last)).map((row) => row.status)).toEqual(["failed"]);
      expect((await timerRows(prisma, next)).map((row) => row.status)).toEqual(["cancelled"]);
    },
    SLOW,
  );

  it(
    "预发的装配里 stgOnly 在登记表里，补登记给它建行；真实模块的登记（不带样例）补登记不报错",
    async () => {
      const stg = sampleTimers("stg");
      expect(stg.registry.recurringJobs.map((job) => job.kind)).toContain(stgOnly);
      const now = bj("2027-05-01T09:01:00");
      const created = await tx.run(
        async (handle) => (await stg.ensureRecurring(handle, now)).created,
        ROOMY,
      );
      expect(created).toContain(recurringKey(stgOnly, bj("2027-05-01T09:05:00")));

      const real = createTimers({ assembly: assembleForTest({ entry: "worker" }) });
      await expect(
        tx.run((handle) => real.ensureRecurring(handle, now), ROOMY),
      ).resolves.toHaveProperty("created");
    },
    SLOW,
  );
});

describe("ensureRecurring：两个实例同时补同一格", () => {
  const ROUNDS = 20;

  it(
    `同一格只有一行，两边新建的合起来不多不少；重复 ${ROUNDS} 次`,
    async () => {
      const other = runner(second);
      for (let round = 0; round < ROUNDS; round += 1) {
        // 每轮往后一天：every5 的两格、daily 的下一期每轮都是新的
        const at = new Date(bj("2028-01-15T12:02:00").getTime() + round * 24 * 60 * 60 * 1000);
        let arrived = 0;
        let open!: () => void;
        const opened = new Promise<void>((resolve) => (open = resolve));
        const together = async (): Promise<void> => {
          arrived += 1;
          if (arrived >= 2) open();
          await opened;
        };
        const [mine, theirs] = await Promise.all(
          [tx, other].map((instance) =>
            instance.run(async (handle) => {
              await handle.$queryRawUnsafe("SELECT 1");
              await together();
              return (await timers.ensureRecurring(handle, at)).created;
            }, ROOMY),
          ),
        );
        const all = [...mine!, ...theirs!];
        // 一格只被一边建出来
        expect(new Set(all).size).toBe(all.length);
        const expected = await tx.run(async (handle) => {
          // 这一刻应有的四格都在，再补一轮什么都不新建
          const again = await timers.ensureRecurring(handle, at);
          expect(again.created).toEqual([]);
          return handle.$queryRawUnsafe<{ dedupe_key: string; n: number }[]>(
            "SELECT dedupe_key, count(*)::int AS n FROM timer WHERE dedupe_key = ANY($1::text[]) GROUP BY 1",
            all,
          );
        }, ROOMY);
        expect(expected).toHaveLength(all.length);
        expect(expected.every((row) => row.n === 1)).toBe(true);
        expect(all.filter((key) => key.startsWith(`${every5}:`))).toHaveLength(2);
      }
    },
    SLOW,
  );
});
