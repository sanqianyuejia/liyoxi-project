#!/usr/bin/env node
// 默认真实规模；不给任意目标URL/阈值开关，测试库只由 owned services 前置创建。
import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
export const P95_LIMIT_MS = 500;
export function settings(args) {
  const { values } = parseArgs({
    args,
    options: {
      concurrency: { type: "string", default: "20" },
      scale: { type: "string", default: "10" },
      seed: { type: "string", default: "42" },
      samples: { type: "string", default: "100" },
      out: { type: "string", default: "apps/api/dist/p95/report.json" },
    },
  });
  const result = {
    concurrency: Number(values.concurrency),
    scale: Number(values.scale),
    seed: Number(values.seed),
    samples: Number(values.samples),
    out: values.out,
  };
  if (
    !Number.isInteger(result.concurrency) ||
    result.concurrency < 1 ||
    result.concurrency > 20 ||
    !Number.isFinite(result.scale) ||
    result.scale < 0.002 ||
    result.scale > 10 ||
    !Number.isInteger(result.seed) ||
    result.seed < 0 ||
    result.seed > 0xffffffff ||
    !Number.isInteger(result.samples) ||
    result.samples < 20 ||
    result.samples > 1000
  )
    throw new Error("P95参数超出有界范围");
  return result;
}
export function percentile(samples, fraction = 0.95) {
  if (samples.length === 0) throw new Error("空样本不能报告P95");
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * fraction) - 1];
}
export async function measure(request, { concurrency, samples }) {
  const times = [],
    errors = {};
  let cursor = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      for (;;) {
        const index = cursor++;
        if (index >= samples) return;
        const started = performance.now();
        try {
          await request(index);
        } catch (error) {
          const symbol =
            error instanceof Error && /^[A-Z_]+$/.test(error.message)
              ? error.message
              : "REQUEST_FAILED";
          errors[symbol] = (errors[symbol] ?? 0) + 1;
        }
        times.push(performance.now() - started);
      }
    }),
  );
  const failures = Object.values(errors).reduce((a, b) => a + b, 0),
    p95Ms = percentile(times);
  return {
    samples: times.length,
    failures,
    errorRate: failures / times.length,
    p95Ms,
    p50Ms: percentile(times, 0.5),
    p90Ms: percentile(times, 0.9),
    distribution: Object.fromEntries(
      [
        [0, 50],
        [50, 100],
        [100, 250],
        [250, 500],
        [500, 1000],
        [1000, Infinity],
      ].map(([from, to]) => [
        `${from}_${to === Infinity ? "plus" : to}`,
        times.filter((ms) => ms > from && ms <= to).length,
      ]),
    ),
    maxMs: Math.max(...times),
    errors,
    passed: failures === 0 && p95Ms <= P95_LIMIT_MS,
  };
}
export function reportPassed(report) {
  return (
    report.routes.length > 0 &&
    report.routes.every(
      (route) => route.samples >= 20 && route.failures === 0 && route.p95Ms <= P95_LIMIT_MS,
    )
  );
}
async function main() {
  const config = settings(process.argv.slice(2));
  if (process.env.APP_ENV !== "test") throw new Error("P95只在APP_ENV=test隔离库执行");
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const child = spawn(
    "pnpm",
    [
      "--filter",
      "@liyoxi/services",
      "exec",
      "tsx",
      "../../apps/api/test/p95/run.ts",
      ...process.argv.slice(2),
    ],
    { cwd: root, stdio: "inherit", env: process.env },
  );
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (value) => resolve(value ?? 1));
  });
  process.exitCode = code;
  void config;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  main().catch(() => {
    console.error("P95基线失败：配置、前置或真实请求未通过（详情见脱敏报告）");
    process.exitCode = 1;
  });
