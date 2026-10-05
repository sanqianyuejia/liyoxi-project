/**
 * 演示种子的命令行入口（W1-01a 起头）。根脚本：pnpm db:seed:demo。
 *
 * 用法（在仓库根目录，库要先跑完迁移与播种：pnpm db:deploy && pnpm db:seed）：
 *   APP_ENV=local DATABASE_URL=… REDIS_URL=… DATA_KEYS_FILE=… BIDX_KEYS_FILE=… pnpm db:seed:demo
 * 连接参数只经 loadEnv 读环境变量（本地的取值见 CLAUDE.md 第 9 节）。要字段加密的两份密钥文件（员工手机号加密存放）；
 * Redis 用不到，只是 loadEnv 要它在。只进本地、测试与预发：APP_ENV=prod 拒绝执行。
 *
 * 做什么：按固定的先后跑各模块的演示种子（现在只有演示员工 7 位），打印各表新增与已有的行数；
 * 本次新建的演示员工各打印一枚激活码，只显示这一次（库里只存哈希），24 小时内到后台的激活页设密码、绑动态口令。
 * 可以反复跑：已有的不重建、不重发码。
 * 退出码：0 成功；1 被拒绝（生产环境）；2 环境变量或密钥不对、连不上库。连接串、口令、密钥不打印。
 * 运行器与规矩见 ../src/demo-seed.ts 开头的注释。
 */
import { DemoSeedRefusedError, runDemoSeed } from "../src/demo-seed.js";
import { EnvError, loadEnv } from "../src/kernel/index.js";
import { createRuntime } from "../src/runtime.js";
import { loadKeyring, SecurityError } from "../src/security/index.js";

async function main(): Promise<number> {
  let env;
  let keyring;
  try {
    env = loadEnv();
    if (env.APP_ENV === "prod") throw new DemoSeedRefusedError();
    keyring = loadKeyring(env);
  } catch (error) {
    if (error instanceof DemoSeedRefusedError) {
      console.error(error.message);
      return 1;
    }
    if (!(error instanceof EnvError) && !(error instanceof SecurityError)) throw error;
    console.error(`演示种子：${error.message}`);
    return 2;
  }
  // 日志只留告警以上：这条命令的输出是给人看的行数与激活码
  const runtime = createRuntime({
    entry: "worker",
    env: { ...env, LOG_LEVEL: "warn" },
    version: "dev",
  });
  try {
    const report = await runDemoSeed({
      tx: runtime.tx,
      clock: runtime.clock,
      keyring,
      flow: runtime.flow,
      appEnv: env.APP_ENV,
    });
    for (const table of report.tables) {
      console.log(
        `${table.step.padEnd(8)} ${table.table.padEnd(24)} 新增 ${String(table.inserted).padStart(4)}  已有 ${String(table.existing).padStart(4)}`,
      );
    }
    console.log(`演示种子完成：新增 ${report.inserted} 行`);
    const issued = report.staff.filter((member) => member.activation !== null);
    if (issued.length > 0) {
      console.log(
        "\n新建的演示员工（激活码只显示这一次，24 小时内有效；登录手机号见 staff/demo-seed.ts）：",
      );
      for (const member of issued) {
        console.log(
          `  工号 ${member.staffNo}  ${member.name.padEnd(8, "　")} ${member.roleKey.padEnd(18)} 激活码 ${member.activation?.code}`,
        );
      }
    }
    return 0;
  } finally {
    await runtime.close().catch(() => undefined);
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    // 只打印错误的类型与说明：连接串可能出现在驱动的报错对象里，不整个打印
    console.error(
      `演示种子失败：${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`,
    );
    process.exitCode = 2;
  },
);
