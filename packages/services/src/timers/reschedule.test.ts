import type { PrismaClient } from "@liyoxi/db";
import { beforeAll, describe, expect, it } from "vitest";

import type { TxRunner } from "../kernel/index.js";
import { SAMPLE_TIMER_KINDS, useTestDatabase } from "../testing/index.js";
import { force, newSubject, runner, sampleTimers, SLOW, timerRows } from "./__fixtures__/db.js";
import {
  claimTimers,
  currentTimerId,
  runAsCurrentTimer,
  timerKey,
  timerKeyPrefix,
} from "./index.js";

// 任务书 第 7 节验收 3：同键 arm 改 fire_at 与 payload（到期时间变了，另把失败重试清掉，KF-1 改）；
// cancel({ subject, keyPrefix }) 只取消前缀匹配的 scheduled、dispatched 行，并跳过正在执行的这一条。

const db = useTestDatabase("services");
const timers = sampleTimers();
let prisma: PrismaClient;
let tx: TxRunner;

beforeAll(async () => {
  prisma = await db.prisma();
  tx = runner(prisma);
}, SLOW);

const { plain, revivable } = SAMPLE_TIMER_KINDS;
const T0 = new Date("2026-03-02T02:00:00.000Z");
const T1 = new Date("2026-03-09T02:00:00.000Z");

/** 整行，列名 → 值（jsonb） */
async function wholeRow(id: string): Promise<Record<string, unknown>> {
  const [row] = await prisma.$queryRawUnsafe<{ row: Record<string, unknown> }[]>(
    "SELECT to_jsonb(timer.*) AS row FROM timer WHERE id = $1::uuid",
    id,
  );
  return row!.row;
}

describe("改期：同键再 arm 一次", () => {
  /** 扮一次失败后的重试排期：失败过两次，重试时刻已到 */
  const failTwice = (id: string): Promise<number> =>
    prisma.$executeRawUnsafe(
      "UPDATE timer SET attempts = 2, retry_at = now() - interval '1 second', dispatch_no = 3, last_error = '样例' WHERE id = $1::uuid",
      id,
    );

  it(
    "到期时间变了：改 fire_at 与 payload，失败重试重来（retry_at 置空、attempts 归零），别的列不动",
    async () => {
      const subject = newSubject();
      const key = timerKey(plain, subject, "2027-06-30");
      const input = { kind: plain, subject, key };
      const first = await tx.run((handle) =>
        timers.arm(handle, { ...input, fireAt: T0, payload: { policy: "ticket.assign" } }),
      );
      await failTwice(first.id);
      const before = await wholeRow(first.id);

      const second = await tx.run((handle) =>
        timers.arm(handle, { ...input, fireAt: T1, payload: { policy: "ticket.plan_confirm" } }),
      );
      expect(second).toEqual({ id: first.id, status: "scheduled", outcome: "rescheduled" });
      const after = await wholeRow(first.id);
      const changed = Object.keys(after).filter(
        (column) => JSON.stringify(after[column]) !== JSON.stringify(before[column]),
      );
      expect(changed.sort()).toEqual(["attempts", "fire_at", "payload", "retry_at", "updated_at"]);
      expect(after).toMatchObject({
        payload: { policy: "ticket.plan_confirm" },
        attempts: 0,
        retry_at: null,
        // 认领序号与最近一次的错误摘要留着
        dispatch_no: 3,
        last_error: "样例",
      });
      expect(new Date(after["fire_at"] as string)).toEqual(T1);
    },
    SLOW,
  );

  it(
    "到期时间没变：只换 payload（不带即清掉），重试进度不动",
    async () => {
      const subject = newSubject();
      const key = timerKey(plain, subject, "2027-07-31");
      const input = { kind: plain, subject, key, fireAt: T1 };
      const first = await tx.run((handle) =>
        timers.arm(handle, { ...input, payload: { policy: "ticket.assign" } }),
      );
      await failTwice(first.id);
      const before = await wholeRow(first.id);

      expect(await tx.run((handle) => timers.arm(handle, input))).toMatchObject({
        outcome: "rescheduled",
      });
      const after = await wholeRow(first.id);
      const changed = Object.keys(after).filter(
        (column) => JSON.stringify(after[column]) !== JSON.stringify(before[column]),
      );
      expect(changed.sort()).toEqual(["payload", "updated_at"]);
      expect(after).toMatchObject({ payload: null, attempts: 2 });
      expect(after["retry_at"]).toEqual(before["retry_at"]);
    },
    SLOW,
  );

  // KF-1：复审查出的缺陷。失败重试中的行改期到更晚，retry_at 原样留着，扫描按 COALESCE(retry_at, fire_at) 照旧时刻认领
  it(
    "失败重试中的行改期到更晚：扫描到了旧的重试时刻不认领它",
    async () => {
      const subject = newSubject();
      const key = timerKey(plain, subject, "2027-08-31");
      const input = { kind: plain, subject, key };
      const hour = 3_600_000;
      const first = await tx.run((handle) =>
        timers.arm(handle, { ...input, fireAt: new Date(Date.now() - hour) }),
      );
      await failTwice(first.id);
      /** 扫描认领一轮看认领到了谁，随后整个回滚：不动同一个库里别的用例留下的行 */
      const claimedIds = async (): Promise<string[]> => {
        const rollback = new Error("只看不留");
        let ids: string[] = [];
        await tx
          .run(async (handle) => {
            const { claimed } = await claimTimers(handle, timers.registry, new Date());
            ids = claimed.map((ref) => ref.timerId);
            throw rollback;
          })
          .catch((error: unknown) => {
            if (error !== rollback) throw error;
          });
        return ids;
      };
      // 对照：改期之前，重试时刻已到，扫描认领得到它
      expect(await claimedIds()).toContain(first.id);

      await tx.run((handle) =>
        timers.arm(handle, { ...input, fireAt: new Date(Date.now() + hour) }),
      );
      expect(await claimedIds()).not.toContain(first.id);
      const [row] = await timerRows(prisma, key);
      expect(row).toMatchObject({ status: "scheduled", attempts: 0, retry_at: null });
    },
    SLOW,
  );
});

describe("取消：按主体、按 kind、按前缀", () => {
  /** 一个主体上铺五行：plain 的三个目标日期（scheduled、dispatched、fired），revivable 的一行，另一个主体的一行 */
  async function layout(): Promise<{
    subject: ReturnType<typeof newSubject>;
    ids: Record<"june" | "july" | "done" | "other" | "stranger", string>;
  }> {
    const subject = newSubject();
    const stranger = newSubject();
    const arm = (kind: string, target: ReturnType<typeof newSubject>, suffix: string) =>
      tx.run((handle) =>
        timers.arm(handle, {
          kind,
          subject: target,
          key: timerKey(kind, target, suffix),
          fireAt: T0,
        }),
      );
    const june = await arm(plain, subject, "2027-06-30");
    const july = await arm(plain, subject, "2027-07-31");
    const done = await arm(plain, subject, "2027-05-31");
    const other = await arm(revivable, subject, "2027-06-30");
    const strangerRow = await arm(plain, stranger, "2027-06-30");
    await force(prisma, july.id, "dispatched");
    await force(prisma, done.id, "fired");
    return {
      subject,
      ids: {
        june: june.id,
        july: july.id,
        done: done.id,
        other: other.id,
        stranger: strangerRow.id,
      },
    };
  }

  const statusOf = async (ids: Record<string, string>): Promise<Record<string, string>> => {
    const found = await prisma.$queryRawUnsafe<{ id: string; status: string }[]>(
      "SELECT id::text AS id, status FROM timer WHERE id = ANY($1::uuid[])",
      Object.values(ids),
    );
    return Object.fromEntries(
      Object.entries(ids).map(([name, id]) => [name, found.find((row) => row.id === id)!.status]),
    );
  };

  it(
    "keyPrefix：只取消前缀匹配的 scheduled、dispatched 行；别的 kind、别的主体、已完成的都不动",
    async () => {
      const { subject, ids } = await layout();
      const cancelled = await tx.run((handle) =>
        timers.cancel(handle, { subject, keyPrefix: timerKeyPrefix(plain, subject) }),
      );
      expect(cancelled).toEqual([ids.june, ids.july].sort());
      expect(await statusOf(ids)).toEqual({
        june: "cancelled",
        july: "cancelled",
        done: "fired",
        other: "scheduled",
        stranger: "scheduled",
      });
    },
    SLOW,
  );

  it(
    "前缀再窄一段只中一行；kinds 只取消列出的 kind；空的 kinds 什么都不取消",
    async () => {
      const { subject, ids } = await layout();
      const narrow = `${timerKey(plain, subject, "2027-07")}`;
      expect(
        await tx.run((handle) => timers.cancel(handle, { subject, keyPrefix: narrow })),
      ).toEqual([ids.july]);
      expect(await tx.run((handle) => timers.cancel(handle, { subject, kinds: [] }))).toEqual([]);
      expect(
        await tx.run((handle) => timers.cancel(handle, { subject, kinds: [revivable] })),
      ).toEqual([ids.other]);
      expect(await statusOf(ids)).toEqual({
        june: "scheduled",
        july: "cancelled",
        done: "fired",
        other: "cancelled",
        stranger: "scheduled",
      });
    },
    SLOW,
  );

  it(
    "跳过正在执行的这一条：处理器里取消自己主体上的定时器，自己那一行不动",
    async () => {
      const { subject, ids } = await layout();
      expect(currentTimerId()).toBeUndefined();
      // W0-23 的 runTimer 是这个摆法：事务里把处理器包在 runAsCurrentTimer 里
      const cancelled = await tx.run((handle) =>
        runAsCurrentTimer(ids.july, async () => {
          expect(currentTimerId()).toBe(ids.july);
          return timers.cancel(handle, { subject, keyPrefix: timerKeyPrefix(plain, subject) });
        }),
      );
      expect(cancelled).toEqual([ids.june]);
      expect(await statusOf(ids)).toMatchObject({ june: "cancelled", july: "dispatched" });
      // 出了处理器，同一个调用就把它也取消了
      expect(await tx.run((handle) => timers.cancel(handle, { subject, kinds: [plain] }))).toEqual([
        ids.july,
      ]);
      expect(
        (await timerRows(prisma, timerKeyPrefix(plain, subject))).map((row) => row.status),
      ).toEqual(["cancelled", "cancelled", "fired"]);
    },
    SLOW,
  );
});
