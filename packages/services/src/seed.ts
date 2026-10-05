// 播种的运行器（W0-21）：一条命令把空库播成能开工的样子，也可以每次发版紧跟迁移再跑一遍。
//   命令：pnpm db:seed（入口 packages/services/scripts/seed.ts）。连 DATABASE_URL 指的库，要先跑完迁移；
//         按应用角色 lyx_app 的授权就够。打印各表新增与已有的行数，再跑六条断言，有违规即非 0 退出。
//   规矩：没有才插，已有的行一概不改（运营改过的开关、角色权限、场景开关都留着）；
//         注册表里新登记的键（开关、通知场景）下一次跑时自动补进库。
//   不是迁移：验收要可重复执行；注册表会长；测试库由迁移建模板，种子进了迁移会与用例自己写的行撞主键
//  （任务书 W0-21 第 10 节第 1 项）。分组文档里的“由迁移播种”读作“紧跟迁移跑播种”。
//   加种子：在模块目录里写 seed.ts（defineSeed），从模块入口给出，再在下面的清单里加一行。
// 本文件是包级文件，不属于任何一层：只引各模块的 index.ts。
import { seed as billingSeed } from "./billing/index.js";
import { configSeedAssertions, seed as configSeed } from "./config/index.js";
import { seed as docsSeed } from "./docs/index.js";
import { runSqlAssertion, TX_TIMEOUT_MAX_MS } from "./kernel/index.js";
import type {
  AssertionViolation,
  Clock,
  ModuleSeed,
  SeedTableResult,
  SqlAssertion,
  SqlReader,
  TxRunner,
} from "./kernel/index.js";
import { seed as notifySeed } from "./notify/index.js";
import { seed as slaSeed } from "./sla/index.js";
import { seed as staffSeed, staffSeedAssertions } from "./staff/index.js";

/** 带种子的模块，下层在前。一个模块一个事务 */
export const SEED_MODULES: readonly ModuleSeed[] = [
  configSeed,
  slaSeed,
  staffSeed,
  notifySeed,
  docsSeed,
  billingSeed,
];

export interface SeedDeps {
  readonly tx: TxRunner;
  readonly clock: Clock;
  /** 只跑这几份（用例里用）；缺省是 SEED_MODULES */
  readonly modules?: readonly ModuleSeed[];
}

export interface SeedReport {
  /** 本次播种的时刻：各表的时间列都写它 */
  readonly at: Date;
  readonly tables: readonly (SeedTableResult & { readonly module: string })[];
  /** 新增的总行数；再跑一遍应为 0 */
  readonly inserted: number;
}

export async function runSeed(deps: SeedDeps): Promise<SeedReport> {
  const at = deps.clock.now();
  const tables: (SeedTableResult & { module: string })[] = [];
  for (const moduleSeed of deps.modules ?? SEED_MODULES) {
    const results = await deps.tx.run(
      async (handle) => {
        // 两个播种进程同时跑时排队：后到的那个看到的是先到的已经写完的库
        await handle.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext('lyx:seed'))");
        return moduleSeed.run(handle, { now: at });
      },
      { timeoutMs: TX_TIMEOUT_MAX_MS },
    );
    tables.push(...results.map((result) => ({ module: moduleSeed.module, ...result })));
  }
  return { at, tables, inserted: tables.reduce((sum, table) => sum + table.inserted, 0) };
}

/**
 * 六条配置类不变量的 SQL 断言：staff.I8、config.N9、N16、N17、N19、N20。
 * 六条都已登记进不变量框架（W0-24；config、staff 各自的 register.ts），随 invariant.full 每日跑；播种命令与用例也照跑。
 */
export function seedAssertions(now: Date): SqlAssertion[] {
  return [...staffSeedAssertions(), ...configSeedAssertions(now)];
}

/** 跑全部断言，返回违规行；空数组即全部通过 */
export async function checkSeedAssertions(db: SqlReader, now: Date): Promise<AssertionViolation[]> {
  const violations: AssertionViolation[] = [];
  for (const assertion of seedAssertions(now)) {
    violations.push(...(await runSqlAssertion(db, assertion)));
  }
  return violations;
}
