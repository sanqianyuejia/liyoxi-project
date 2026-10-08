import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { repoRoot } from "./helpers.js";

describe("P95 nightly 接线", () => {
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
      "pnpm exec vitest run --project infra infra/ci/test/p95.test.ts infra/ci/test/workflows.test.ts infra/ci/test/p95-nightly.test.ts",
      "node infra/ci/p95.mjs --concurrency 20 --scale 10 --seed 42",
      "if: always()",
      "path: apps/api/dist/p95/report.json",
      "if-no-files-found: error",
    ])
      expect(p95).toContain(step);
    expect(p95).not.toMatch(/continue-on-error|\|\| true|required:/);
  });
});
