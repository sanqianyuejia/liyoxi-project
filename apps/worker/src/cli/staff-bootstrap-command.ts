// 引导命令的本体（W1-01a；D4 第 6.4 节；x01 第 4.6 节 staff:bootstrap）：建第一位超级管理员。
// 入口在同目录的 staff-bootstrap.ts，构建产物是 dist/staff-bootstrap.js（随 server 镜像，服务器上跑它）；
// 本机用 pnpm staff:bootstrap --name <姓名> --phone <手机号>。
//   只在库里没有启用的超级管理员时可执行；建出来是“待激活”（启用、没有口令），激活码只在终端输出这一次、库里只存哈希，
//   24 小时内到后台的激活页用手机号加激活码设密码、绑动态口令。之后的账号都从后台界面新增。
//   退出码：0 建好了；1 被拒绝（已有启用的超级管理员、手机号已被占用、姓名或手机号不合规、参数不对）；
//           2 环境变量或密钥不对、连不上库。连接串、口令、密钥不打印。
// 要三份密钥文件（DATA_KEYS_FILE、BIDX_KEYS_FILE、AUTH_KEYS_FILE）：手机号加密存放，凭据用例装配时一并加载。
// 这里是薄壳：判定、写库、留痕（状态历史、ops 审计、staff.created）都在 @liyoxi/services 的 staff。
import { parseArgs } from "node:util";

import { createRuntime, EnvError, isAppError, loadEnv, security } from "@liyoxi/services";

export interface StaffBootstrapOptions {
  /** 命令行参数（不含 node 与脚本名），缺省 process.argv.slice(2) */
  readonly argv?: readonly string[];
  /** 环境变量从哪读，缺省 process.env；用例里传对象 */
  readonly source?: Readonly<Record<string, string | undefined>>;
  /** 写进产物的版本号，只进日志 */
  readonly version?: string;
  readonly out?: (line: string) => void;
  readonly err?: (line: string) => void;
}

const USAGE = "用法：staff:bootstrap --name <姓名，1 到 10 个字> --phone <11 位手机号>";

export async function runStaffBootstrapCommand(
  options: StaffBootstrapOptions = {},
): Promise<number> {
  const out = options.out ?? ((line: string) => void process.stdout.write(`${line}\n`));
  const err = options.err ?? ((line: string) => void process.stderr.write(`${line}\n`));

  let name: string | undefined;
  let phone: string | undefined;
  try {
    const { values } = parseArgs({
      args: [...(options.argv ?? process.argv.slice(2))],
      options: { name: { type: "string" }, phone: { type: "string" } },
    });
    ({ name, phone } = values);
  } catch {
    // 不认识的参数、缺值
  }
  if (name === undefined || phone === undefined) {
    err(USAGE);
    return 1;
  }

  let env;
  try {
    env = loadEnv(options.source ?? process.env);
  } catch (error) {
    if (!(error instanceof EnvError)) throw error;
    err(`引导：${error.message}`);
    return 2;
  }
  // 日志只留告警以上：这条命令的输出是给人看的工号与激活码
  const runtime = createRuntime({
    entry: "worker",
    env: { ...env, LOG_LEVEL: "warn" },
    version: options.version ?? "dev",
  });
  try {
    const created = await runtime.staffAuth.bootstrap({ name, phone });
    out(`已建立第一位超级管理员：${name.trim()}（工号 ${created.staffNo}）`);
    out(`激活码：${created.activationCode}`);
    out(
      `只显示这一次，${created.activationExpiresAt.toISOString()} 前有效。到后台的激活页用手机号加激活码设置密码、绑定动态口令。`,
    );
    return 0;
  } catch (error) {
    if (isAppError(error)) {
      err(`引导被拒绝：${error.message}`);
      return 1;
    }
    if (error instanceof security.SecurityError) {
      err(`引导：${error.message}`);
      return 2;
    }
    // 只打印错误的类型与说明：连接串可能出现在驱动的报错对象里，不整个打印
    err(`引导失败：${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`);
    return 2;
  } finally {
    await runtime.close().catch(() => undefined);
  }
}
