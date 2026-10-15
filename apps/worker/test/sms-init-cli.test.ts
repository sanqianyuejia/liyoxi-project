import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createClock, createFactories, useSeededDatabase } from "@liyoxi/services/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runSmsInitCommand } from "../src/cli/sms-init-command.js";

const db = useSeededDatabase("worker", { label: "smsinit" });
const dir = mkdtempSync(join(tmpdir(), "lyx-w222-sms-init-"));
const workerDir = fileURLToPath(new URL("../", import.meta.url));
const buildDir = join("dist", `sms-init-test-${randomUUID()}`);
const builtEntry = join(buildDir, "sms-init.js");
const execute = promisify(execFile);
const fields: Record<string, string[]> = {
  verify_code: ["code"],
  review_result: ["result", "reason"],
  sample_pending: ["item"],
  launch_remind: ["date", "channel", "drama"],
  plan_expiring: ["plan", "expiry_date", "points"],
  offline_remind: ["drama", "offline_date"],
  generic_todo: ["item"],
  account_notice: [],
  ops_alert: ["rule_name"],
};
const data = {
  templates: Object.entries(fields).map(([templateKey, names], i) => ({
    templateKey,
    kind: templateKey === "verify_code" ? "verify" : "notice",
    providerTemplateId: String(i + 1000),
    signName: "虚构测试平台",
    params: names.map((name) => ({ name, maxLen: 6 })),
    status: "active",
    approval: { templateApproved: true, signApproved: true, reference: "fictional-test-approval" },
  })),
};
const file = (name: string, text: string) => {
  const path = join(dir, name);
  writeFileSync(path, text);
  return path;
};
const valid = file("valid.json", JSON.stringify(data));
let source: Record<string, string | undefined>;
let staffId: string;
beforeAll(async () => {
  // 不借用其他测试或 CI job 的 dist，也不清理它们的构建产物。
  await execute(process.execPath, ["scripts/build.mjs", "--outdir", buildDir], {
    cwd: workerDir,
    timeout: 60_000,
    maxBuffer: 2_097_152,
  });
  const prisma = await db.prisma();
  const staff = await createFactories({ db: prisma, clock: createClock() }).staff({
    staffRoleKey: "super_admin",
  });
  staffId = staff.id;
  source = { APP_ENV: "test", DATABASE_URL: await db.url(), REDIS_URL: process.env.REDIS_URL };
}, 60_000);
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  rmSync(join(workerDir, buildDir), { recursive: true, force: true });
});
async function run(argv: string[], env = source) {
  const lines: string[] = [];
  const code = await runSmsInitCommand({
    argv,
    source: env,
    out: (line) => lines.push(line),
    err: (line) => lines.push(line),
  });
  return { code, text: lines.join("\n") };
}
describe("短信初始化真实薄CLI与构建入口", () => {
  it("33位模板编号按配置错误退出1，未配置环境亦不能误报存储失败", async () => {
    const invalid = structuredClone(data);
    invalid.templates[0]!.providerTemplateId = "1".repeat(33);
    const path = file("long-template-id.json", JSON.stringify(invalid));
    const result = await run(["--config", path, "--staff-id", staffId], {});
    expect(result).toEqual({ code: 1, text: "短信配置不合固定清单或审批事实" });
    expect(result.text).not.toContain(path);
  });
  it("缺参数、非法文件/JSON/字段/大文件拒绝，不打印内容/文件路径", async () => {
    expect((await run([])).code).toBe(1);
    const secretMarker = "forbidden-private-marker";
    for (const path of [
      join(dir, "missing.json"),
      file("bad.json", secretMarker),
      file("unknown.json", JSON.stringify({ ...data, extra: secretMarker })),
      file("huge.json", "x".repeat(65537)),
    ]) {
      const result = await run(["--config", path, "--staff-id", staffId]);
      expect(result.code).toBe(1);
      expect(result.text).not.toContain(path);
      expect(result.text).not.toContain(secretMarker);
    }
  });
  it("环境错误退出2；stg无apply拒绝，普通员工服务拒绝", async () => {
    const args = ["--config", valid, "--staff-id", staffId];
    expect((await run(args, {})).code).toBe(2);
    const databaseFile = file("database.txt", source.DATABASE_URL!);
    const redisFile = file("redis.txt", source.REDIS_URL!);
    expect(
      (
        await run(args, {
          APP_ENV: "stg",
          DATABASE_URL_FILE: databaseFile,
          REDIS_URL_FILE: redisFile,
        })
      ).code,
    ).toBe(1);
    const prisma = await db.prisma();
    const normal = await createFactories({ db: prisma, clock: createClock() }).staff({
      phone: "13900099999",
    });
    expect((await run(["--config", valid, "--staff-id", normal.id])).code).toBe(1);
  }, 60_000);
  it("真实服务原子初始化成功与同值幂等，只打印数量", async () => {
    const args = ["--config", valid, "--staff-id", staffId];
    expect(await run(args)).toEqual({ code: 0, text: "短信模板初始化完成：变更 9 项" });
    expect(await run(args)).toEqual({ code: 0, text: "短信模板初始化完成：变更 0 项" });
    const prisma = await db.prisma();
    expect(
      await prisma.auditLog.count({
        where: { action: "notify.sms.init", jobName: "cli.sms-init" },
      }),
    ).toBe(9);
  }, 60_000);
  it("dist/sms-init.js为可执行新入口，非法参数退出1", () => {
    let code = 0;
    try {
      execFileSync(process.execPath, [builtEntry], {
        cwd: new URL("../", import.meta.url),
        encoding: "utf8",
        stdio: "pipe",
        env: { PATH: process.env.PATH },
      });
    } catch (error) {
      code = (error as { status: number }).status;
      expect(String((error as { stderr: string }).stderr)).toContain("短信初始化参数不合规");
    }
    expect(code).toBe(1);
  });
  it("实际dist入口先拒绝33位模板编号，再加载环境", () => {
    const invalid = structuredClone(data);
    invalid.templates[0]!.providerTemplateId = "1".repeat(33);
    const path = file("dist-long-template-id.json", JSON.stringify(invalid));
    let code = 0;
    try {
      execFileSync(process.execPath, [builtEntry, "--config", path, "--staff-id", staffId], {
        cwd: new URL("../", import.meta.url),
        encoding: "utf8",
        stdio: "pipe",
        timeout: 5000,
        env: { PATH: process.env.PATH },
      });
    } catch (error) {
      code = (error as { status: number }).status;
      expect(String((error as { stderr: string }).stderr)).toContain(
        "短信配置不合固定清单或审批事实",
      );
    }
    expect(code).toBe(1);
  });
});
