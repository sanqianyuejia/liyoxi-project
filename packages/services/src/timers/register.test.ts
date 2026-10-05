import type { PrismaClient } from "@liyoxi/db";
import { beforeAll, describe, expect, it } from "vitest";

import type { TxRunner } from "../kernel/index.js";
import {
  assembleForTest,
  createClock,
  SAMPLE_TIMER_KINDS,
  seedWorkCalendar,
  useTestDatabase,
} from "../testing/index.js";
import { newSubject, runner, SLOW } from "./__fixtures__/db.js";
import { insertTimer } from "./__fixtures__/insert.js";
import { recurringKey, RECURRING_RETENTION_DAYS, timerKey } from "./index.js";

// 任务书 第 7 节验收 10：测试装配收集到 timers 的清理项与 sla 的 sla.N8；清理函数只删
// subject_type IS NULL、status = 'fired'、fire_at 早于 90 天的行；sla.N8 对每个缺口日期报一条。
// 调度在 W0-24：这里从装配结果里取出函数直接调。

const db = useTestDatabase("services");
const assembly = assembleForTest({ entry: "worker" });
let prisma: PrismaClient;
let tx: TxRunner;

beforeAll(async () => {
  prisma = await db.prisma();
  tx = runner(prisma);
}, SLOW);

const DAY = 24 * 60 * 60 * 1000;

describe("模块登记", () => {
  it("装配收集到 timers 的清理项与 sla 的 sla.N8，字段照 01 分组与 15 分组写", () => {
    expect(assembly.cleanup("timers.recurring_fired")).toMatchObject({
      module: "timers",
      every: "day",
    });
    expect(assembly.invariant("sla.N8")).toMatchObject({
      module: "sla",
      severity: "P2",
      modes: ["full"],
      heal: "none",
    });
    expect(RECURRING_RETENTION_DAYS).toBe(90);
  });
});

describe("清理：已触发的周期任务行保留 90 天", () => {
  const clock = createClock(new Date("2026-06-01T04:00:00.000Z"));
  const ago = (days: number, extraMs = 0): Date =>
    new Date(clock.now().getTime() - days * DAY + extraMs);
  const purge = (limit: number): Promise<number> =>
    tx.run((handle) =>
      assembly.cleanup("timers.recurring_fired")!.run(handle, { now: clock.now(), limit }),
    );

  it(
    "只删无主体、fired、fire_at 早于 90 天的行；别的一行不动",
    async () => {
      const job = "ops.retention";
      const subject = newSubject();
      const plain = SAMPLE_TIMER_KINDS.plain;
      const rows = {
        old: await insertTimer(prisma, {
          kind: job,
          key: recurringKey(job, ago(91)),
          fireAt: ago(91),
          status: "fired",
        }),
        justOver: await insertTimer(prisma, {
          kind: job,
          key: recurringKey(job, ago(90, -1000)),
          fireAt: ago(90, -1000),
          status: "fired",
        }),
        justUnder: await insertTimer(prisma, {
          kind: job,
          key: recurringKey(job, ago(90, 1000)),
          fireAt: ago(90, 1000),
          status: "fired",
        }),
        recent: await insertTimer(prisma, {
          kind: job,
          key: recurringKey(job, ago(1)),
          fireAt: ago(1),
          status: "fired",
        }),
        oldFailed: await insertTimer(prisma, {
          kind: job,
          key: recurringKey(job, ago(120)),
          fireAt: ago(120),
          status: "failed",
        }),
        oldSkipped: await insertTimer(prisma, {
          kind: job,
          key: recurringKey(job, ago(121)),
          fireAt: ago(121),
          status: "skipped",
        }),
        oldCancelled: await insertTimer(prisma, {
          kind: job,
          key: recurringKey(job, ago(122)),
          fireAt: ago(122),
          status: "cancelled",
        }),
        oldScheduled: await insertTimer(prisma, {
          kind: job,
          key: recurringKey(job, ago(123)),
          fireAt: ago(123),
          status: "scheduled",
        }),
        // 业务定时器行不删：有主体，哪怕早就触发了
        business: await insertTimer(prisma, {
          kind: plain,
          key: timerKey(plain, subject),
          fireAt: ago(400),
          status: "fired",
          subject,
        }),
      };
      expect(await purge(100)).toBe(2);
      const left = await prisma.$queryRawUnsafe<{ id: string }[]>(
        "SELECT id::text AS id FROM timer WHERE id = ANY($1::uuid[])",
        Object.values(rows),
      );
      const leftNames = Object.entries(rows)
        .filter(([, id]) => left.some((row) => row.id === id))
        .map(([name]) => name);
      expect(leftNames.sort()).toEqual([
        "business",
        "justUnder",
        "oldCancelled",
        "oldFailed",
        "oldScheduled",
        "oldSkipped",
        "recent",
      ]);
      expect(await purge(100)).toBe(0);
    },
    SLOW,
  );

  it(
    "单轮至多删 limit 行，先删最早的；剩下的下一轮再删",
    async () => {
      const job = "invariant.quick";
      for (const days of [200, 201, 202]) {
        await insertTimer(prisma, {
          kind: job,
          key: recurringKey(job, ago(days)),
          fireAt: ago(days),
          status: "fired",
        });
      }
      expect(await purge(2)).toBe(2);
      const left = await prisma.$queryRawUnsafe<{ dedupe_key: string }[]>(
        "SELECT dedupe_key FROM timer WHERE kind = $1::text",
        job,
      );
      expect(left.map((row) => row.dedupe_key)).toEqual([recurringKey(job, ago(200))]);
      expect(await purge(2)).toBe(1);
    },
    SLOW,
  );
});

describe("sla.N8：已铺满的年份内日期连续", () => {
  const check = (): Promise<readonly { subject?: unknown; detail: unknown }[]> =>
    tx.run((handle) => assembly.invariant("sla.N8")!.run!(handle, {}));

  it(
    "表为空不报；铺满一年不报；抽掉两天报两条，对象是缺失的日期",
    async () => {
      expect(await check()).toEqual([]);
      await seedWorkCalendar(prisma, { from: "2026-01-01", to: "2026-12-31" });
      expect(await check()).toEqual([]);

      await prisma.$executeRawUnsafe(
        "DELETE FROM work_calendar_day WHERE day IN ('2026-03-05', '2026-10-02')",
      );
      expect(await check()).toEqual([
        {
          subject: { type: "work_calendar_day", key: "2026-03-05" },
          detail: { missingDay: "2026-03-05" },
        },
        {
          subject: { type: "work_calendar_day", key: "2026-10-02" },
          detail: { missingDay: "2026-10-02" },
        },
      ]);
    },
    SLOW,
  );

  it(
    "下一年只铺了头十天：那一年余下的每一天各报一条",
    async () => {
      await seedWorkCalendar(prisma, { from: "2027-01-01", to: "2027-01-10" });
      const violations = await check();
      expect(violations).toHaveLength(2 + 355);
      const keys = violations.map((item) => (item.subject as { key: string }).key);
      expect(keys.slice(0, 3)).toEqual(["2026-03-05", "2026-10-02", "2027-01-11"]);
      expect(keys.at(-1)).toBe("2027-12-31");
    },
    SLOW,
  );
});
