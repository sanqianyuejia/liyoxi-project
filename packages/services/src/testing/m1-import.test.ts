import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { afterAll, beforeAll, expect, it } from "vitest";

let child: ReturnType<typeof spawn> | undefined;
let closed = Promise.resolve();
let exited = false;
let status: number | null = null;
let signal: NodeJS.Signals | null = null;
let errorCode: string | null = null;
let phase = "cold_import";
let stdoutBytes = 0;
const diagnostic = () => JSON.stringify({ status, signal, errorCode, phase });
const noteError = (error: NodeJS.ErrnoException) => {
  errorCode = /^[A-Z0-9_]{1,40}$/.test(error.code ?? "") ? error.code! : "CHILD_PROCESS_ERROR";
};
async function stopOwnedChild() {
  if (child && !exited) child.kill("SIGKILL");
  await closed;
}

// 冷导入属于准备；同一独立 prod/no-Vitest 进程收到 probe 后才执行原守卫断言。
beforeAll(async () => {
  const env: NodeJS.ProcessEnv = { ...process.env, APP_ENV: "prod" };
  delete env.VITEST;
  const source = `
    import assert from 'node:assert/strict';
    import {createM1Support, useTestDatabase, useTestRedis} from ${JSON.stringify(new URL("./index.ts", import.meta.url).href)};
    process.once('message', async (message) => {
      try {
        assert.equal(message, 'probe');
        assert.equal(process.env.VITEST, undefined);
        assert.throws(() => useTestDatabase('api'), /Vitest worker/);
        assert.throws(() => useTestRedis(), /Vitest worker/);
        await assert.rejects(createM1Support(), /APP_ENV=test/);
      } catch {
        process.exitCode = 1;
        process.send('probe_failed');
      } finally {
        process.disconnect();
      }
    });
    process.send('ready');
  `;
  const owned = spawn(
    process.execPath,
    [
      "--import",
      createRequire(import.meta.url).resolve("tsx"),
      "--input-type=module",
      "--eval",
      source,
    ],
    { env, stdio: ["ignore", "pipe", "pipe", "ipc"] },
  );
  child = owned;
  owned.stdout?.on("data", (bytes: Buffer) => (stdoutBytes += bytes.length));
  // 排空但不保留或回显原始错误输出；失败仅报告脱敏的进程状态。
  owned.stderr?.resume();
  owned.on("error", noteError);
  closed = new Promise<void>((resolve) => {
    owned.once("close", (code, stoppedBy) => {
      status = code;
      signal = stoppedBy;
      exited = true;
      resolve();
    });
  });
  const ready = new Promise<void>((resolve) => {
    owned.on("message", (message) => {
      if (message === "ready") {
        phase = "ready";
        resolve();
      } else if (message === "probe_failed") errorCode = "PROBE_ASSERTION_FAILED";
    });
  });
  const timeout = setTimeout(() => {
    errorCode = "ETIMEDOUT";
    owned.kill("SIGKILL");
  }, 55_000);
  try {
    await Promise.race([
      ready,
      closed.then(() => {
        throw new Error(diagnostic());
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}, 60_000);

afterAll(stopOwnedChild, 5_000);

it("公共测试入口在无 Vitest 的进程可纯导入，钩子与非测试 M1 明确拒绝", async () => {
  phase = "probe";
  const timeout = setTimeout(() => {
    errorCode = "ETIMEDOUT";
    child?.kill("SIGKILL");
  }, 10_000);
  try {
    if (!child?.connected) throw new Error(diagnostic());
    child.send("probe", (error) => {
      if (error) {
        noteError(error);
        child?.kill("SIGKILL");
      }
    });
    await closed;
    expect(status, diagnostic()).toBe(0);
    expect(stdoutBytes, diagnostic()).toBe(0);
  } finally {
    clearTimeout(timeout);
    await stopOwnedChild();
  }
}, 15_000);
