import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { describe, expect, it, vi } from "vitest";

import { createClock, createFakeStorage, createRecordingLogger } from "../testing/index.js";
import { createBackup } from "./backup.js";
import type { BackupConfig, BackupSpawn } from "./backup.js";

const config: BackupConfig = {
  readOnlyUrl: "postgresql://readonly:fake-only@localhost/lyx_test_backup",
  recipients: [`age1${"a".repeat(58)}`],
  bucket: "lyx-test-backup",
};
const fixtureSpawn = (failure?: "dump" | "age" | "version" | "hang") => {
  const children: ChildProcessWithoutNullStreams[] = [];
  const calls: Array<{
    command: string;
    args: readonly string[];
    env: NodeJS.ProcessEnv | undefined;
  }> = [];
  const launch: BackupSpawn = (command, args, options) => {
    calls.push({ command, args, env: options.env });
    // 此替身只验证管道控制，真实pg_dump17+age验证在backup.db.test的显式镜像模式。
    const script =
      command === "pg_dump" && args.includes("--version")
        ? `process.stdout.end('pg_dump (PostgreSQL) ${failure === "version" ? "14.1" : "17.6"}\\n')`
        : command === "pg_dump"
          ? failure === "dump"
            ? "process.stderr.write('secret-connection-marker');process.exit(3)"
            : failure === "hang"
              ? "setInterval(()=>process.stdout.write(Buffer.alloc(4096,42)),10)"
              : "process.stdout.end(Buffer.alloc(8192,42))"
          : failure === "age"
            ? "process.stderr.write('secret-age-marker');process.exit(4)"
            : "process.stdout.write('age-encryption.org/v1\\n');process.stdin.on('data',d=>process.stdout.write(d));process.stdin.on('end',()=>process.stdout.end())";
    const child = spawn(process.execPath, ["-e", script], {
      ...options,
      stdio: ["pipe", "pipe", "pipe"],
    });
    children.push(child);
    return child;
  };
  return { launch, calls, children };
};

describe("备份管道与失败边界", () => {
  it("替身同样在上游等待时遵守取消，不完成任何对象", async () => {
    const storage = createFakeStorage(),
      abort = new AbortController();
    let entered!: () => void;
    const waiting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const uploading = storage.backupPutStream({
      bucket: "lyx-test-backup",
      key: "pending",
      maxBytes: 1024,
      signal: abort.signal,
      body: {
        async *[Symbol.asyncIterator]() {
          entered();
          await new Promise<void>(() => {});
          yield new Uint8Array(0);
        },
      },
    });
    await waiting;
    abort.abort();
    expect(await uploading).toMatchObject({ ok: false, reason: "unavailable" });
    expect(storage.backupObjects.size).toBe(0);
  });
  it("未配置不启动子进程，不上传；不是假备份成功", async () => {
    const launch = vi.fn<BackupSpawn>();
    const result = await createBackup({
      storage: createFakeStorage(),
      clock: createClock(),
      spawn: launch,
    }).run();
    expect(result).toMatchObject({ ok: false, reason: "unconfigured" });
    expect(launch).not.toHaveBeenCalled();
  });
  it("以北京时间日键流式上传，仅月首条件复制；URL不进入argv或摘要", async () => {
    const storage = createFakeStorage();
    const fixture = fixtureSpawn();
    const result = await createBackup({
      config,
      storage,
      clock: createClock(new Date("2026-09-30T16:10:00Z")),
      spawn: fixture.launch,
    }).run();
    expect(result).toMatchObject({
      ok: true,
      value: {
        key: "backups/daily/2026-10-01.dump.age",
        monthlyKey: "backups/monthly/2026-10-01.dump.age",
        pgDumpVersion: "pg_dump (PostgreSQL) 17.6",
      },
    });
    expect(storage.callsOf("backupPutStream")).toHaveLength(1);
    expect(storage.callsOf("backupCopy")).toHaveLength(1);
    expect(storage.objects.size).toBe(0);
    expect(storage.backupObjects.size).toBe(2);
    expect(fixture.calls[1]?.args).toEqual(["-Fc", "--no-owner", "--no-password"]);
    expect(fixture.calls[1]?.env).toMatchObject({
      PGDATABASE: "lyx_test_backup",
      PGHOST: "localhost",
      PGUSER: "readonly",
    });
    expect(JSON.stringify(result)).not.toContain(config.readOnlyUrl);
    expect(JSON.stringify(fixture.calls.map((call) => call.args))).not.toContain(
      config.readOnlyUrl,
    );
  });
  it.each(["dump", "age"] as const)("%s失败中止上传，日志不泄露子进程原错误", async (failure) => {
    const fixture = fixtureSpawn(failure),
      storage = createFakeStorage(),
      logger = createRecordingLogger();
    const result = await createBackup({
      config,
      storage,
      clock: createClock(),
      logger,
      spawn: fixture.launch,
    }).run();
    expect(result.ok).toBe(false);
    expect(storage.backupObjects.size).toBe(0);
    expect(JSON.stringify(logger.lines)).not.toContain("secret-");
    await Promise.all(
      fixture.children.map((child) =>
        child.exitCode !== null || child.signalCode !== null
          ? undefined
          : new Promise((resolve) => child.once("close", resolve)),
      ),
    );
  });
  it("对象小于前次50%或HEAD缺失不记成功；非月首不复制", async () => {
    const storage = createFakeStorage(),
      fixture = fixtureSpawn();
    const backup = createBackup({
      config,
      storage,
      clock: createClock(new Date("2026-10-02T00:00:00Z")),
      spawn: fixture.launch,
    });
    expect(await backup.run({ previousSize: 50_000 })).toMatchObject({
      ok: false,
      reason: "rejected",
    });
    expect(storage.callsOf("backupCopy")).toHaveLength(0);
    storage.backupHead = async () => ({ ok: true, value: { exists: false, size: 0 } });
    expect(await backup.run()).toMatchObject({ ok: false, reason: "rejected" });
  });
  it("上传或月首复制失败原样降级，不隐藏为成功", async () => {
    const storage = createFakeStorage();
    storage.failNext("backupPutStream", { reason: "unsupported" });
    const backup = createBackup({
      config,
      storage,
      clock: createClock(new Date("2026-10-01T01:00:00Z")),
      spawn: fixtureSpawn().launch,
    });
    expect(await backup.run()).toMatchObject({ ok: false, reason: "unsupported" });
    storage.failNext("backupCopy");
    expect(await backup.run()).toMatchObject({ ok: false, reason: "unavailable" });
  });
  it("版本不合格、坏公钥或路径拒绝；取消关闭活动子进程和流", async () => {
    const storage = createFakeStorage();
    expect(
      await createBackup({
        config,
        storage,
        clock: createClock(),
        spawn: fixtureSpawn("version").launch,
      }).run(),
    ).toMatchObject({ ok: false, reason: "unsupported" });
    const launch = vi.fn<BackupSpawn>();
    expect(
      await createBackup({
        config: { ...config, prefix: "../other" },
        storage,
        clock: createClock(),
        spawn: launch,
      }).run(),
    ).toMatchObject({ ok: false, reason: "rejected" });
    expect(launch).not.toHaveBeenCalled();
    const fixture = fixtureSpawn("hang"),
      abort = new AbortController();
    const running = createBackup({
      config,
      storage,
      clock: createClock(),
      spawn: fixture.launch,
    }).run({ signal: abort.signal });
    await vi.waitFor(() => expect(fixture.calls).toHaveLength(3));
    abort.abort();
    expect(await running).toMatchObject({ ok: false });
    expect(storage.backupObjects.size).toBe(0);
    await vi.waitFor(() =>
      expect(
        fixture.children.every((child) => child.exitCode !== null || child.signalCode !== null),
      ).toBe(true),
    );
  });
});
