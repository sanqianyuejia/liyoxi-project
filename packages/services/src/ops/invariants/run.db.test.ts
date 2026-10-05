import type { PrismaClient } from "@liyoxi/db";
import { beforeAll, describe, expect, it } from "vitest";

import { createTxRunner, defineRegistration, invariantsOf, uuidv7 } from "../../kernel/index.js";
import type { InvariantScope, InvariantViolation, TxRunner } from "../../kernel/index.js";
import {
  assembleForTest,
  createClock,
  createFactories,
  useSeededDatabase,
} from "../../testing/index.js";
import { bindOps } from "../binding.js";
import { runInvariants } from "./run.js";
import { selectChecks } from "./select.js";
import { ABANDONED, AUTO_HEALED } from "./store.js";

// 任务书 第 7 节验收 1、2、3、5、6。连真库：带种子的库（迁移 + W0-21 的种子），身份是应用角色 lyx_app。
// 机器忙的时候建库慢：时限给足。

const SLOW = 180_000;
const MINUTE = 60_000;

const db = useSeededDatabase("services");
const clock = createClock();
let prisma: PrismaClient;
let tx: TxRunner;

beforeAll(async () => {
  prisma = await db.prisma();
  tx = createTxRunner({ prisma, appEnv: "test" });
}, SLOW);

interface ViolationRow {
  id: string;
  runId: string | null;
  code: string;
  module: string;
  severity: string;
  subjectType: string | null;
  subjectId: string | null;
  subjectKey: string | null;
  detail: Record<string, unknown>;
  firstSeenAt: Date;
  lastSeenAt: Date;
  autoHealedAt: Date | null;
  resolvedAt: Date | null;
  resolvedBy: string | null;
  resolution: string | null;
}

/** 某个检查项的全部违规行，按落库先后 */
const violations = (code: string): Promise<ViolationRow[]> =>
  prisma.$queryRawUnsafe<ViolationRow[]>(
    `SELECT id::text AS id, invariant_run_id::text AS "runId", code, module, severity,
            subject_type AS "subjectType", subject_id::text AS "subjectId", subject_key AS "subjectKey",
            detail, first_seen_at AS "firstSeenAt", last_seen_at AS "lastSeenAt",
            auto_healed_at AS "autoHealedAt", resolved_at AS "resolvedAt",
            resolved_by_staff_id::text AS "resolvedBy", resolution
       FROM invariant_violation WHERE code = $1::text ORDER BY id`,
    code,
  );

interface RunRow {
  mode: string;
  trigger: string;
  scope: Record<string, unknown> | null;
  status: string;
  startedAt: Date;
  finishedAt: Date | null;
  checksRun: number;
  violationsFound: number;
  error: string | null;
}

const runRow = async (id: string): Promise<RunRow> => {
  const [row] = await prisma.$queryRawUnsafe<RunRow[]>(
    `SELECT mode, trigger, scope, status, started_at AS "startedAt", finished_at AS "finishedAt",
            checks_run AS "checksRun", violations_found AS "violationsFound", error
       FROM invariant_run WHERE id = $1::uuid`,
    id,
  );
  if (row === undefined) throw new Error(`没有运行行 ${id}`);
  return row;
};

describe("真实装配：空库加种子（验收 1、2）", () => {
  const assembly = assembleForTest({ entry: "worker" });
  const deps = () => ({ tx, assembly, clock });

  it(
    "full 跑完 0 违规；执行的检查项里有 config 的六条与已登记的其余各条",
    async () => {
      const expected = selectChecks(assembly.invariants, { mode: "full", trigger: "manual" });
      expect(expected.map((check) => check.code)).toEqual(
        expect.arrayContaining([
          "audit.I2",
          "audit.I3",
          "config.N8",
          "config.N9",
          "config.N16",
          "config.N17",
          "config.N19",
          "config.N20",
          "events.I8",
          "flow.I12",
          "sla.N8",
          "staff.I8",
        ]),
      );

      const result = await runInvariants(deps(), { mode: "full", trigger: "manual" });
      expect(result.errors).toEqual([]);
      expect(result).toMatchObject({
        status: "succeeded",
        checksRun: expected.length,
        violationsFound: 0,
        created: 0,
        autoClosed: 0,
      });
      expect(await runRow(result.runId)).toMatchObject({
        mode: "full",
        trigger: "manual",
        scope: null,
        status: "succeeded",
        startedAt: clock.now(),
        finishedAt: clock.now(),
        checksRun: expected.length,
        violationsFound: 0,
        error: null,
      });
      const [{ n }] = await prisma.$queryRawUnsafe<[{ n: number }]>(
        "SELECT count(*)::int AS n FROM invariant_violation",
      );
      expect(n).toBe(0);
    },
    SLOW,
  );

  it(
    "人为造一条违规（没定义的参数键）：报出 config.N17；再跑不重复，只前移 last_seen_at；处理后再次发现新建一行",
    async () => {
      const make = createFactories({ db: prisma, clock });
      const staff = await make.staff();
      await prisma.paramValue.create({
        data: {
          id: uuidv7(),
          key: "lyxtest.no_such_param",
          value: 1,
          effectiveAt: new Date(clock.now().getTime() - MINUTE),
          createdByStaffId: staff.id,
          createdAt: clock.now(),
        },
      });

      const first = await runInvariants(deps(), { mode: "full", trigger: "manual" });
      expect(first).toMatchObject({ status: "succeeded", violationsFound: 1, created: 1 });
      const seenAt = clock.now();
      const [found, ...rest] = await violations("config.N17");
      expect(rest).toEqual([]);
      expect(found).toMatchObject({
        runId: first.runId,
        module: "config",
        severity: "P2",
        subjectType: null,
        subjectId: null,
        subjectKey: "lyxtest.no_such_param",
        firstSeenAt: seenAt,
        lastSeenAt: seenAt,
        autoHealedAt: null,
        resolvedAt: null,
      });
      expect(found?.detail).toEqual({ problem: expect.stringContaining("参数键没有定义") });

      clock.advance(10 * MINUTE);
      const second = await runInvariants(deps(), { mode: "full", trigger: "manual" });
      expect(second).toMatchObject({ status: "succeeded", violationsFound: 1, created: 0 });
      expect(await violations("config.N17")).toEqual([
        { ...found, lastSeenAt: clock.now(), firstSeenAt: seenAt, runId: first.runId },
      ]);
      expect((await runRow(second.runId)).violationsFound).toBe(1);

      // 人工处理（接口随后面的包；这里直接改行）之后违规还在：再次发现新建一行
      await prisma.$executeRawUnsafe(
        `UPDATE invariant_violation SET resolved_at = $2::timestamptz, resolved_by_staff_id = $3::uuid,
                resolution = '样例：已知，先留着' WHERE id = $1::uuid`,
        found?.id,
        clock.now(),
        staff.id,
      );
      clock.advance(10 * MINUTE);
      const third = await runInvariants(deps(), {
        mode: "full",
        trigger: "manual",
        codes: ["config.N17"],
      });
      expect(third).toMatchObject({ checksRun: 1, violationsFound: 1, created: 1 });
      const rows = await violations("config.N17");
      expect(rows.map((row) => [row.runId, row.resolvedAt === null])).toEqual([
        [first.runId, false],
        [third.runId, true],
      ]);
      expect((await runRow(third.runId)).scope).toEqual({ codes: ["config.N17"] });
    },
    SLOW,
  );

  it(
    "参数值不合定义：报出 config.N8，对象是参数键",
    async () => {
      const make = createFactories({ db: prisma, clock });
      const staff = await make.staff();
      await prisma.paramValue.create({
        data: {
          id: uuidv7(),
          key: "home.banner.max_active",
          value: "很多",
          effectiveAt: new Date(clock.now().getTime() + MINUTE),
          createdByStaffId: staff.id,
          createdAt: clock.now(),
        },
      });
      const result = await runInvariants(deps(), {
        mode: "full",
        trigger: "manual",
        codes: ["config.N8"],
      });
      expect(result).toMatchObject({ status: "succeeded", checksRun: 1, violationsFound: 1 });
      expect(await violations("config.N8")).toMatchObject([
        { subjectType: null, subjectKey: "home.banner.max_active", module: "config" },
      ]);
    },
    SLOW,
  );
});

describe("样例检查项：自愈策略、出错与中断（验收 3、5）", () => {
  // 违规行的 module 列只收 31 个模块名：样例登记借用 ops 的名字，不带真实模块（isolated）
  const state = {
    none: [] as InvariantViolation[],
    alert: [] as InvariantViolation[],
    only: [] as InvariantViolation[],
    quickScopes: [] as InvariantScope[],
    boom: false,
  };
  const BOOM_RUN_ID = uuidv7();
  const assembly = assembleForTest({
    entry: "worker",
    isolated: true,
    extra: [
      defineRegistration("ops", {
        invariants: [
          { code: "lyxtest.none", severity: "P1", modes: ["full"], run: async () => state.none },
          {
            code: "lyxtest.alert",
            severity: "P2",
            modes: ["full"],
            heal: "heal_and_alert",
            run: async () => state.alert,
          },
          {
            code: "lyxtest.only",
            severity: "P2",
            modes: ["full"],
            heal: "heal_only",
            run: async () => state.only,
          },
          {
            code: "lyxtest.boom",
            severity: "P2",
            modes: ["full"],
            run: async (handle) => {
              if (!state.boom) return [];
              // 先写一行再抛错：这一项的事务要整个回滚
              await handle.$executeRawUnsafe(
                `INSERT INTO invariant_run (id, mode, trigger, status, started_at)
                 VALUES ($1::uuid, 'full', 'manual', 'running', now())`,
                BOOM_RUN_ID,
              );
              throw new Error("样例：检查项坏了");
            },
          },
          {
            code: "lyxtest.quick",
            severity: "P2",
            modes: ["quick"],
            run: async (_handle, scope) => {
              state.quickScopes.push(scope);
              return [];
            },
          },
        ],
      }),
    ],
  });
  const full = (codes?: string[]) =>
    runInvariants(
      { tx, assembly, clock },
      { mode: "full", trigger: "manual", ...(codes === undefined ? {} : { codes }) },
    );

  it(
    "none：不认自愈；对象的三种写法与全局性违规各落各的列，entityId 进 detail；一批里同一对象只留一行",
    async () => {
      const entityId = uuidv7();
      const subjectId = uuidv7();
      state.none = [
        {
          subject: { type: "entity", id: subjectId },
          entityId,
          detail: { expected: 1, actual: 2 },
          healed: { action: "样例：不该被认", at: clock.now() },
        },
        { subject: { type: "work_calendar_day", key: "2026-01-01" }, detail: { n: 1 } },
        { subject: { type: "work_calendar_day", key: "2026-01-01" }, detail: { n: 2 } },
        { subject: { key: "lyxtest.global_key" }, detail: {} },
        { detail: { global: true } },
      ];
      const result = await full(["lyxtest.none"]);
      expect(result).toMatchObject({ status: "succeeded", violationsFound: 4, created: 4 });
      const rows = await violations("lyxtest.none");
      expect(
        rows.map((row) => [row.subjectType, row.subjectId, row.subjectKey, row.detail]),
      ).toEqual(
        expect.arrayContaining([
          ["entity", subjectId, null, { expected: 1, actual: 2, entityId }],
          ["work_calendar_day", null, "2026-01-01", { n: 2 }],
          [null, null, "lyxtest.global_key", {}],
          [null, null, null, { global: true }],
        ]),
      );
      expect(rows).toHaveLength(4);
      for (const row of rows) {
        expect(row).toMatchObject({
          module: "ops",
          severity: "P1",
          autoHealedAt: null,
          resolvedAt: null,
        });
      }
    },
    SLOW,
  );

  it(
    "heal_and_alert：自愈写 auto_healed_at，仍未解决；下一次没自愈即清空",
    async () => {
      const subject = { type: "store", id: uuidv7() };
      const healedAt = clock.now();
      state.alert = [
        { subject, detail: {}, healed: { action: "样例：重新推导状态", at: healedAt } },
      ];
      expect(await full(["lyxtest.alert"])).toMatchObject({ created: 1, autoClosed: 0 });
      expect(await violations("lyxtest.alert")).toMatchObject([
        {
          autoHealedAt: healedAt,
          resolvedAt: null,
          detail: { healed: { action: "样例：重新推导状态", at: healedAt.toISOString() } },
        },
      ]);

      clock.advance(MINUTE);
      state.alert = [{ subject, detail: { again: true } }];
      expect(await full(["lyxtest.alert"])).toMatchObject({ violationsFound: 1, created: 0 });
      expect(await violations("lyxtest.alert")).toMatchObject([
        { autoHealedAt: null, resolvedAt: null, detail: { again: true }, lastSeenAt: clock.now() },
      ]);
    },
    SLOW,
  );

  it(
    "heal_only：没愈成的照未解决写；愈成了关的是那一行；首次发现就愈成的直接落一行已关闭的；之后再出现新建一行",
    async () => {
      const stuck = { type: "timer", id: uuidv7() };
      const fresh = { type: "timer", id: uuidv7() };
      state.only = [{ subject: stuck, detail: { attempt: 1 } }];
      const first = await full(["lyxtest.only"]);
      expect(first).toMatchObject({ created: 1, autoClosed: 0 });
      const firstSeen = clock.now();

      clock.advance(MINUTE);
      const healedAt = clock.now();
      state.only = [
        {
          subject: stuck,
          detail: { attempt: 2 },
          healed: { action: "样例：补登记", at: healedAt },
        },
        { subject: fresh, detail: {}, healed: { action: "样例：补登记", at: healedAt } },
      ];
      const second = await full(["lyxtest.only"]);
      expect(second).toMatchObject({ violationsFound: 2, created: 0, autoClosed: 2 });
      const closed = await violations("lyxtest.only");
      expect(closed).toHaveLength(2);
      for (const row of closed) {
        expect(row).toMatchObject({
          autoHealedAt: healedAt,
          resolvedAt: healedAt,
          resolvedBy: null,
          resolution: AUTO_HEALED,
        });
      }
      // 原来那一行被关掉：首次发现的运行与时间不动
      expect(closed.find((row) => row.subjectId === stuck.id)).toMatchObject({
        runId: first.runId,
        firstSeenAt: firstSeen,
        detail: { attempt: 2 },
      });
      expect(closed.find((row) => row.subjectId === fresh.id)).toMatchObject({
        runId: second.runId,
      });

      clock.advance(MINUTE);
      state.only = [{ subject: stuck, detail: { attempt: 3 } }];
      expect(await full(["lyxtest.only"])).toMatchObject({ created: 1 });
      const rows = (await violations("lyxtest.only")).filter((row) => row.subjectId === stuck.id);
      expect(rows.map((row) => row.resolvedAt === null)).toEqual([false, true]);
    },
    SLOW,
  );

  it(
    "一个检查项抛错：只回滚它自己，别的照跑；运行记 failed 与错误摘要",
    async () => {
      state.none = [{ subject: { key: "lyxtest.with_boom" }, detail: {} }];
      state.alert = [];
      state.only = [];
      state.boom = true;
      try {
        const result = await full();
        expect(result).toMatchObject({ status: "failed", checksRun: 3, violationsFound: 1 });
        expect(result.errors).toEqual([
          { code: "lyxtest.boom", message: expect.stringContaining("样例：检查项坏了") },
        ]);
        expect(await runRow(result.runId)).toMatchObject({
          status: "failed",
          checksRun: 3,
          violationsFound: 1,
          finishedAt: clock.now(),
          error: expect.stringMatching(/^lyxtest\.boom：.*样例：检查项坏了/),
        });
        // 别的检查项的违规写进去了；抛错那一项事务里写的行没有留下
        expect(
          (await violations("lyxtest.none")).some((row) => row.subjectKey === "lyxtest.with_boom"),
        ).toBe(true);
        const [{ n }] = await prisma.$queryRawUnsafe<[{ n: number }]>(
          "SELECT count(*)::int AS n FROM invariant_run WHERE id = $1::uuid",
          BOOM_RUN_ID,
        );
        expect(n).toBe(0);
      } finally {
        state.boom = false;
      }
    },
    SLOW,
  );

  it(
    "中止信号：不再往下跑，运行记 failed",
    async () => {
      const abort = new AbortController();
      abort.abort();
      const result = await runInvariants(
        { tx, assembly, clock },
        { mode: "full", trigger: "schedule", scheduledFor: clock.now(), signal: abort.signal },
      );
      expect(result).toMatchObject({ status: "failed", checksRun: 0 });
      expect((await runRow(result.runId)).error).toContain("已中止");
    },
    SLOW,
  );

  it(
    "超过完成期限仍为 running 的行，下一次运行开始前标成中断；没过期限的不动",
    async () => {
      const startedAgo = (minutes: number): Date =>
        new Date(clock.now().getTime() - minutes * MINUTE);
      const insert = async (mode: string, startedAt: Date): Promise<string> => {
        const id = uuidv7();
        await prisma.$executeRawUnsafe(
          `INSERT INTO invariant_run (id, mode, trigger, status, started_at)
           VALUES ($1::uuid, $2::text, 'schedule', 'running', $3::timestamptz)`,
          id,
          mode,
          startedAt,
        );
        return id;
      };
      const staleFull = await insert("full", startedAgo(181));
      const liveFull = await insert("full", startedAgo(179));
      const staleQuick = await insert("quick", startedAgo(31));
      const liveQuick = await insert("quick", startedAgo(29));

      await full(["lyxtest.alert"]);
      for (const id of [staleFull, staleQuick]) {
        expect(await runRow(id)).toMatchObject({
          status: "failed",
          error: ABANDONED,
          finishedAt: clock.now(),
        });
      }
      for (const id of [liveFull, liveQuick]) {
        expect(await runRow(id)).toMatchObject({ status: "running", finishedAt: null });
      }
      // 收掉：后面的用例（quick 的起点）不受这两行影响
      await prisma.$executeRawUnsafe(
        "UPDATE invariant_run SET status = 'failed', error = 'lyxtest', finished_at = now() WHERE id = ANY($1::uuid[])",
        [liveFull, liveQuick],
      );
    },
    SLOW,
  );

  it(
    "quick 的起点：上一次成功的定时 quick 运行的开始时间；失败的、手工的不算；限定的主体原样传给检查项",
    async () => {
      const quick = (input: Partial<Parameters<typeof runInvariants>[1]> = {}) =>
        runInvariants(
          { tx, assembly, clock },
          { mode: "quick", trigger: "schedule", scheduledFor: clock.now(), ...input },
        );
      state.quickScopes.length = 0;
      const first = await quick();
      const firstAt = clock.now();
      expect(state.quickScopes).toEqual([{}]);
      expect((await runRow(first.runId)).scope).toBeNull();

      clock.advance(10 * MINUTE);
      const entityIds = [uuidv7()];
      await quick({ trigger: "manual", entityIds });
      // 一次失败的定时运行：起点不跟着前移
      const abort = new AbortController();
      abort.abort();
      await quick({ signal: abort.signal });

      clock.advance(10 * MINUTE);
      const third = await quick();
      expect(state.quickScopes).toEqual([{}, { entityIds }, { since: firstAt }]);
      expect((await runRow(third.runId)).scope).toEqual({ since: firstAt.toISOString() });
    },
    SLOW,
  );
});

describe("上报端口 invariants.report（验收 6）", () => {
  const assembly = assembleForTest({
    entry: "api",
    extra: [
      defineRegistration("lyxtest_ops_report", {
        invariants: [
          { code: "lyxtest.STUCK", severity: "P2", modes: [], heal: "heal_only" },
          { code: "lyxtest.DRIFT", severity: "P2", modes: [], heal: "heal_and_alert" },
        ],
      }),
    ],
  });
  const port = () => invariantsOf(assembly);

  it(
    "上报的行没有运行号；重复上报不重复；调用方在事务里、事务回滚，违规照样留下",
    async () => {
      const unbind = bindOps({ db: prisma, tx, clock, assembly });
      try {
        const subject = { type: "delivery_ticket", id: uuidv7() };
        const entityId = uuidv7();
        const probeId = uuidv7();
        await expect(
          tx.run(async (handle) => {
            await handle.$executeRawUnsafe(
              `INSERT INTO invariant_run (id, mode, trigger, status, started_at)
               VALUES ($1::uuid, 'full', 'manual', 'running', now())`,
              probeId,
            );
            await port().report({
              code: "lyxtest.PLAIN",
              module: "flow",
              severity: "P2",
              subject,
              entityId,
              detail: { stuckMinutes: 90 },
            });
            throw new Error("样例：业务事务回滚");
          }),
        ).rejects.toThrow("样例：业务事务回滚");
        const [{ n }] = await prisma.$queryRawUnsafe<[{ n: number }]>(
          "SELECT count(*)::int AS n FROM invariant_run WHERE id = $1::uuid",
          probeId,
        );
        expect(n).toBe(0);

        const seenAt = clock.now();
        clock.advance(MINUTE);
        await port().report({
          code: "lyxtest.PLAIN",
          module: "flow",
          severity: "P2",
          subject,
          entityId,
          detail: { stuckMinutes: 91 },
        });
        expect(await violations("lyxtest.PLAIN")).toMatchObject([
          {
            runId: null,
            module: "flow",
            subjectType: "delivery_ticket",
            subjectId: subject.id,
            detail: { stuckMinutes: 91, entityId },
            firstSeenAt: seenAt,
            lastSeenAt: clock.now(),
            resolvedAt: null,
          },
        ]);
      } finally {
        unbind();
      }
    },
    SLOW,
  );

  it(
    "按该编号登记的自愈策略写：heal_only 自愈即关闭，heal_and_alert 只记自愈时间",
    async () => {
      const unbind = bindOps({ db: prisma, tx, clock, assembly });
      try {
        const subject = { type: "delivery_ticket", id: uuidv7() };
        const healed = { action: "样例：已推进", at: clock.now() };
        await port().report({
          code: "lyxtest.STUCK",
          module: "flow",
          severity: "P2",
          subject,
          detail: {},
        });
        await port().report({
          code: "lyxtest.STUCK",
          module: "flow",
          severity: "P2",
          subject,
          detail: {},
          healed,
        });
        expect(await violations("lyxtest.STUCK")).toMatchObject([
          { resolvedAt: healed.at, autoHealedAt: healed.at, resolution: AUTO_HEALED, runId: null },
        ]);
        await port().report({
          code: "lyxtest.DRIFT",
          module: "delivery",
          severity: "P2",
          subject,
          detail: {},
          healed,
        });
        expect(await violations("lyxtest.DRIFT")).toMatchObject([
          { resolvedAt: null, autoHealedAt: healed.at, module: "delivery" },
        ]);
      } finally {
        unbind();
      }
    },
    SLOW,
  );

  it(
    "没绑运行时、或写库被约束拒掉：不抛给调用方，也不落行",
    async () => {
      const report = {
        code: "lyxtest.UNBOUND",
        module: "flow",
        severity: "P2",
        detail: {},
      } as const;
      await expect(port().report(report)).resolves.toBeUndefined();
      const unbind = bindOps({ db: prisma, tx, clock, assembly });
      try {
        // module 不在 31 个模块名里：库的 CHECK 拒掉
        await expect(
          port().report({ ...report, module: "lyxtest_nowhere" }),
        ).resolves.toBeUndefined();
      } finally {
        unbind();
      }
      expect(await violations("lyxtest.UNBOUND")).toEqual([]);
    },
    SLOW,
  );
});
