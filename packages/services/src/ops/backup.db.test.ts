import { spawn } from "node:child_process";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { createClock, createFakeStorage, useTestDatabase } from "../testing/index.js";
import { createBackup } from "./backup.js";
import type { BackupSpawn } from "./backup.js";

const db = useTestDatabase("services", { role: "lyx_readonly" });
let readOnlyUrl: string;
beforeAll(async () => {
  readOnlyUrl = await db.url();
}, 120_000);

/** 合成32字节公钥的age bech32编码，不产生、读取或保存解密私钥。 */
function testRecipient(): string {
  const alphabet = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
  const words: number[] = [];
  let bits = 0,
    accumulator = 0;
  for (const byte of new Uint8Array(32).fill(0x42)) {
    accumulator = (accumulator << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      words.push((accumulator >>> bits) & 31);
    }
  }
  if (bits) words.push((accumulator << (5 - bits)) & 31);
  const hrp = [..."age"].map((c) => c.charCodeAt(0));
  let checksum = 1;
  const generator = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  for (const value of [
    ...hrp.map((c) => c >>> 5),
    0,
    ...hrp.map((c) => c & 31),
    ...words,
    0,
    0,
    0,
    0,
    0,
    0,
  ]) {
    const high = checksum >>> 25;
    checksum = ((checksum & 0x1ffffff) << 5) ^ value;
    for (let n = 0; n < 5; n++) if ((high >>> n) & 1) checksum ^= generator[n]!;
  }
  checksum ^= 1;
  return `age1${[...words, ...Array.from({ length: 6 }, (_, n) => (checksum >>> (5 * (5 - n))) & 31)].map((n) => alphabet[n]).join("")}`;
}

const serverImage = process.env.LYX_TEST_BACKUP_IMAGE;
if (serverImage && !/^liyoxi\/server:[a-zA-Z0-9_.-]+$/.test(serverImage))
  throw new Error("备份镜像测试只接受已有liyoxi/server标签");
const live = serverImage !== undefined;
const launch: BackupSpawn = (command, args, options) => {
  // 常规CI：现有postgres17服务镜像内真实pg_dump，age边界注入可控加密替身。
  // 显式LYX_TEST_BACKUP_IMAGE：复用已有server镜像内pg_dump17与真实age，绝不拉镜像或装依赖。
  if (command === "age" && !serverImage)
    return spawn(
      process.execPath,
      [
        "-e",
        "process.stdout.write('age-encryption.org/v1\\n');process.stdin.on('data',d=>{for(let i=0;i<d.length;i++)d[i]^=0xa5;process.stdout.write(d)});process.stdin.on('end',()=>process.stdout.end())",
      ],
      { ...options, stdio: ["pipe", "pipe", "pipe"] },
    );
  const env = { ...options.env };
  if (env.PGHOST && process.platform !== "linux") env.PGHOST = "host.docker.internal";
  const dockerArgs = [
    "run",
    "--rm",
    "--pull",
    "never",
    "-i",
    "--read-only",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    ...(process.platform === "linux" ? ["--network", "host"] : []),
    ...Object.keys(env)
      .filter((key) => key.startsWith("PG"))
      .flatMap((key) => ["--env", key]),
    serverImage ?? "postgres:17-trixie",
    command,
    ...args,
  ];
  return spawn("docker", dockerArgs, { ...options, env, stdio: ["pipe", "pipe", "pipe"] });
};

describe(`真实只读隔离库导出，${live ? "现server镜像age加密" : "注入age边界替身（无真实age到达声明）"}`, () => {
  it("pg_dump17完整导出→加密流→假存储；保留真实只读权限和月首副本", async () => {
    const prisma = await db.prisma();
    expect(await prisma.$queryRawUnsafe("SELECT current_user AS role")).toEqual([
      { role: "lyx_readonly" },
    ]);
    await expect(prisma.$executeRawUnsafe("DELETE FROM user_session")).rejects.toThrow(
      /permission denied/,
    );
    const storage = createFakeStorage();
    const result = await createBackup({
      storage,
      clock: createClock(new Date("2026-10-01T00:00:00Z")),
      spawn: launch,
      config: { readOnlyUrl, recipients: [testRecipient()], bucket: "lyx-test-backup" },
    }).run();
    expect(result).toMatchObject({
      ok: true,
      value: {
        key: "backups/daily/2026-10-01.dump.age",
        monthlyKey: "backups/monthly/2026-10-01.dump.age",
      },
    });
    if (!result.ok) throw new Error(result.message);
    expect(result.value.bytes).toBeGreaterThan(1024);
    const body = storage.backupObjects.get(`lyx-test-backup/${result.value.key}`)?.body;
    expect(body).toBeDefined();
    const bytes = Buffer.from(body!);
    expect(bytes.subarray(0, 22).toString()).toBe("age-encryption.org/v1\n");
    expect(bytes.includes(Buffer.from("PGDMP"))).toBe(false);
    expect(bytes.includes(Buffer.from("CREATE TABLE"))).toBe(false);
    expect(storage.objects.size).toBe(0);
    expect(storage.backupObjects.get(`lyx-test-backup/${result.value.monthlyKey}`)?.body).toEqual(
      body,
    );
  }, 60_000);
  it("上传拒绝终止真实导出/加密进程，不提交对象、不改库", async () => {
    const children: ReturnType<BackupSpawn>[] = [];
    const storage = createFakeStorage();
    storage.failNext("backupPutStream");
    const result = await createBackup({
      storage,
      clock: createClock(),
      config: {
        readOnlyUrl,
        recipients: [testRecipient()],
        bucket: "lyx-test-backup",
      },
      spawn: (...args) => {
        const child = launch(...args);
        children.push(child);
        return child;
      },
    }).run();
    expect(result).toMatchObject({ ok: false, reason: "unavailable" });
    expect(storage.backupObjects.size).toBe(0);
    await vi.waitFor(
      () =>
        expect(
          children.every((child) => child.exitCode !== null || child.signalCode !== null),
        ).toBe(true),
      { timeout: 10_000 },
    );
    expect(await (await db.prisma()).$queryRawUnsafe("SELECT current_user AS role")).toEqual([
      { role: "lyx_readonly" },
    ]);
  }, 60_000);
});
