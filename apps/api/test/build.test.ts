// 构建产物可启动（任务书 W0-22 第 7 节第 5 条）：现打一份产物，用 node 把它起起来，探活通了再发 SIGTERM。
// 产物里 @liyoxi/* 是内联的、第三方包留给运行时解析：少声明一个依赖，这里就起不来。
// 起的是独立的进程：连本文件的测试库（迁移齐全），Redis 用共享的那份，只读不写。
import { execFile, spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { loadEnv } from "@liyoxi/services";
import { useTestDatabase } from "@liyoxi/services/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../", import.meta.url));
const db = useTestDatabase("api");
const TIMEOUT = { timeout: 180_000 };

const children: ChildProcess[] = [];
afterAll(() => {
  for (const child of children) if (child.exitCode === null) child.kill("SIGKILL");
});

interface Started {
  child: ChildProcess;
  lines: Record<string, unknown>[];
  /** 等到某个 evt 的日志行出现 */
  until(evt: string): Promise<Record<string, unknown>>;
}

function startServer(env: Record<string, string>): Started {
  const child = spawn(process.execPath, ["dist/server.js", "--port", "0", "--host", "127.0.0.1"], {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  const lines: Record<string, unknown>[] = [];
  const waiters: { evt: string; resolve: (line: Record<string, unknown>) => void }[] = [];
  createInterface({ input: child.stdout as NodeJS.ReadableStream }).on("line", (text) => {
    let line: Record<string, unknown>;
    try {
      line = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return;
    }
    lines.push(line);
    for (const waiter of waiters.filter((item) => item.evt === line.evt)) waiter.resolve(line);
  });
  return {
    child,
    lines,
    until: (evt) =>
      new Promise((resolve, reject) => {
        const found = lines.find((line) => line.evt === evt);
        if (found) return resolve(found);
        waiters.push({ evt, resolve });
        child.once("exit", (code) => reject(new Error(`进程已退出（${code}），没等到 ${evt}`)));
      }),
  };
}

describe("构建产物", () => {
  beforeAll(async () => {
    await promisify(execFile)(process.execPath, ["scripts/build.mjs"], { cwd: root });
  }, TIMEOUT.timeout);

  it("出了两个入口：server.js 与 check-env.js", () => {
    expect(existsSync(`${root}dist/server.js`)).toBe(true);
    expect(existsSync(`${root}dist/check-env.js`)).toBe(true);
  });

  it("起得来：探活通，收到 SIGTERM 后排空并以 0 退出", TIMEOUT, async () => {
    const server = startServer({ APP_ENV: "test", DATABASE_URL: await db.url() });
    const listening = await server.until("api.listening");
    const base = `http://127.0.0.1:${String(listening.port)}`;

    const healthz = await fetch(`${base}/healthz`);
    expect(healthz.status).toBe(200);
    expect(await healthz.json()).toEqual({ status: "ok" });
    expect((await fetch(`${base}/readyz`)).status).toBe(200);
    const health = (await (await fetch(`${base}/health`)).json()) as Record<string, unknown>;
    expect(health).toMatchObject({ db: "ok", redis: "ok", version: "dev" });
    expect((await fetch(`${base}/api/v1/m/nothing`)).status).toBe(404);

    server.child.kill("SIGTERM");
    const [code] = (await once(server.child, "exit")) as [number | null];
    expect(code).toBe(0);
    expect(server.lines.map((line) => line.evt)).toEqual(
      expect.arrayContaining(["api.listening", "api.draining", "api.stopped"]),
    );
  });

  it("库连不上：启动自检失败，退出码 1，不监听", TIMEOUT, async () => {
    const server = startServer({
      APP_ENV: "test",
      DATABASE_URL: "postgresql://nobody:s3cret-not-real@127.0.0.1:1/lyx_test_unreachable",
    });
    const [code] = (await once(server.child, "exit")) as [number | null];
    expect(code).toBe(1);
    const failed = server.lines.find((line) => line.evt === "api.start_failed");
    expect(String(failed?.msg)).toContain("db.connect");
    expect(JSON.stringify(server.lines)).not.toContain("s3cret-not-real");
    expect(server.lines.some((line) => line.evt === "api.listening")).toBe(false);
  });

  it("check-env.js：环境变量齐全退出码 0，缺 APP_ENV 退出码 1", TIMEOUT, async () => {
    const run = (env: NodeJS.ProcessEnv) =>
      promisify(execFile)(process.execPath, ["dist/check-env.js"], { cwd: root, env }).then(
        () => 0,
        (error: { code?: number }) => error.code,
      );
    const env = loadEnv();
    expect(await run({ ...process.env, APP_ENV: env.APP_ENV })).toBe(0);
    expect(await run({ ...process.env, APP_ENV: "" })).toBe(1);
  });
});
