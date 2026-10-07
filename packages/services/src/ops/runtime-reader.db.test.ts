import type * as Database from "@liyoxi/db";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { performance } from "node:perf_hooks";
import {
  assembleForTest,
  createClock,
  createFakeProviders,
  useSeededDatabase,
} from "../testing/index.js";
import { buildWorkerServices } from "./worker.js";
import type { WorkerServices } from "./worker.js";
const captured = vi.hoisted(() => ({
  readers: [] as Array<{
    client: Database.PrismaClient;
    max?: number;
    statementTimeoutMs?: number;
  }>,
}));
vi.mock("@liyoxi/db", async (importOriginal) => {
  const actual = await importOriginal<typeof Database>();
  return {
    ...actual,
    createPrismaClient: (options: Parameters<typeof actual.createPrismaClient>[0]) => {
      const client = actual.createPrismaClient(options);
      captured.readers.push({
        client,
        max: options.max,
        statementTimeoutMs: options.statementTimeoutMs,
      });
      return client;
    },
  };
});
const db = useSeededDatabase("services"),
  clock = createClock();
let services: WorkerServices;
beforeAll(async () => {
  services = buildWorkerServices({
    appEnv: "test",
    prisma: await db.prisma(),
    probeConnectionString: await db.url(),
    assembly: assembleForTest({ entry: "worker" }),
    clock,
    channel: { enqueue: async () => {}, downForMs: () => 0 },
    providers: createFakeProviders({ clock }),
    logger: { info() {}, warn() {}, error() {} },
  });
}, 60_000);
afterAll(() => services?.closeOps?.());
it("真实装配建独立3连接读池，PostgreSQL实际2秒中断慢查询", async () => {
  const reader = captured.readers.find((r) => r.statementTimeoutMs === 2000)!;
  expect(reader.max).toBe(3);
  expect(await reader.client.$queryRawUnsafe("SHOW statement_timeout")).toEqual([
    { statement_timeout: "2s" },
  ]);
  const started = performance.now();
  await expect(reader.client.$queryRawUnsafe("SELECT 1 FROM pg_sleep(3)")).rejects.toThrow(
    /statement timeout/,
  );
  const elapsed = performance.now() - started;
  expect(elapsed).toBeGreaterThan(1700);
  expect(elapsed).toBeLessThan(2900);
  expect(await reader.client.$queryRawUnsafe("SELECT 1 AS n")).toEqual([{ n: 1 }]);
}, 10_000);
