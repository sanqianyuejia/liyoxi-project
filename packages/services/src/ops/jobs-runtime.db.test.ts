import { afterAll, beforeAll, expect, it } from "vitest";
import {
  assembleForTest,
  createClock,
  createFakeProviders,
  useSeededDatabase,
} from "../testing/index.js";
import { buildWorkerServices } from "./worker.js";
import type { WorkerServices } from "./worker.js";
import { runScheduledBackup, runScheduledCert } from "./jobs.js";
const db = useSeededDatabase("services"),
  clock = createClock();
let services: WorkerServices;
beforeAll(async () => {
  services = buildWorkerServices({
    appEnv: "test",
    prisma: await db.prisma(),
    assembly: assembleForTest({ entry: "worker" }),
    clock,
    channel: { enqueue: async () => {}, downForMs: () => 0 },
    providers: createFakeProviders({ clock }),
    logger: { info() {}, warn() {}, error() {} },
  });
}, 60_000);
afterAll(() => services?.closeOps?.());
it("原worker真实绑定两周期，未配备份失败留P1，未配证书不是green而留P3", async () => {
  const jobs = services.assembly.recurringJobs;
  expect(jobs.find((j) => j.kind === "backup.pgdump")).toMatchObject({
    schedule: { every: "day", at: "03:10" },
    mode: "job",
    leaseSec: 1800,
    maxAttempts: 3,
    deadlineMin: 180,
    missSeverity: "P1",
    catchUp: true,
  });
  expect(jobs.find((j) => j.kind === "ops.cert_check")).toMatchObject({
    schedule: { every: "day", at: "09:00" },
    mode: "job",
    leaseSec: 120,
    maxAttempts: 1,
    missSeverity: "P3",
    catchUp: true,
  });
  expect(jobs.find((j) => j.kind === "ops.cert_check")?.deadlineMin).toBeUndefined();
  // 原三个周期仍保留各自节奏/模式，新增任务不替换原机制。
  expect(jobs.find((j) => j.kind === "invariant.full")).toMatchObject({
    schedule: { every: "day", at: "03:30" },
    mode: "job",
    maxAttempts: 3,
  });
  expect(jobs.find((j) => j.kind === "invariant.quick")).toMatchObject({
    schedule: { every: "minutes", minutes: 10 },
    mode: "job",
    maxAttempts: 1,
  });
  expect(jobs.find((j) => j.kind === "ops.retention")).toMatchObject({
    schedule: { every: "hour" },
    mode: "tx",
  });
  await expect(runScheduledBackup({ scheduledFor: clock.now() })).rejects.toThrow(
    "逻辑备份失败：unconfigured",
  );
  expect(await runScheduledCert({ scheduledFor: clock.now() })).toEqual({
    status: "unconfigured",
    configured: false,
    domains: 0,
  });
  const prisma = await db.prisma();
  expect(await prisma.alertEvent.findFirst({ where: { rule: "backup.failed" } })).toMatchObject({
    severity: "P1",
    kind: "event",
    status: "open",
  });
  expect(await prisma.alertEvent.findFirst({ where: { rule: "cert.unconfigured" } })).toMatchObject(
    { severity: "P3", kind: "event", status: "open" },
  );
  expect(await prisma.notificationDelivery.count()).toBe(0);
});
