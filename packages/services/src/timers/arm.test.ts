import type { PrismaClient } from "@liyoxi/db";
import fc from "fast-check";
import { beforeAll, describe, expect, it } from "vitest";

import type { TxRunner } from "../kernel/index.js";
import {
  assembleForTest,
  SAMPLE_TIMER_KINDS,
  SAMPLE_TIMER_SUBJECT,
  useTestDatabase,
} from "../testing/index.js";
import {
  force,
  liveCount,
  newSubject,
  runner,
  sampleTimers,
  SLOW,
  timerRows,
} from "./__fixtures__/db.js";
import { createTimers, timerKey } from "./index.js";
import type { ArmOutcome, TimerStatus } from "./index.js";

// 任务书 第 7 节验收 1、4：01 分组 第 2.5 节状态机里 timers.arm 的 7 行与 timers.cancel 的 1 行，表驱动；
// 任一时刻同键未取消的行不超过 1。另有一条性质测试：随机的登记、取消、状态推进序列与一个内存模型逐步对账。

const db = useTestDatabase("services");
const timers = sampleTimers();
let prisma: PrismaClient;
let tx: TxRunner;

beforeAll(async () => {
  prisma = await db.prisma();
  tx = runner(prisma);
}, SLOW);

const T0 = new Date("2026-03-02T02:00:00.000Z");
const T1 = new Date("2026-03-09T02:00:00.000Z");
const { plain, revivable } = SAMPLE_TIMER_KINDS;

interface Row {
  /** 状态机表的哪一行 */
  name: string;
  kind: string;
  /** 同键现有行的状态；none 即没有行 */
  existing: TimerStatus | "none";
  outcome: ArmOutcome;
  status: TimerStatus;
}

const ARM_ROWS: Row[] = [
  {
    name: "无行 → scheduled",
    kind: plain,
    existing: "none",
    outcome: "created",
    status: "scheduled",
  },
  {
    name: "同键只有 cancelled → 新插一行 scheduled",
    kind: plain,
    existing: "cancelled",
    outcome: "created",
    status: "scheduled",
  },
  {
    name: "scheduled → scheduled（改期）",
    kind: plain,
    existing: "scheduled",
    outcome: "rescheduled",
    status: "scheduled",
  },
  {
    name: "dispatched → 不变（正在执行）",
    kind: plain,
    existing: "dispatched",
    outcome: "unchanged",
    status: "dispatched",
  },
  { name: "fired → 不变", kind: plain, existing: "fired", outcome: "unchanged", status: "fired" },
  {
    name: "skipped，kind 未声明跳过后可复活 → 不变",
    kind: plain,
    existing: "skipped",
    outcome: "unchanged",
    status: "skipped",
  },
  {
    name: "skipped，kind 声明了 rearmAfterSkip → scheduled（复活）",
    kind: revivable,
    existing: "skipped",
    outcome: "revived",
    status: "scheduled",
  },
  {
    name: "failed → scheduled（复活）",
    kind: plain,
    existing: "failed",
    outcome: "revived",
    status: "scheduled",
  },
];

describe("timers.arm：同键已有行时按状态处理", () => {
  it.each(ARM_ROWS)(
    "$name",
    async ({ kind, existing, outcome, status }) => {
      const subject = newSubject();
      const key = timerKey(kind, subject);
      let firstId: string | undefined;
      if (existing !== "none") {
        const first = await tx.run((handle) =>
          timers.arm(handle, { kind, subject, key, fireAt: T0, payload: { round: 1 } }),
        );
        firstId = first.id;
        if (existing !== "scheduled") await force(prisma, first.id, existing);
      }

      const result = await tx.run((handle) =>
        timers.arm(handle, { kind, subject, key, fireAt: T1, payload: { round: 2 } }),
      );
      expect(result).toMatchObject({ outcome, status });
      expect(await liveCount(prisma, key)).toBe(1);

      const rows = await timerRows(prisma, key);
      const live = rows.filter((row) => row.status !== "cancelled");
      expect(live).toHaveLength(1);
      const row = live[0]!;
      expect(row.id).toBe(result.id);
      expect(row).toMatchObject({
        kind,
        status,
        subject_type: subject.type,
        subject_id: subject.id,
      });
      if (outcome === "unchanged") {
        // 不动：到期时间、参数都还是第一次登记的
        expect(row.id).toBe(firstId);
        expect(row.fire_at).toEqual(T0);
        expect(row.payload).toEqual({ round: 1 });
      } else {
        expect(row.fire_at).toEqual(T1);
        expect(row.payload).toEqual({ round: 2 });
      }
      if (outcome === "created") {
        // 已取消的不占键：旧行还在，仍是 cancelled
        expect(rows.filter((item) => item.status === "cancelled")).toHaveLength(
          existing === "cancelled" ? 1 : 0,
        );
        expect(row.id).not.toBe(firstId);
      }
      if (outcome === "revived") {
        // 验收 4：attempts = 0，retry_at、fired_at 置空
        expect(row.id).toBe(firstId);
        expect(row).toMatchObject({ attempts: 0, retry_at: null, fired_at: null });
      }
    },
    SLOW,
  );
});

describe("timers.cancel：scheduled、dispatched → cancelled", () => {
  it(
    "未完成的两种状态被取消，已完成的三种不动；取消之后同键可以重新登记",
    async () => {
      const subject = newSubject();
      const states: TimerStatus[] = ["scheduled", "dispatched", "fired", "skipped", "failed"];
      const ids: Record<string, string> = {};
      for (const state of states) {
        const key = timerKey(plain, subject, state);
        const { id } = await tx.run((handle) =>
          timers.arm(handle, { kind: plain, subject, key, fireAt: T0 }),
        );
        if (state !== "scheduled") await force(prisma, id, state);
        ids[state] = id;
      }
      const cancelled = await tx.run((handle) => timers.cancel(handle, { subject }));
      expect(cancelled).toEqual([ids["scheduled"], ids["dispatched"]].sort());

      const after = await timerRows(prisma, timerKey(plain, subject));
      expect(Object.fromEntries(after.map((row) => [row.id, row.status]))).toEqual({
        [ids["scheduled"]!]: "cancelled",
        [ids["dispatched"]!]: "cancelled",
        [ids["fired"]!]: "fired",
        [ids["skipped"]!]: "skipped",
        [ids["failed"]!]: "failed",
      });

      const key = timerKey(plain, subject, "scheduled");
      const again = await tx.run((handle) =>
        timers.arm(handle, { kind: plain, subject, key, fireAt: T1 }),
      );
      expect(again).toMatchObject({ outcome: "created", status: "scheduled" });
      expect(await liveCount(prisma, key)).toBe(1);
      // 再取消一遍：只有刚登记的那一行
      expect(await tx.run((handle) => timers.cancel(handle, { subject }))).toEqual([again.id]);
    },
    SLOW,
  );
});

describe("timers.arm：入参把关", () => {
  const subject = newSubject();
  const arm = (input: Partial<Parameters<typeof timers.arm>[1]>): Promise<unknown> =>
    tx.run((handle) =>
      timers.arm(handle, {
        kind: plain,
        subject,
        key: timerKey(plain, subject),
        fireAt: T0,
        ...input,
      }),
    );

  it.each([
    { what: "kind 不在契约的登记里", input: { kind: "lyxtest.unknown" }, message: /不在契约/ },
    {
      what: "主体不是契约里这个 kind 登记的表",
      input: { subject: { type: "drama_order", id: subject.id } },
      message: /主体是/,
    },
    { what: "去重键不以 kind 与主体开头", input: { key: `${plain}:other` }, message: /去重键/ },
    {
      what: "周期任务名当成有主体的定时器用",
      input: { kind: "ops.retention" },
      message: /不在契约/,
    },
    { what: "有主体的 kind 不给主体", input: { subject: undefined }, message: /周期任务/ },
    { what: "fireAt 不是合法的时刻", input: { fireAt: new Date(Number.NaN) }, message: /fireAt/ },
    { what: "给了门店没给主体", input: { storeId: subject.id }, message: /entityId/ },
    {
      what: "主体 id 不是 UUID",
      input: { subject: { type: SAMPLE_TIMER_SUBJECT, id: "42" } },
      message: /UUID/,
    },
  ])("$what：抛错，不落库", async ({ input, message }) => {
    await expect(arm(input)).rejects.toThrow(message);
    expect(await timerRows(prisma, timerKey(plain, subject))).toEqual([]);
  });

  it(
    "契约里登记的 kind 与主体直接可用（不带样例的 timers）；归属两列照写",
    async () => {
      const real = createTimers({ assembly: assembleForTest({ entry: "api" }) });
      const order = { type: "drama_order", id: newSubject().id };
      const key = timerKey("order.start", order);
      const entityId = newSubject().id;
      const storeId = newSubject().id;
      const result = await tx.run((handle) =>
        real.arm(handle, {
          kind: "order.start",
          subject: order,
          key,
          fireAt: T0,
          entityId,
          storeId,
        }),
      );
      expect(result.outcome).toBe("created");
      const [stored] = await prisma.$queryRawUnsafe<{ entity_id: string; store_id: string }[]>(
        "SELECT entity_id::text AS entity_id, store_id::text AS store_id FROM timer WHERE id = $1::uuid",
        result.id,
      );
      expect(stored).toEqual({ entity_id: entityId, store_id: storeId });
      // 样例 kind 不在契约里：不带样例的 timers 不认
      await expect(
        tx.run((handle) =>
          real.arm(handle, { kind: plain, subject, key: timerKey(plain, subject), fireAt: T0 }),
        ),
      ).rejects.toThrow(/不在契约/);
    },
    SLOW,
  );
});

// ---------- 性质：随机序列与模型对账 ----------
// 轮次与种子的约定同 kernel 的性质测试；这一条每步一个事务，缺省轮次取小。要加大或复现：
//   LYX_FC_RUNS=200 LYX_FC_SEED=42 pnpm --filter @liyoxi/services exec vitest run src/timers/arm.test.ts
const runs = {
  numRuns: Number(process.env.LYX_FC_RUNS ?? 15),
  seed: Number(process.env.LYX_FC_SEED ?? 20261005),
};

type Op =
  | { op: "arm"; slot: number; kind: string }
  | { op: "cancel"; slot: number }
  | { op: "force"; slot: number; to: "dispatched" | "fired" | "skipped" | "failed" };

const opArb: fc.Arbitrary<Op> = fc.oneof(
  {
    weight: 4,
    arbitrary: fc.record({
      op: fc.constant("arm" as const),
      slot: fc.nat(2),
      kind: fc.constantFrom(plain, revivable),
    }),
  },
  { weight: 2, arbitrary: fc.record({ op: fc.constant("cancel" as const), slot: fc.nat(2) }) },
  {
    weight: 3,
    arbitrary: fc.record({
      op: fc.constant("force" as const),
      slot: fc.nat(2),
      to: fc.constantFrom(
        "dispatched" as const,
        "fired" as const,
        "skipped" as const,
        "failed" as const,
      ),
    }),
  },
);

describe("性质：任一时刻同键未取消的行不超过 1，状态与模型一致", () => {
  it(
    "随机的登记、取消、状态推进序列",
    async () => {
      await fc.assert(
        fc.asyncProperty(fc.array(opArb, { minLength: 1, maxLength: 10 }), async (ops) => {
          // 三个槽位 = 三个主体；每个主体上 plain、revivable 各一个键
          const subjects = [newSubject(), newSubject(), newSubject()];
          /** 模型：键 → 未取消那一行的状态 */
          const model = new Map<string, TimerStatus>();
          for (const step of ops) {
            const subject = subjects[step.slot]!;
            if (step.op === "arm") {
              const key = timerKey(step.kind, subject);
              const before = model.get(key);
              const revive =
                before === "failed" || (before === "skipped" && step.kind === revivable);
              const expected =
                before === undefined || before === "scheduled" || revive ? "scheduled" : before;
              const result = await tx.run((handle) =>
                timers.arm(handle, { kind: step.kind, subject, key, fireAt: T0 }),
              );
              expect(result.status).toBe(expected);
              model.set(key, expected);
            } else if (step.op === "cancel") {
              await tx.run((handle) => timers.cancel(handle, { subject }));
              for (const kind of [plain, revivable]) {
                const key = timerKey(kind, subject);
                const before = model.get(key);
                if (before === "scheduled" || before === "dispatched") model.delete(key);
              }
            } else {
              // 扮扫描与执行：只推进 scheduled、dispatched 的行
              for (const kind of [plain, revivable]) {
                const key = timerKey(kind, subject);
                const before = model.get(key);
                if (before !== "scheduled" && before !== "dispatched") continue;
                const live = (await timerRows(prisma, key)).find(
                  (row) => row.status !== "cancelled",
                );
                await force(prisma, live!.id, step.to);
                model.set(key, step.to);
              }
            }
            // 每一步之后对账：这个主体的两个键，库里未取消的行与模型一致（有即恰一行）
            for (const kind of [plain, revivable]) {
              const key = timerKey(kind, subject);
              const live = (await timerRows(prisma, key)).filter(
                (row) => row.status !== "cancelled",
              );
              expect(live.map((row) => row.status)).toEqual(model.has(key) ? [model.get(key)] : []);
            }
          }
        }),
        runs,
      );
    },
    SLOW,
  );
});
