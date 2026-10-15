import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createAnalyticsCliSupport, useSeededDatabase } from "@liyoxi/services/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runAnalyticsRepartitionCommand } from "../src/cli/analytics-repartition-command.js";

const db = useSeededDatabase("worker", { label: "analyticscli" });
const execute = promisify(execFile),
  workerDir = fileURLToPath(new URL("../", import.meta.url));
const buildDir = join("dist", `analytics-repartition-test-${randomUUID()}`);
const builtEntry = join(buildDir, "analytics-repartition.js");
const id = "00000000-0000-4000-8000-000000000001";
const args = (staff = id, month = "2026-10") => [
  month,
  "--env",
  "test",
  "--staff",
  staff,
  "--note",
  "核对后修复本月分区",
];
async function run(
  argv: string[],
  source: Record<string, string | undefined>,
  signal?: AbortSignal,
) {
  const out: string[] = [],
    err: string[] = [];
  const code = await runAnalyticsRepartitionCommand({
    argv,
    source,
    ...(signal ? { signal } : {}),
    out: (line) => out.push(line),
    err: (line) => err.push(line),
  });
  return { code, out, err };
}
describe("analytics_repartition薄CLI", () => {
  it("严格单月/环境/员工/原因在环境或IO前拒绝，重复选项与预取消亦拒绝", async () => {
    let reads = 0;
    const source = Object.defineProperty({}, "DATABASE_URL", {
      get: () => {
        reads++;
        throw new Error("fictional-secret");
      },
    });
    const valid = args();
    for (const argv of [
      [],
      ["--all"],
      args(id, "0000-01"),
      args(id, "2026-13"),
      args(id, "2026-1"),
      args("bad"),
      [...valid, "2026-11"],
      [...valid, "--staff", id],
      [...valid, "--all"],
      [...valid.slice(0, -1), "短"],
      [...valid.slice(0, -1), "字".repeat(201)],
      valid.filter((_, n) => n !== 1 && n !== 2),
      [valid[0]!, "--env", "production", ...valid.slice(3)],
    ]) {
      const result = await run(argv, source);
      expect(result.code).toBe(1);
      expect(result.out).toEqual([]);
      expect(result.err.join()).toMatch(/^用法：analytics-repartition/);
    }
    const controller = new AbortController();
    controller.abort();
    expect(await run(valid, source, controller.signal)).toEqual({
      code: 1,
      out: [],
      err: ["埋点分区修复取消"],
    });
    expect(reads).toBe(0);
  });
  it("环境不可用退出2且不回显连接值，显式环境不匹配拒绝在runtime前", async () => {
    expect(
      await run(args(), {
        APP_ENV: "test",
        DATABASE_URL: "fictional-secret",
        REDIS_URL: "fictional-secret",
      }),
    ).toEqual({ code: 2, out: [], err: ["埋点分区修复环境不可用"] });
    expect(
      await run(args(), {
        APP_ENV: "local",
        DATABASE_URL: process.env.DATABASE_URL,
        REDIS_URL: process.env.REDIS_URL,
      }),
    ).toEqual({ code: 1, out: [], err: ["埋点分区修复拒绝：环境不匹配"] });
  });
});
describe("analytics_repartition实际应用角色与构建入口", { timeout: 120_000 }, () => {
  let support: ReturnType<typeof createAnalyticsCliSupport>;
  let source: Record<string, string | undefined>;
  beforeAll(async () => {
    support = createAnalyticsCliSupport(await db.prisma());
    source = { APP_ENV: "test", DATABASE_URL: await db.url(), REDIS_URL: process.env.REDIS_URL };
    await execute(process.execPath, ["scripts/build.mjs", "--outdir", buildDir], {
      cwd: workerDir,
      timeout: 60_000,
      maxBuffer: 2_097_152,
    });
  });
  afterAll(() => rmSync(join(workerDir, buildDir), { recursive: true, force: true }));
  it("超级管理员真实单月搬移、完整列不变、重复无丢重；原审核失败不写审计", async () => {
    const prisma = await db.prisma(),
      admin = await support.make.staff({ staffRoleKey: "super_admin" });
    const denied = await support.make.staff({ staffRoleKey: "content_ops" });
    const event = await support.event(),
      before = await support.exactRow(event);
    expect(await support.inDefault(event)).toHaveLength(1);
    const refusal = await run(args(denied.id, support.month), source);
    expect(refusal.code).toBe(1);
    expect(refusal.err).toEqual(["埋点分区修复拒绝：PERMISSION_DENIED"]);
    expect(await support.inDefault(event)).toHaveLength(1);
    expect(await run(args(admin.id, support.month), source)).toEqual({
      code: 0,
      out: [JSON.stringify({ month: support.month, moved: "1" })],
      err: [],
    });
    expect(await run(args(admin.id, support.month), source)).toEqual({
      code: 0,
      out: [JSON.stringify({ month: support.month, moved: "0" })],
      err: [],
    });
    expect(await support.inDefault(event)).toEqual([]);
    expect(await support.exactRow(event)).toEqual(before);
    expect(
      await prisma.auditLog.count({
        where: { action: "analytics.partition.repartition", actorId: admin.id, client: "cli" },
      }),
    ).toBe(2);
  });
  it("dist入口真实执行，非法月份只出用法、合法重复确为服务返回结果", async () => {
    const admin = await support.make.staff({ staffRoleKey: "super_admin" });
    const result = await execute(process.execPath, [builtEntry, ...args(admin.id, support.month)], {
      cwd: workerDir,
      env: { ...process.env, ...source },
      timeout: 30_000,
      maxBuffer: 262_144,
    });
    expect(result.stdout.trim()).toBe(JSON.stringify({ month: support.month, moved: "0" }));
    expect(result.stderr).toBe("");
    const invalid = await execute(process.execPath, [builtEntry, ...args(admin.id, "2026-13")], {
      cwd: workerDir,
      env: { ...process.env, ...source },
      timeout: 30_000,
      maxBuffer: 262_144,
    }).then(
      () => null,
      (error) => error as { code: number; stdout: string; stderr: string },
    );
    expect(invalid?.code).toBe(1);
    expect(invalid?.stdout).toBe("");
    expect(invalid?.stderr).toMatch(/^用法：analytics-repartition/);
  });
});
