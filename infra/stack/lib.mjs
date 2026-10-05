// @ts-check
// 狸有戏 · 本地整套环境的脚本共用的部分（W1-22）：名字与取值、跑 docker、库名的守卫。只用 Node 内置模块。
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** 仓库根目录 */
export const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** 共享的本地依赖（infra/compose/local.yml）：网络、三个容器、库的管理账号（在容器里经本机套接字连，不用口令） */
export const DEPS = {
  composeFile: join(root, "infra/compose/local.yml"),
  network: "liyoxi_default",
  containers: ["lyx-postgres", "lyx-redis", "lyx-minio"],
  postgres: { container: "lyx-postgres", user: "liyoxi" },
  redis: { container: "lyx-redis" },
};

/** 整套环境（infra/compose/stack.yml）：四个容器、共享卷、Redis 的库号与键前缀 */
export const STACK = {
  composeFile: join(root, "infra/compose/stack.yml"),
  lanFile: join(root, "infra/stack/lan.yml"),
  containers: ["lyx-mediatool", "lyx-api", "lyx-worker", "lyx-gateway"],
  volume: "lyx-stack-work",
  redisDb: 1,
  redisKeyPattern: "lyx:local:*",
  hosts: { api: "api.localhost", admin: "admin.localhost", portal: "portal.localhost" },
};

/** 实例上不许 --reset 删掉的库：两个校验库，以及测试支架与门禁自测的库 */
const RESERVED_DATABASES = ["lyx_schema_check", "lyx_migrate_check"];
const RESERVED_PREFIXES = ["lyx_test_", "lyx_selftest_"];

/**
 * 读环境变量里的可调项（都可以不设）：
 *   LYX_STACK_DB    整套环境用的库，缺省 lyx_stack
 *   LYX_STACK_PORT  gateway 发布到宿主机的端口，缺省 8080
 *   LYX_STACK_TAG   三个镜像的标签，缺省 local
 * @param {NodeJS.ProcessEnv} [env]
 */
export function readConfig(env = process.env) {
  const db = env.LYX_STACK_DB?.trim() || "lyx_stack";
  const port = Number(env.LYX_STACK_PORT?.trim() || "8080");
  const tag = env.LYX_STACK_TAG?.trim() || "local";
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(db)) {
    throw new UsageError(`库名 ${JSON.stringify(db)} 不合规：只能用小写字母、数字、下划线`);
  }
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new UsageError("LYX_STACK_PORT 要是 1 到 65535 之间的整数");
  }
  if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(tag)) {
    throw new UsageError(`镜像标签 ${JSON.stringify(tag)} 不合规`);
  }
  return {
    db,
    port,
    tag,
    images: {
      server: `liyoxi/server:${tag}`,
      gateway: `liyoxi/gateway:${tag}`,
      mediatool: `liyoxi/mediatool:${tag}`,
    },
  };
}

/** 用法或环境不对：打印说明，以 2 退出 */
export class UsageError extends Error {}
/** 某一步没做成：打印说明，以 1 退出 */
export class StepError extends Error {}

/**
 * --reset 要删库：只许删整套环境自己的库。名字不以 lyx_ 开头、是两个校验库之一、是测试库，一律拒绝。
 * @param {string} db
 */
export function assertResettable(db) {
  if (!db.startsWith("lyx_")) {
    throw new UsageError(`拒绝执行：库名 ${db} 不以 lyx_ 开头，--reset 不删它`);
  }
  if (
    RESERVED_DATABASES.includes(db) ||
    RESERVED_PREFIXES.some((prefix) => db.startsWith(prefix))
  ) {
    throw new UsageError(`拒绝执行：${db} 是校验库或测试库，不是整套环境的库，--reset 不删它`);
  }
}

/**
 * 跑一条 docker 命令。capture 为真时收下标准输出（标准错误也收下，出错时一并给出），否则直接透到终端。
 * @param {string[]} args
 * @param {{ capture?: boolean, env?: NodeJS.ProcessEnv, timeoutMs?: number, input?: string }} [options]
 * @returns {{ status: number, stdout: string, stderr: string }}
 */
export function docker(args, options = {}) {
  const result = spawnSync("docker", args, {
    cwd: root,
    env: options.env ?? process.env,
    encoding: "utf8",
    input: options.input,
    stdio: options.capture ? ["pipe", "pipe", "pipe"] : ["ignore", "inherit", "inherit"],
    timeout: options.timeoutMs ?? 30 * 60_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) {
    const code = /** @type {NodeJS.ErrnoException} */ (result.error).code;
    if (code === "ENOENT") throw new UsageError("找不到 docker 命令：本机要装 Docker 并在运行");
    throw new StepError(`docker ${args[0]} 没跑成：${result.error.message}`);
  }
  return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

/**
 * 同 docker，退出码非 0 即抛 StepError。
 * @param {string} what 这一步是什么，出错时打印
 * @param {string[]} args
 * @param {Parameters<typeof docker>[1]} [options]
 */
export function mustDocker(what, args, options = {}) {
  const result = docker(args, options);
  if (result.status !== 0) {
    const detail = options.capture ? `\n${`${result.stdout}\n${result.stderr}`.trim()}` : "";
    throw new StepError(`${what}没成（退出码 ${result.status}）${detail}`);
  }
  return result;
}

/**
 * 一个容器现在的状态；没有这个容器返回 null。
 * @param {string} name
 * @returns {{ status: string, health: string } | null}
 */
export function containerState(name) {
  const result = docker(
    [
      "inspect",
      "--type",
      "container",
      "-f",
      "{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}",
      name,
    ],
    { capture: true },
  );
  if (result.status !== 0) return null;
  const [status = "", health = ""] = result.stdout.trim().split(/\s+/);
  return { status, health };
}

/** docker 守护进程连得上吗：连不上给一句人话 */
export function assertDockerRunning() {
  const result = docker(["version", "--format", "{{.Server.Version}}"], { capture: true });
  if (result.status !== 0) {
    throw new UsageError("连不上 Docker：先把本机的 Docker 起起来");
  }
}

/**
 * 脚本的出口：UsageError 以 2 退出，别的错以 1 退出，都只打印说明。
 * @param {() => Promise<void> | void} main
 */
export async function runMain(main) {
  try {
    await main();
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(error.message);
      process.exitCode = 2;
    } else if (error instanceof StepError) {
      console.error(error.message);
      process.exitCode = 1;
    } else {
      throw error;
    }
  }
}
