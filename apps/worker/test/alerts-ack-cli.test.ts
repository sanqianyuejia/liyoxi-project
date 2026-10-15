import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { createFlowOpsCliSupport, useSeededDatabase } from "@liyoxi/services/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runAlertsAckCommand } from "../src/cli/alerts-ack-command.js";

const db = useSeededDatabase("worker", { label: "alertscli" });
const execute = promisify(execFile);
const workerDir = fileURLToPath(new URL("../", import.meta.url));
const buildDir = join("dist", `alerts-ack-test-${randomUUID()}`);
const builtEntry = join(buildDir, "alerts-ack.js");
const id = "00000000-0000-4000-8000-000000000001";
const note = "核对后受限人工处理";
const args = (staff: string, target: string) => [
  "ack",
  "--staff",
  staff,
  "--alert-id",
  target,
  "--note",
  note,
];

async function run(
  argv: string[],
  source: Record<string, string | undefined>,
  signal?: AbortSignal,
) {
  const out: string[] = [],
    err: string[] = [];
  const code = await runAlertsAckCommand({
    argv,
    source,
    ...(signal ? { signal } : {}),
    out: (line) => out.push(line),
    err: (line) => err.push(line),
  });
  return { code, out, err, text: [...out, ...err].join("\n") };
}

describe("W223 alerts-ack薄壳", { timeout: 120000 }, () => {
  it("严格单命令/单对象/员工/原因校验在读环境和密钥前完成，取消亦不读环境", async () => {
    let reads = 0;
    const source = Object.defineProperty({}, "DATABASE_URL", {
      get: () => {
        reads++;
        throw new Error("fictional-secret");
      },
    });
    const valid = args(id, id);
    const invalid = [
      [],
      ["--all"],
      ["delete", ...valid.slice(1)],
      [...valid, "close"],
      [...valid, "--staff", id],
      [...valid, "--all"],
      [...valid, "--webhook-event-id", id],
      ["reset-webhook", ...valid.slice(1)],
      ["ack", "--staff", id, "--alert-id", id],
      args("invalid-id", id),
      args(id, "invalid-id"),
      [...valid.slice(0, -1), "短"],
      [...valid.slice(0, -1), "字".repeat(201)],
    ];
    for (const argv of invalid) {
      const result = await run(argv, source);
      expect(result.code).toBe(1);
      expect(result.out).toEqual([]);
      expect(result.text).toMatch(/^用法：alerts-ack/);
      expect(result.text).not.toContain("fictional-secret");
    }
    const controller = new AbortController();
    controller.abort();
    expect(await run(valid, source, controller.signal)).toEqual({
      code: 1,
      out: [],
      err: ["流程运维取消"],
      text: "流程运维取消",
    });
    expect(reads).toBe(0);
  });

  it("环境错误退出2，不回显环境值/原因正文", async () => {
    const result = await run(args(id, id), {
      APP_ENV: "test",
      DATABASE_URL: "fictional-db-secret",
      REDIS_URL: "fictional-redis-secret",
    });
    expect(result).toEqual({
      code: 2,
      out: [],
      err: ["流程运维环境不可用"],
      text: "流程运维环境不可用",
    });
  });
});

describe("W223 alerts-ack真实应用角色/构建入口", { timeout: 120000 }, () => {
  let support: ReturnType<typeof createFlowOpsCliSupport>;
  let source: Record<string, string | undefined>;
  beforeAll(async () => {
    support = createFlowOpsCliSupport(await db.prisma());
    source = { APP_ENV: "test", DATABASE_URL: await db.url(), REDIS_URL: process.env.REDIS_URL };
    await execute(process.execPath, ["scripts/build.mjs", "--outdir", buildDir], {
      cwd: workerDir,
      timeout: 60000,
      maxBuffer: 2 * 1024 * 1024,
    });
  }, 180000);
  afterAll(() => rmSync(join(workerDir, buildDir), { recursive: true, force: true }));

  it("真实ack只输出三个安全字段，重复认领退出1；实际审计身份/原因正确", async () => {
    const staff = await support.make.staff({ staffRoleKey: "finance", isLead: true });
    const row = await support.alert();
    const first = await run(args(staff.id, row.id), source);
    expect(first).toEqual({
      code: 0,
      out: [JSON.stringify({ command: "ack", targetId: row.id, status: "acked" })],
      err: [],
      text: JSON.stringify({ command: "ack", targetId: row.id, status: "acked" }),
    });
    const second = await run(args(staff.id, row.id), source);
    expect(second.code).toBe(1);
    expect(second.out).toEqual([]);
    expect(second.err).toEqual(["流程运维拒绝：STATE_NOT_ALLOWED"]);
    const prisma = await db.prisma();
    const audit = await prisma.auditLog.findMany({ where: { targetId: row.id } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorType: "staff",
      actorId: staff.id,
      client: "cli",
      action: "ops.alert.acknowledge",
      reasonText: note,
      sessionId: null,
      authMethod: null,
      jobName: "cli.alerts.ack",
    });
    for (const secret of [staff.id, note, new URL(source.DATABASE_URL ?? "").password])
      expect(first.text + second.text).not.toContain(secret);
  });

  it("built dist实际close/reset-webhook正常退出关连接，不重发回调事件", async () => {
    const staff = await support.make.staff({ staffRoleKey: "super_admin" });
    const alert = await support.alert(),
      webhook = await support.webhook();
    const prisma = await db.prisma(),
      events = await prisma.outboxEvent.count();
    for (const [command, target, flag, status] of [
      ["close", alert.id, "--alert-id", "resolved"],
      ["reset-webhook", webhook.id, "--webhook-event-id", "received"],
    ] as const) {
      const result = await execute(
        process.execPath,
        [builtEntry, command, "--staff", staff.id, flag, target, "--note", note],
        { cwd: workerDir, env: source, timeout: 20000, maxBuffer: 1024 * 1024 },
      );
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout)).toEqual({ command, targetId: target, status });
    }
    expect((await prisma.alertEvent.findUniqueOrThrow({ where: { id: alert.id } })).status).toBe(
      "resolved",
    );
    expect(
      await prisma.webhookEvent.findUniqueOrThrow({ where: { id: webhook.id } }),
    ).toMatchObject({
      processState: "received",
      attempts: 0,
      error: webhook.error,
      payloadDigest: webhook.payloadDigest,
    });
    expect(await prisma.outboxEvent.count()).toBe(events);
    expect(
      await prisma.auditLog.count({
        where: { targetId: { in: [alert.id, webhook.id] }, actorId: staff.id, client: "cli" },
      }),
    ).toBe(2);
  });

  it("真实无权限退出1且无变更/审计，built参数错误不碰环境并正常退出", async () => {
    const staff = await support.make.staff({ staffRoleKey: "editor" }),
      row = await support.alert();
    const denied = await run(args(staff.id, row.id), source);
    expect(denied.code).toBe(1);
    expect(denied.out).toEqual([]);
    expect(denied.err).toEqual(["流程运维拒绝：PERMISSION_DENIED"]);
    const prisma = await db.prisma();
    expect((await prisma.alertEvent.findUniqueOrThrow({ where: { id: row.id } })).status).toBe(
      "open",
    );
    expect(await prisma.auditLog.count({ where: { targetId: row.id } })).toBe(0);
    try {
      await execute(process.execPath, [builtEntry, "--all"], {
        cwd: workerDir,
        env: { DATABASE_URL: "fictional-db-secret" },
        timeout: 20000,
      });
      throw new Error("invalid CLI unexpectedly succeeded");
    } catch (error) {
      expect(error).toMatchObject({
        code: 1,
        stdout: "",
        stderr: expect.stringMatching(/^用法：alerts-ack/),
      });
      expect(String(error)).not.toContain("fictional-db-secret");
    }
  });
});
