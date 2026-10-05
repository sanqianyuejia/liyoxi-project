// 按 worker 建库（W0-05b）：每个 Vitest worker 一个库，从本会话的模板库拷。
//
// 用法：测试文件顶层写一行
//   const db = useTestDatabase("services");
// 用例里 `const prisma = await db.prisma()`。首次取连接时才建库；文件跑完，用例全过就删库，
// 有失败就把库改名留下并打印库名（看完用 pnpm test:db:prune 清掉）。
// 用例失败、钩子（beforeAll、afterAll、beforeEach、afterEach）失败都算失败。
// 改名是因为同一个 worker 编号马上会被下一个测试文件用到，不改名留不住。

import { aroundAll, inject } from "vitest";
import type { RunnerTask } from "vitest";
import { getCurrentSuite } from "vitest/suite";

import { createPrismaClient } from "../index.js";
import type { PrismaClient } from "../index.js";
import {
  dropTestDatabase,
  renameTestDatabase,
  resetTestDatabase,
  testDatabaseName,
  testDatabaseUrl,
} from "./database.js";
import type { TestConnectionOptions, TestPackage } from "./database.js";
// 只为类型：inject("lyxTestMaxWorkers") 的键是 global-setup.ts 里对 Vitest 的类型扩充。别的包（apps/api、apps/worker）
// 经 @liyoxi/services/testing 引到本文件时，它们的类型检查里没有 global-setup.ts，不带这一行就认不得那个键（W0-22）
import type {} from "./global-setup.js";

/**
 * 收尾钩子的时限。删库平时不到一秒，但它要等数据库做一次检查点：
 * 同一个实例上别的会话正在大批建表时会慢到十几秒，Vitest 缺省的 10 秒不够。
 */
const DISPOSE_TIMEOUT_MS = 120_000;

export interface TestDatabaseOptions extends TestConnectionOptions {
  /** 同一个测试文件要第二个库时给个标签，如 "b" */
  label?: string;
  /** Prisma 客户端的连接数上限，缺省 4 */
  max?: number;
}

export interface TestDatabase {
  /** 库名：lyx_test_<包>_<会话标识>_<worker 编号>[_<标签>] */
  readonly name: string;
  /** 连接串。首次调用时建库 */
  url(): Promise<string>;
  /** 本库的 Prisma 客户端，一个库一个实例。首次调用时建库；重置之后要重新取 */
  prisma(): Promise<PrismaClient>;
  /** 重置 = 删库重建（从模板库拷）。先前取的客户端作废 */
  reset(): Promise<void>;
}

/** 一个测试库从建到收尾。useTestDatabase 把它挂到 Vitest 的钩子上；单独用时自己调 dispose */
export class TestDatabaseHandle implements TestDatabase {
  readonly name: string;
  readonly #options: TestDatabaseOptions;
  #created: Promise<void> | undefined;
  #prisma: PrismaClient | undefined;

  constructor(name: string, options: TestDatabaseOptions = {}) {
    // 名字与角色在这里就过一遍守卫：不是测试库、角色名写错，构造时即抛错
    testDatabaseUrl(name, options);
    this.name = name;
    this.#options = options;
  }

  /** 库建了没有 */
  get created(): boolean {
    return this.#created !== undefined;
  }

  #ensure(): Promise<void> {
    // 同名的库还在，说明上一轮没收尾（进程被杀）：删掉重建
    this.#created ??= resetTestDatabase(this.name);
    return this.#created;
  }

  async url(): Promise<string> {
    await this.#ensure();
    return testDatabaseUrl(this.name, this.#options);
  }

  async prisma(): Promise<PrismaClient> {
    const connectionString = await this.url();
    this.#prisma ??= createPrismaClient({ connectionString, max: this.#options.max ?? 4 });
    return this.#prisma;
  }

  async #disconnect(): Promise<void> {
    const prisma = this.#prisma;
    this.#prisma = undefined;
    await prisma?.$disconnect();
  }

  async reset(): Promise<void> {
    await this.#disconnect();
    this.#created = resetTestDatabase(this.name);
    await this.#created;
  }

  /**
   * 收尾。没建过库就什么都不做；用例全过即删库；有失败就改名留下，返回留下的库名。
   * 改名不成（极少见）就原名留着，同样返回库名。
   */
  async dispose(outcome: { failed: boolean }): Promise<string | undefined> {
    await this.#disconnect();
    if (!this.#created) return undefined;
    await this.#created.catch(() => {});
    this.#created = undefined;
    if (!outcome.failed) {
      await dropTestDatabase(this.name);
      return undefined;
    }
    let kept = `${this.name}_k${Date.now().toString(36)}`;
    try {
      await renameTestDatabase(this.name, kept);
    } catch {
      kept = this.name;
    }
    console.warn(`有用例或钩子失败，测试库留着没删：${kept}（看完用 pnpm test:db:prune 清掉）`);
    return kept;
  }
}

/**
 * 本项目挂了测试支架的 globalSetup 没有：没挂即抛错。useTestDatabase、useTestRedis 一上来先过它。
 * 认的是 globalSetup 给出的并行数（按项目给，没挂的项目取不到）。为什么非挂不可：
 * 模板库由它建；pnpm test:isolation --scope connected（CI 的那一步）按“挂没挂 globalSetup”认哪些项目连库、连 Redis，
 * 用了支架却没挂的项目会被漏在外面。只连 Redis、不连库的项目同样要挂。
 */
export function assertTestScaffoldAttached(): void {
  if ((inject("lyxTestMaxWorkers") as number | undefined) !== undefined) return;
  throw new Error(
    '本包的 vitest.config.ts 没有挂测试支架的 globalSetup：在 test 里加一行 globalSetup: ["@liyoxi/services/testing/global-setup"]（packages/services/src/testing/README.md 第 7 节）',
  );
}

/** 这一组里有没有失败：哪条用例失败，或者哪一层的钩子失败（钩子失败记在它所在的那一组上） */
function hasFailure(task: RunnerTask): boolean {
  if (task.result?.state === "fail") return true;
  return task.type === "suite" && task.tasks.some(hasFailure);
}

/**
 * 给当前测试文件一个库。在文件顶层（或 describe 里）调用：它登记一个 aroundAll，
 * 把这一组用例连同它的 beforeAll、afterAll 整个包在里面，跑完之后看结果再收尾。
 * 不用 afterAll 收尾：别的 afterAll 先抛了错，排在后面的就不执行了；beforeAll 失败时用例一条不跑，
 * 靠用例上的 onTestFailed 也记不到。
 * @param pkg 库名里的包：db、services、api、worker
 */
export function useTestDatabase(pkg: TestPackage, options: TestDatabaseOptions = {}): TestDatabase {
  assertTestScaffoldAttached();
  const handle = new TestDatabaseHandle(testDatabaseName(pkg, { label: options.label }), options);
  // 这一组的任务对象：文件顶层登记时取到的是文件，describe 里登记时是那个 describe
  const collector = getCurrentSuite();
  // 回调只写一个参数：Vitest 会解析回调的参数表，第二个参数不是解构写法就报错
  aroundAll(async (runSuite) => {
    try {
      await runSuite();
    } finally {
      const suite = collector.suite ?? collector.file;
      await handle.dispose({ failed: suite === undefined || hasFailure(suite) });
    }
  }, DISPOSE_TIMEOUT_MS);
  return handle;
}
