// 测试库的底座（W0-05b）：名字、守卫，以及建库、删库、重置、连接四个入口。
//
// 隔离单位是“库”，不是 schema（计划 第 5.4 节“服务层连真库”行）。三条原因：
//   1. 底稿里有写死 search_path = public 的函数（如 SECURITY DEFINER 的 lyx_03_purge_auth_event）：
//      换一个 schema，它们照样落在 public 上，隔不开。
//   2. 扩展（btree_gist、pg_trgm）是库级的：一个库里只装一份，按 schema 分不了。
//   3. 只增表有触发器拦 TRUNCATE，应用角色也没有删除权：清表这条路走不通，所以重置 = 删库重建。
//
// 名字：lyx_test_<包>_<会话标识>_<worker 编号>[_<标签>]；模板库 lyx_test_tpl_<会话标识>。
// 守卫只有一个函数 assertTestDatabaseName：四个入口都先过它，不符即抛错，一句 SQL 都不发、一条连接都不开。
// 管理连接连的是维护库 postgres（建库、删库只能在别的库上执行），账号取环境变量 DATABASE_URL，不读 .env。
// 角色：给用例的连接（连接串、pg 连接、Prisma 客户端）缺省切到应用角色 lyx_app（W0-06a），写 role: null 才不切；
// 建库、删库、改名、建模板库与跑迁移这些管理动作不切，一直用 DATABASE_URL 的账号。
//
// 本文件只引 Node 内置模块与 pg，不写相对导入：prune.mjs 用 Node 自带的类型擦除直接加载它。

import { createHash } from "node:crypto";
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import pg from "pg";

/** 测试库名的前缀：守卫只认它 */
export const TEST_DATABASE_PREFIX = "lyx_test_";

/** PostgreSQL 的标识符上限是 63 个字符 */
const TEST_DATABASE_NAME = /^lyx_test_[a-z0-9_]{1,54}$/;
const SESSION = /^[a-z0-9]{1,12}$/;
const WORKER = /^[0-9]{1,4}$/;
const LABEL = /^[a-z0-9]{1,12}$/;
const ROLE = /^[a-z_][a-z0-9_]{0,62}$/;

/** 库名里的 <包>（任务书 第 11 节第 2 项） */
export const TEST_PACKAGES = ["db", "services", "api", "worker"] as const;
export type TestPackage = (typeof TEST_PACKAGES)[number];

/** 库名没过守卫 */
export class TestDatabaseNameError extends Error {
  constructor(name: unknown) {
    super(
      `测试支架只动 ${TEST_DATABASE_PREFIX} 开头的库（小写字母、数字、下划线，不超过 63 个字符），拒绝：${JSON.stringify(name)}`,
    );
    this.name = "TestDatabaseNameError";
  }
}

/** 库名守卫：建库、删库、重置、连接都先过它 */
export function assertTestDatabaseName(name: unknown): asserts name is string {
  if (typeof name !== "string" || !TEST_DATABASE_NAME.test(name)) {
    throw new TestDatabaseNameError(name);
  }
}

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url)).replace(/\/$/, "");

type EnvSource = Readonly<Record<string, string | undefined>>;

/**
 * 会话标识：取环境变量 LYX_TEST_SESSION；没设就取本检出（worktree）根路径的短哈希。
 * 同一个检出里要同时跑两遍测试时，各给一个不同的 LYX_TEST_SESSION。
 */
export function resolveTestSession(source: EnvSource = process.env): string {
  const given = source.LYX_TEST_SESSION?.trim();
  if (given === undefined || given === "") {
    return createHash("sha256").update(REPO_ROOT).digest("hex").slice(0, 8);
  }
  if (!SESSION.test(given)) {
    throw new Error("LYX_TEST_SESSION 只接受 1–12 位小写字母与数字");
  }
  return given;
}

/** worker 编号：Vitest 给每个 worker 的 VITEST_POOL_ID（1 到并行数）；不在 Vitest 里时是 0 */
export function resolveTestWorker(source: EnvSource = process.env): string {
  const id = source.VITEST_POOL_ID?.trim() ?? "0";
  if (!WORKER.test(id)) throw new Error(`VITEST_POOL_ID 不是数字：${JSON.stringify(id)}`);
  return id;
}

/** 模板库名：每个会话一个，每轮测试开始时重建 */
export function templateDatabaseName(session: string = resolveTestSession()): string {
  const name = `${TEST_DATABASE_PREFIX}tpl_${session}`;
  assertTestDatabaseName(name);
  return name;
}

export interface TestDatabaseNameParts {
  session?: string;
  worker?: string;
  /** 同一个 worker 要第二个库时用它区分，如 "b" */
  label?: string;
}

/** 测试库名：lyx_test_<包>_<会话标识>_<worker 编号>[_<标签>] */
export function testDatabaseName(pkg: TestPackage, parts: TestDatabaseNameParts = {}): string {
  if (!TEST_PACKAGES.includes(pkg)) {
    throw new Error(`库名里的包只能是 ${TEST_PACKAGES.join("、")} 之一`);
  }
  const session = parts.session ?? resolveTestSession();
  const worker = parts.worker ?? resolveTestWorker();
  if (!SESSION.test(session) || !WORKER.test(worker)) {
    throw new Error("会话标识只接受 1–12 位小写字母与数字，worker 编号只接受数字");
  }
  if (parts.label !== undefined && !LABEL.test(parts.label)) {
    throw new Error("库名的标签只接受 1–12 位小写字母与数字");
  }
  const name = `${TEST_DATABASE_PREFIX}${pkg}_${session}_${worker}${parts.label ? `_${parts.label}` : ""}`;
  assertTestDatabaseName(name);
  return name;
}

/** 这个库名属于哪个会话：第二段是会话标识。对不上本支架的命名时返回 undefined */
export function sessionOfTestDatabase(name: string): string | undefined {
  if (!TEST_DATABASE_NAME.test(name)) return undefined;
  const [pkg, session] = name.slice(TEST_DATABASE_PREFIX.length).split("_");
  const known = pkg === "tpl" || (TEST_PACKAGES as readonly string[]).includes(pkg ?? "");
  return known && session !== undefined && SESSION.test(session) ? session : undefined;
}

/**
 * 用量记录：环境变量 LYX_TEST_USAGE_FILE 给了文件路径时，每建一个库、每发一个 Redis 前缀追加一行 JSON。
 * pnpm test:isolation 靠它核对两个会话用的库名与前缀没有交集。没给这个变量时什么都不做。
 */
export function recordTestUsage(kind: "database" | "redis" | "parallel", value: unknown): void {
  const file = process.env.LYX_TEST_USAGE_FILE;
  if (!file) return;
  appendFileSync(file, `${JSON.stringify({ kind, value, session: resolveTestSession() })}\n`);
}

function baseUrl(): URL {
  const base = process.env.DATABASE_URL;
  if (!base) {
    throw new Error(
      "DATABASE_URL 未设置：测试支架用它的主机与账号连本地的 PostgreSQL（取值见 CLAUDE.md 第 9 节）",
    );
  }
  return new URL(base);
}

/** 管理连接：连维护库 postgres，只在本文件里用，用完即断 */
async function withAdmin<T>(run: (admin: pg.Client) => Promise<T>): Promise<T> {
  const url = baseUrl();
  url.pathname = "/postgres";
  url.search = "";
  const admin = new pg.Client({ connectionString: url.toString() });
  await admin.connect();
  try {
    return await run(admin);
  } finally {
    await admin.end();
  }
}

const sqlState = (error: unknown): string | undefined =>
  typeof error === "object" && error !== null && "code" in error ? String(error.code) : undefined;

async function createFromTemplate(admin: pg.Client, name: string, template: string): Promise<void> {
  // 模板库上有别的连接时建不了（55006）。模板库建完即关掉连接入口，这里只为刚建完那一刻的自动清理进程重试几次
  for (let attempt = 1; ; attempt += 1) {
    try {
      await admin.query(`CREATE DATABASE "${name}" TEMPLATE "${template}"`);
      return;
    } catch (error) {
      if (sqlState(error) === "55006" && attempt < 5) {
        await new Promise((resolve) => setTimeout(resolve, 200 * attempt));
        continue;
      }
      if (sqlState(error) === "3D000") {
        throw new Error(
          `模板库 ${template} 不存在：本包的 vitest.config.ts 要挂 globalSetup（@liyoxi/services/testing/global-setup），由它在每轮测试开始时建模板库`,
          { cause: error },
        );
      }
      throw error;
    }
  }
}

export interface CreateTestDatabaseOptions {
  /** 从哪个模板库拷；缺省是本会话的模板库 */
  template?: string;
}

/** 建库：从模板库拷一份（CREATE DATABASE … TEMPLATE）。已存在即报错 */
export async function createTestDatabase(
  name: string,
  options: CreateTestDatabaseOptions = {},
): Promise<void> {
  assertTestDatabaseName(name);
  const template = options.template ?? templateDatabaseName();
  assertTestDatabaseName(template);
  await withAdmin((admin) => createFromTemplate(admin, name, template));
  recordTestUsage("database", name);
}

/** 删库：连同还连着它的会话一起断开。不存在时什么都不做 */
export async function dropTestDatabase(name: string): Promise<void> {
  assertTestDatabaseName(name);
  await withAdmin((admin) => admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`));
}

/** 重置 = 删库，再从模板库重建。不清表：只增表上的 TRUNCATE 会被触发器拒掉 */
export async function resetTestDatabase(
  name: string,
  options: CreateTestDatabaseOptions = {},
): Promise<void> {
  assertTestDatabaseName(name);
  const template = options.template ?? templateDatabaseName();
  assertTestDatabaseName(template);
  await withAdmin(async (admin) => {
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await createFromTemplate(admin, name, template);
  });
  recordTestUsage("database", name);
}

/** 把一个测试库改名（失败的用例留库时用）：先断开还连着它的会话 */
export async function renameTestDatabase(from: string, to: string): Promise<void> {
  assertTestDatabaseName(from);
  assertTestDatabaseName(to);
  await withAdmin(async (admin) => {
    // 被断开的会话要过一小会儿才真的退出：改名报“库还有人连着”（55006）就再试几次
    for (let attempt = 1; ; attempt += 1) {
      await admin.query(
        "select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()",
        [from],
      );
      try {
        await admin.query(`ALTER DATABASE "${from}" RENAME TO "${to}"`);
        return;
      } catch (error) {
        if (sqlState(error) !== "55006" || attempt >= 10) throw error;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
  });
}

/**
 * 测试连接缺省切到的角色：应用角色 lyx_app（W0-05b 任务书 第 11 节第 8 项，W0-06a 的授权迁移合并时改的）。
 * 它由授权迁移建，不可登录：连接仍用 DATABASE_URL 的账号登录，靠启动参数切过去。
 */
export const TEST_DEFAULT_ROLE = "lyx_app";

export interface TestConnectionOptions {
  /**
   * 连上之后切到哪个数据库角色（启动参数里带 role，等同于连上之后 SET ROLE；断了重连也还是它）。
   * 缺省切到应用角色 lyx_app：用例看到的权限与 api、worker 的一样，只增表改不了、删不了。
   * 写 null 是不切，用 DATABASE_URL 的账号（本地与 CI 是管理账号，也是表的属主）：
   * 建表、读 _prisma_migrations、看别的会话的状态、验触发器那一道，这些应用角色做不了的事才用。
   * DATABASE_URL 的账号要切得过去：是超级用户，或是那个角色的成员。
   */
  role?: string | null;
}

/** 连接入口之一：给出某个测试库的连接串（主机、账号取 DATABASE_URL，库名换掉） */
export function testDatabaseUrl(name: string, options: TestConnectionOptions = {}): string {
  assertTestDatabaseName(name);
  const url = baseUrl();
  url.pathname = `/${name}`;
  const role = options.role === undefined ? TEST_DEFAULT_ROLE : options.role;
  if (role !== null) {
    if (!ROLE.test(role)) throw new Error("角色名只接受小写字母、数字、下划线");
    url.searchParams.set("options", `-c role=${role}`);
  }
  return url.toString();
}

/** 连接入口之二：直接连上某个测试库，返回 pg 的连接。用完自己 end() */
export async function connectTestDatabase(
  name: string,
  options: TestConnectionOptions = {},
): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: testDatabaseUrl(name, options) });
  await client.connect();
  return client;
}

/** 给一条连接串把关：库名不是测试库即抛错。装配测试用的服务容器之前先过它 */
export function assertTestDatabaseUrl(connectionString: string): void {
  let name: string;
  try {
    name = decodeURIComponent(new URL(connectionString).pathname.slice(1));
  } catch {
    throw new TestDatabaseNameError("（不是合法的连接串）");
  }
  assertTestDatabaseName(name);
}

export interface ListTestDatabasesOptions {
  /** 只列这个会话的；不给就列实例上全部 lyx_test_ 开头的库 */
  session?: string;
}

/** 列出实例上的测试库（只读）。别的会话、infra 用例自己建的 lyx_test_ 库也在全量结果里 */
export async function listTestDatabases(options: ListTestDatabasesOptions = {}): Promise<string[]> {
  const names = await withAdmin(async (admin) => {
    const result = await admin.query<{ datname: string }>(
      "select datname from pg_database where datname like 'lyx\\_test\\_%' order by datname",
    );
    return result.rows.map((row) => row.datname);
  });
  return names.filter(
    (name) =>
      TEST_DATABASE_NAME.test(name) &&
      (options.session === undefined || sessionOfTestDatabase(name) === options.session),
  );
}

/** 会话锁的键：一轮测试从开始到结束，globalSetup 用一条管理连接占着这把咨询锁 */
export const TEST_SESSION_LOCK_SQL = "pg_try_advisory_lock(hashtextextended($1, 0))";
export const testSessionLockKey = (session: string): string => `lyx_test_session:${session}`;

/**
 * 这些会话里哪几个正有一轮测试在跑（会话锁被占着）。
 * 只看 pg_locks，不去抢那把锁：抢一下再放的话，恰好这时启动的一轮测试会拿不到锁，报“已经有一轮测试在跑”。
 * 咨询锁是按库分的：globalSetup 在维护库 postgres 上占锁，这里的管理连接连的也是它。
 * 单个 bigint 键的咨询锁在 pg_locks 里是 classid = 键的高 32 位、objid = 低 32 位、objsubid = 1。
 */
export async function runningTestSessions(sessions: readonly string[]): Promise<Set<string>> {
  const unique = [...new Set(sessions)];
  if (unique.length === 0) return new Set();
  const held = await withAdmin(async (admin) => {
    const result = await admin.query<{ session: string }>(
      `select s.session
         from unnest($1::text[], $2::text[]) as s(session, key)
        where exists (
          select 1 from pg_locks l
           where l.locktype = 'advisory' and l.granted and l.objsubid = 1
             and l.database = (select oid from pg_database where datname = current_database())
             and ((l.classid::bigint << 32) | l.objid::bigint) = hashtextextended(s.key, 0))`,
      [unique, unique.map((session) => testSessionLockKey(session))],
    );
    return result.rows.map((row) => row.session);
  });
  return new Set(held);
}

/** 清理的范围：一个会话的，或实例上全部 lyx_test_ 开头的 */
export type PruneScope = { session: string } | { all: true };

export interface PrunePlan {
  drop: string[];
  /** 没删的与原因：所属的会话正有一轮测试在跑 */
  skipped: Array<{ name: string; reason: string }>;
}

/**
 * 从库名清单里挑出要删的。只挑过得了守卫的名字（lyx_test_ 开头）；
 * 所属的会话正在跑测试的不删。不按本支架的规矩命名的（如 infra 用例的 lyx_test_infra_…）只在 all 时删。
 */
export function planPrune(
  names: readonly string[],
  scope: PruneScope,
  running: ReadonlySet<string>,
): PrunePlan {
  const plan: PrunePlan = { drop: [], skipped: [] };
  for (const name of names) {
    if (!TEST_DATABASE_NAME.test(name)) continue;
    const session = sessionOfTestDatabase(name);
    if ("session" in scope && session !== scope.session) continue;
    if (session !== undefined && running.has(session)) {
      plan.skipped.push({ name, reason: `会话 ${session} 正有一轮测试在跑` });
    } else {
      plan.drop.push(name);
    }
  }
  return plan;
}

/** 清理测试库（pnpm test:db:prune）。只删 lyx_test_ 开头的库，每一个都再过一遍守卫 */
export async function pruneTestDatabases(
  scope: PruneScope,
  options: { dryRun?: boolean } = {},
): Promise<PrunePlan> {
  const names = await listTestDatabases("session" in scope ? { session: scope.session } : {});
  const sessions = names.flatMap((name) => sessionOfTestDatabase(name) ?? []);
  const plan = planPrune(names, scope, await runningTestSessions(sessions));
  if (!options.dryRun) {
    for (const name of plan.drop) await dropTestDatabase(name);
  }
  return plan;
}
