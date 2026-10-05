// Vitest 的 globalSetup（W0-05b）：每轮测试开始时建本会话的模板库并跑全部迁移，结束时删掉。
// 借自参考工程 packages/services/src/testing/global-setup.ts 的形状；
// “对某个 schema 跑 migrate deploy”改成了“建模板库并跑 migrate deploy”。
//
// 挂法：包的 vitest.config.ts 里写 globalSetup。packages/db 直接指本文件；
// 其余的包指 @liyoxi/services/testing/global-setup（它转导出本文件）。
//
// 它在 Vitest 的主进程里执行。几个项目都挂了它时，同一轮里只建一次：状态记在 globalThis 上，按引用计数收尾。
// 同一个会话标识同一时刻只许一轮测试：靠一条一直连着的管理连接上的咨询锁占住，拿不到即报错。
// 模板库建完就关掉连接入口（ALLOW_CONNECTIONS false）：CREATE DATABASE … TEMPLATE 要求模板库上没有别的连接。

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { availableParallelism } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";
import type { TestProject } from "vitest/node";

import {
  recordTestUsage,
  resolveTestSession,
  templateDatabaseName,
  TEST_SESSION_LOCK_SQL,
  testDatabaseUrl,
  testSessionLockKey,
} from "./database.js";

declare module "vitest" {
  export interface ProvidedContext {
    /** 这一轮的并行数（worker 个数的上限）。测试里用 inject("lyxTestMaxWorkers") 取 */
    lyxTestMaxWorkers: number;
  }
}

const PACKAGE_DIR = fileURLToPath(new URL("../../", import.meta.url));

interface SessionState {
  users: number;
  ready: Promise<void>;
  /** 占着咨询锁的管理连接；收尾时用它删模板库 */
  admin: pg.Client | undefined;
  /** 咨询锁拿到了没有：没拿到说明模板库是别的一轮测试的，收尾时不能删 */
  locked: boolean;
  template: string;
}

const STATE = Symbol.for("lyx.testing.session");
const holder = globalThis as { [STATE]?: SessionState };

/** Prisma 命令行的入口文件：取本包装的那一份，不经 pnpm、不经 PATH */
function prismaCli(): string {
  const manifest = createRequire(import.meta.url).resolve("prisma/package.json");
  const bin = (JSON.parse(readFileSync(manifest, "utf8")) as { bin: { prisma: string } }).bin;
  return join(dirname(manifest), bin.prisma);
}

/** 对一个库跑 prisma migrate deploy（CLAUDE.md 第 6 节规则 21：只走 migrate deploy） */
function migrateDeploy(databaseUrl: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [prismaCli(), "migrate", "deploy"], {
      cwd: PACKAGE_DIR,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else
        reject(new Error(`模板库上 prisma migrate deploy 没跑成（退出码 ${code}）：\n${output}`));
    });
  });
}

async function buildTemplate(state: SessionState, session: string): Promise<void> {
  const base = process.env.DATABASE_URL;
  if (!base) {
    throw new Error(
      "DATABASE_URL 未设置：连库的测试要本地的 PostgreSQL（pnpm infra:up；取值见 CLAUDE.md 第 9 节）",
    );
  }
  const url = new URL(base);
  url.pathname = "/postgres";
  url.search = "";
  const admin = new pg.Client({ connectionString: url.toString() });
  try {
    await admin.connect();
  } catch (error) {
    throw new Error(
      `连不上本地的 PostgreSQL：先 pnpm infra:up，再核对 DATABASE_URL（CLAUDE.md 第 9 节）。原始报错：${String(error)}`,
      { cause: error },
    );
  }
  state.admin = admin;
  const lock = await admin.query<{ locked: boolean }>(`select ${TEST_SESSION_LOCK_SQL} as locked`, [
    testSessionLockKey(session),
  ]);
  if (lock.rows[0]?.locked !== true) {
    throw new Error(
      `会话标识 ${session} 已经有一轮测试在跑。同一个检出里要同时跑第二轮，给它另一个 LYX_TEST_SESSION（1–12 位小写字母与数字）`,
    );
  }
  state.locked = true;
  const template = state.template;
  await admin.query(`DROP DATABASE IF EXISTS "${template}" WITH (FORCE)`);
  await admin.query(`CREATE DATABASE "${template}"`);
  // 跑迁移是管理动作：不切角色（role: null），用 DATABASE_URL 的账号，它成了表的属主。
  // 应用角色建不了表；全新的实例上它这时也还不存在，要等授权迁移把它建出来
  await migrateDeploy(testDatabaseUrl(template, { role: null }));
  await admin.query(`ALTER DATABASE "${template}" WITH ALLOW_CONNECTIONS false`);
  recordTestUsage("database", template);
}

async function release(): Promise<void> {
  const state = holder[STATE];
  if (!state) return;
  state.users -= 1;
  if (state.users > 0) return;
  delete holder[STATE];
  const { admin } = state;
  if (!admin) return;
  try {
    if (state.locked) await admin.query(`DROP DATABASE IF EXISTS "${state.template}" WITH (FORCE)`);
  } finally {
    // 连接一断，咨询锁自动释放
    await admin.end();
  }
}

/** 这一轮的并行数：与 Vitest 自己的算法一致（项目的配置、全局的配置、缺省 CPU 数减一） */
function maxWorkersOf(project: TestProject): number {
  const configured = project.config.maxWorkers ?? project.vitest.config.maxWorkers;
  if (typeof configured === "number" && configured > 0) return configured;
  const cpus = availableParallelism();
  return Math.max(project.vitest.config.watch ? Math.floor(cpus / 2) : cpus - 1, 1);
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const session = resolveTestSession();
  // worker 与用例起的子进程都从环境变量取同一个会话标识
  process.env.LYX_TEST_SESSION = session;
  let state = holder[STATE];
  if (!state) {
    state = {
      users: 0,
      ready: Promise.resolve(),
      admin: undefined,
      locked: false,
      template: templateDatabaseName(session),
    };
    holder[STATE] = state;
    state.ready = buildTemplate(state, session);
  }
  state.users += 1;
  try {
    await state.ready;
  } catch (error) {
    await release();
    throw error;
  }
  project.provide("lyxTestMaxWorkers", maxWorkersOf(project));
  return release;
}
