// 播种命令的本体（W1-22）：server 镜像里跑得了的那一份。入口在同目录的 seed.ts，构建产物是 dist/seed.js。
// 与 pnpm db:seed（packages/services/scripts/seed.ts，靠 tsx 跑源码，镜像里没有）做同一件事、同一组退出码：
// 按模块把缺的初始行插进去（没有才插，已有的行不改），再跑六条配置类断言。可以反复跑。
//   0 播完且断言 0 违规；1 有违规；2 环境变量不对或连不上库。连接串与口令不打印。
// 这里是薄壳：事务入口取进程运行时的（createRuntime），播种与断言都是 @liyoxi/services 的导出。
import { checkSeedAssertions, createRuntime, EnvError, loadEnv, runSeed } from "@liyoxi/services";

export interface SeedCommandOptions {
  /** 环境变量从哪读，缺省 process.env；用例里传对象 */
  readonly source?: Readonly<Record<string, string | undefined>>;
  /** 写进产物的版本号，只进日志 */
  readonly version?: string;
  readonly out?: (line: string) => void;
  readonly err?: (line: string) => void;
}

export async function runSeedCommand(options: SeedCommandOptions = {}): Promise<number> {
  const out = options.out ?? ((line: string) => void process.stdout.write(`${line}\n`));
  const err = options.err ?? ((line: string) => void process.stderr.write(`${line}\n`));
  let env;
  try {
    env = loadEnv(options.source ?? process.env);
  } catch (error) {
    if (!(error instanceof EnvError)) throw error;
    err(`播种：${error.message}`);
    return 2;
  }
  // 日志只留告警以上：这条命令的输出是给人看的行数与断言结论
  const runtime = createRuntime({
    entry: "worker",
    env: { ...env, LOG_LEVEL: "warn" },
    version: options.version ?? "dev",
  });
  try {
    const report = await runSeed({ tx: runtime.tx, clock: runtime.clock });
    for (const table of report.tables) {
      out(
        `${table.module.padEnd(8)} ${table.table.padEnd(22)} 新增 ${String(table.inserted).padStart(4)}  已有 ${String(table.existing).padStart(4)}`,
      );
    }
    out(`播种完成：新增 ${report.inserted} 行`);

    // 断言只读：放在一个事务里跑，用的是同一个事务入口
    const violations = await runtime.tx.run((tx) => checkSeedAssertions(tx, runtime.clock.now()));
    for (const item of violations) err(`违规 ${item.code}  ${item.subjectKey}：${item.detail}`);
    out(`断言：${violations.length} 条违规`);
    return violations.length === 0 ? 0 : 1;
  } catch (error) {
    // 只打印错误的类型与说明：连接串可能出现在驱动的报错对象里，不整个打印
    err(`播种失败：${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`);
    return 2;
  } finally {
    await runtime.close().catch(() => undefined);
  }
}
