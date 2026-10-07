import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { measure, percentile, reportPassed, settings } from "../p95.mjs";
import { repoRoot } from "./helpers.js";
describe("P95真实样本边界", () => {
  it("默认20/10/42与500ms，拒任意目标、可放松阈值/无效规模", () => {
    expect(settings([])).toMatchObject({ concurrency: 20, scale: 10, seed: 42, samples: 100 });
    for (const args of [
      ["--url", "https://example.com"],
      ["--threshold", "99999"],
      ["--concurrency", "21"],
      ["--scale", "0"],
      ["--seed", "NaN"],
    ])
      expect(() => settings(args)).toThrow();
    expect(() => percentile([])).toThrow();
    expect(percentile(Array.from({ length: 100 }, (_, n) => n + 1))).toBe(95);
  });
  it("有界并发/全部实际请求，错误率与500ms超限都失败，无空样本绿色", async () => {
    let active = 0,
      max = 0,
      calls = 0;
    const result = await measure(
      async (n: number) => {
        active++;
        max = Math.max(max, active);
        calls++;
        await new Promise((r) => setTimeout(r, 1));
        active--;
        if (n === 7) throw new Error("UNAVAILABLE");
      },
      { concurrency: 3, samples: 20 },
    );
    expect(max).toBe(3);
    expect(Object.values(result.distribution).reduce((n, v) => n + v, 0)).toBe(20);
    expect(result.p50Ms).toBeLessThanOrEqual(result.p90Ms);
    expect(result.p90Ms).toBeLessThanOrEqual(result.p95Ms);
    expect(calls).toBe(20);
    expect(result).toMatchObject({
      samples: 20,
      failures: 1,
      errorRate: 0.05,
      passed: false,
      errors: { UNAVAILABLE: 1 },
    });
    expect(reportPassed({ routes: [] })).toBe(false);
    expect(reportPassed({ routes: [{ samples: 20, failures: 0, p95Ms: 500.01 }] })).toBe(false);
    expect(reportPassed({ routes: [{ samples: 20, failures: 0, p95Ms: 500 }] })).toBe(true);
    const slow = await measure(() => new Promise((r) => setTimeout(r, 510)), {
      concurrency: 20,
      samples: 20,
    });
    expect(slow.passed).toBe(false);
  });
  it("独立nightly准备完整、真实默认参数、失败不吞、artifact always且缺报告报错", () => {
    const nightly = readFileSync(join(repoRoot, ".github/workflows/nightly.yml"), "utf8");
    const p95 = nightly.slice(nightly.indexOf("\n  p95:\n"));
    expect(p95).toContain("timeout-minutes: 30");
    expect(p95).toContain("node-version: 24");
    for (const step of [
      "pnpm install --frozen-lockfile",
      "pnpm db:generate",
      "up -d --wait postgres redis",
      "APP_ENV=test",
      "DATABASE_URL=postgresql://liyoxi:lyx-local-dev@localhost:5442/liyoxi",
      "REDIS_URL=redis://localhost:6389/0",
      "node infra/ci/p95.mjs --concurrency 20 --scale 10 --seed 42",
      "if: always()",
      "path: apps/api/dist/p95/report.json",
      "if-no-files-found: error",
    ])
      expect(p95).toContain(step);
    expect(p95).not.toMatch(/continue-on-error|\|\| true|required:/);
  });
});
