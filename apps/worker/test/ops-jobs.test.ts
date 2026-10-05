import { useSeededDatabase, useTestRedis } from "@liyoxi/services/testing";
import { beforeAll, describe, expect, it } from "vitest";

import { recurringTable } from "../src/recurring.js";
import { createHarness, SLOW, until } from "./support/harness.js";
import type { Harness } from "./support/harness.js";

// W0-24 任务书 第 7 节验收 8：真实装配里的三个周期任务（invariant.full、invariant.quick、ops.retention）
// 由补登记循环建行，到点由扫描循环认领、队列的处理器执行，摘要写进定时器行。
// 库是带种子的：不变量在上面跑出来 0 违规。别的用例的实例缺省不带这三个任务（support/instance.ts）。

const OPS_JOBS: readonly string[] = ["invariant.full", "invariant.quick", "ops.retention"];
/** 只看本包的三个：ops 以后还会登记别的周期任务（证书检查、备份） */
const isOpsJob = (job: { kind: string }): boolean => OPS_JOBS.includes(job.kind);
const db = useSeededDatabase("worker");
const redis = useTestRedis();
let h: Harness;

beforeAll(async () => {
  h = await createHarness(db, redis);
}, SLOW);

interface FiredRow {
  kind: string;
  result: Record<string, unknown>;
}

const fired = (): Promise<FiredRow[]> =>
  h.prisma.$queryRawUnsafe<FiredRow[]>(
    `SELECT kind, result FROM timer
      WHERE kind = ANY($1::text[]) AND subject_type IS NULL AND status = 'fired'
      ORDER BY kind, dedupe_key`,
    [...OPS_JOBS],
  );

describe("ops 的三个周期任务经任务进程跑", () => {
  it(
    "登记表里有它们（节奏、模式、完成期限、漏跑级别照 x01 第 4.2 节与 D7 第 7.6 节）；别的用例的实例里没有",
    async () => {
      const worker = await h.instance({ realRecurring: true });
      expect(recurringTable(worker.services).filter(isOpsJob)).toEqual([
        {
          kind: "invariant.full",
          module: "ops",
          schedule: { every: "day", at: "03:30" },
          mode: "job",
          deadlineMin: 180,
          missSeverity: "P2",
          catchUp: true,
        },
        {
          kind: "invariant.quick",
          module: "ops",
          schedule: { every: "minutes", minutes: 10 },
          mode: "job",
          deadlineMin: 30,
          missSeverity: "P2",
          catchUp: false,
        },
        {
          kind: "ops.retention",
          module: "ops",
          schedule: { every: "hour" },
          mode: "tx",
          deadlineMin: undefined,
          missSeverity: "P3",
          catchUp: true,
        },
      ]);
      const plain = await h.instance();
      expect(recurringTable(plain.services).filter(isOpsJob)).toEqual([]);
    },
    SLOW,
  );

  it(
    "补登记建行，到点执行：不变量在带种子的库上 0 违规，运行行落库；清理的结果写在定时器行上",
    async () => {
      const worker = await h.instance({ realRecurring: true });
      worker.runtime.start();
      await until(
        "三个周期任务各有一期执行完",
        async () => {
          const kinds = new Set((await fired()).map((row) => row.kind));
          return OPS_JOBS.every((kind) => kinds.has(kind));
        },
        async () => Promise.all(OPS_JOBS.map((kind) => h.slots(kind))),
      );
      await worker.runtime.stop();

      const rows = await fired();
      for (const mode of ["full", "quick"] as const) {
        const results = rows.filter((row) => row.kind === `invariant.${mode}`);
        for (const { result } of results) {
          expect(result).toMatchObject({ violationsFound: 0, created: 0, autoClosed: 0 });
          expect(typeof result.runId).toBe("string");
        }
        const runs = await h.prisma.$queryRawUnsafe<{ id: string; checks: number }[]>(
          `SELECT id::text AS id, checks_run AS checks FROM invariant_run
            WHERE mode = $1::text AND trigger = 'schedule' AND status = 'succeeded'`,
          mode,
        );
        expect(runs.map((run) => run.id)).toEqual(
          expect.arrayContaining(results.map(({ result }) => result.runId)),
        );
        // full 跑到了真实模块登记的检查项；现在还没有登记 quick 的检查项
        if (mode === "full") expect(Math.min(...runs.map((run) => run.checks))).toBeGreaterThan(0);
      }
      for (const { result } of rows.filter((row) => row.kind === "ops.retention")) {
        expect(result).toMatchObject({
          rows: { "kernel.idempotency_record": expect.any(Number) },
          failed: {},
        });
      }
      const [{ n }] = await h.prisma.$queryRawUnsafe<[{ n: number }]>(
        "SELECT count(*)::int AS n FROM invariant_violation",
      );
      expect(n).toBe(0);
    },
    SLOW,
  );
});
