import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { makeTempDir, repoRoot, writeFiles } from "./helpers.js";

// 汇总任务 required 的脚本：判定必过任务的结论，统计耗时（W0-03 任务书 第 7 节第 5、9 条）。

const script = join(repoRoot, "infra/ci/ci-required.mjs");

interface ApiJob {
  name: string;
  started_at: string | null;
  completed_at: string | null;
}
const job = (name: string, start: string, end: string): ApiJob => ({
  name,
  started_at: `2026-10-04T06:${start}Z`,
  completed_at: `2026-10-04T06:${end}Z`,
});
const JOBS: ApiJob[] = [
  job("verify", "00:10", "07:40"),
  job("gate-classify", "00:12", "00:42"),
  { name: "required", started_at: "2026-10-04T06:07:45Z", completed_at: null },
  job("node26", "00:00", "30:00"),
];
const ok = { verify: { result: "success" }, "gate-classify": { result: "success" } };

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

function required(needs: unknown, jobs: ApiJob[] | null = JOBS, args: string[] = []) {
  const temp = makeTempDir("lyx-required-");
  cleanups.push(temp.cleanup);
  writeFiles(temp.dir, { "summary.md": "" });
  if (jobs !== null) writeFiles(temp.dir, { "jobs.json": JSON.stringify({ jobs }) });
  const out = join(temp.dir, "ci-duration.json");
  const result = spawnSync(
    "node",
    [
      script,
      "--needs",
      typeof needs === "string" ? needs : JSON.stringify(needs),
      "--jobs",
      join(temp.dir, "jobs.json"),
      "--out",
      out,
      ...args,
    ],
    {
      cwd: temp.dir,
      encoding: "utf8",
      env: { ...process.env, GITHUB_STEP_SUMMARY: join(temp.dir, "summary.md") },
    },
  );
  return {
    status: result.status,
    output: `${result.stdout}\n${result.stderr}`,
    report: existsSync(out)
      ? (JSON.parse(readFileSync(out, "utf8")) as Record<string, unknown>)
      : null,
    summary: readFileSync(join(temp.dir, "summary.md"), "utf8"),
  };
}

describe("判定", () => {
  it("必过任务全部成功：通过", () => {
    const result = required(ok);
    expect(result.status).toBe(0);
    expect(result.output).toContain("required 通过");
  });

  it.each(["failure", "cancelled", "skipped"])("有任务的结论是 %s：失败", (conclusion) => {
    const result = required({ ...ok, verify: { result: conclusion } });
    expect(result.status).toBe(1);
    expect(result.output).toContain(`required 未通过：verify（${conclusion}）`);
  });

  it("--may-skip 里的任务可以被跳过（只在 PR 上跑的任务，推到 main 时）", () => {
    const needs = { ...ok, "gate-classify": { result: "skipped" } };
    expect(required(needs, JOBS, ["--may-skip", "gate-classify"]).status).toBe(0);
    expect(required(needs, JOBS, ["--may-skip", "none"]).status).toBe(1);
  });

  it("--may-skip 不放过失败", () => {
    const needs = { ...ok, "gate-classify": { result: "failure" } };
    expect(required(needs, JOBS, ["--may-skip", "gate-classify"]).status).toBe(1);
  });

  it("needs 是空的：用法错误（required 不能什么都不依赖）", () => {
    expect(required({}).status).toBe(2);
    expect(required("不是 JSON").status).toBe(2);
  });
});

describe("时长统计", () => {
  it("列出各必过任务的耗时与合计，写进摘要与 ci-duration.json；不含 required 自己与非必过任务", () => {
    const result = required(ok);
    expect(result.report).toEqual({
      budgetSeconds: 900,
      totalSeconds: 480,
      wallSeconds: 450,
      overBudget: false,
      jobs: [
        { name: "verify", result: "success", seconds: 450 },
        { name: "gate-classify", result: "success", seconds: 30 },
      ],
    });
    expect(result.summary).toContain("| verify | success | 7 分 30 秒 |");
    expect(result.summary).toContain("| 合计 | 全部通过 | 8 分 00 秒 |");
    expect(result.summary).not.toContain("node26");
    expect(result.summary).not.toContain("超出预算");
  });

  it("从最早开始到最晚结束超过 15 分钟：在摘要里标出，不阻断", () => {
    const slow = [job("verify", "00:00", "16:00"), job("gate-classify", "00:00", "00:30")];
    const result = required(ok, slow);
    expect(result.status).toBe(0);
    expect(result.summary).toContain("**超出预算**：跨度 16 分 00 秒 > 15 分 00 秒");
    expect(result.report?.overBudget).toBe(true);
  });

  it("任务并行跑：预算比的是跨度，不是各任务耗时之和。之和超过 15 分钟而跨度没超，不算超出", () => {
    const names = ["verify", "test", "test-infra", "web"];
    const parallel = names.map((name) => job(name, "00:10", "05:10"));
    const needs = Object.fromEntries(names.map((name) => [name, { result: "success" }]));
    const result = required(needs, parallel);
    expect(result.status).toBe(0);
    expect(result.report).toMatchObject({
      totalSeconds: 1200,
      wallSeconds: 300,
      overBudget: false,
    });
    expect(result.summary).toContain("| 合计 | 全部通过 | 20 分 00 秒 |");
    expect(result.summary).toContain("比的是跨度：从最早开始到最晚结束 5 分 00 秒");
    expect(result.summary).not.toContain("超出预算");
  });

  it("排队等执行机的时间算在跨度里：任务一个接一个跑完，跨度超了就标出", () => {
    const queued = [job("verify", "00:00", "08:00"), job("test", "08:30", "16:30")];
    const needs = { verify: { result: "success" }, test: { result: "success" } };
    const result = required(needs, queued);
    expect(result.report).toMatchObject({ totalSeconds: 960, wallSeconds: 990, overBudget: true });
    expect(result.summary).toContain("**超出预算**：跨度 16 分 30 秒 > 15 分 00 秒");
  });

  it("矩阵展开的任务按名字前缀归到一起", () => {
    const matrix = [job("verify (24)", "00:00", "02:00"), job("verify (26)", "00:00", "03:00")];
    const result = required({ verify: { result: "success" } }, matrix);
    expect(result.report?.totalSeconds).toBe(300);
    expect(result.report?.wallSeconds).toBe(180);
  });

  it("没拿到任务列表：照样判定，耗时记为未知", () => {
    const result = required(ok, null);
    expect(result.status).toBe(0);
    expect(result.report?.totalSeconds).toBeNull();
    expect(result.report?.overBudget).toBe(false);
    expect(result.summary).toContain("| verify | success | 未知 |");
    expect(result.summary).toContain("有任务没取到起止时间");
  });

  it("判定失败时统计照样写出", () => {
    const result = required({ ...ok, verify: { result: "failure" } });
    expect(result.status).toBe(1);
    expect(result.report?.jobs).toHaveLength(2);
    expect(result.summary).toContain("| verify | failure（未通过） |");
  });
});
