#!/usr/bin/env node
// @ts-check
// 狸有戏 · 本地整套环境的构建、起、停（W1-22）。在宿主机上跑，只用 Node 内置模块与 docker 命令行。
//
//   node infra/stack/up.mjs build            pnpm stack:build   出三个镜像：liyoxi/{server,gateway,mediatool}:local
//   node infra/stack/up.mjs up [--lan] [--build]   pnpm stack:up   一条命令起整套
//   node infra/stack/up.mjs down [--reset]   pnpm stack:down    只停本环境的四个容器
//
// up 做什么：依赖（PostgreSQL、Redis、MinIO）没起先起（等同 pnpm infra:up）→ 镜像不在就先构建（--build 强制重建）
//   → 核对 gateway 的端口没被别人占 → 建库（已有就不建）→ 用 server 镜像起一次性容器跑迁移、再跑播种
//   → 起四个容器，都健康才返回。可以反复跑：迁移没有待执行的就什么都不做，播种只插缺的行。
//   --lan：gateway 改绑全部网卡，另开一个端口把请求原样转给 MinIO，按 IP 进来的请求全部转 api（真机走局域网）。
//          口令是公开的开发值，只在可信的局域网里开。
// down 做什么：停掉并删除四个容器；卷与库保留，依赖的三个容器不动。
//   --reset：另删本环境的库、共享卷与它在 Redis 里的键。库名不以 lyx_ 开头，或是校验库、测试库，拒绝执行，什么都不动。
// 可调的环境变量见 lib.mjs 的 readConfig；另有 LYX_NPM_REGISTRY（构建镜像时换 npm 源）。
// 退出码：0 成功；1 某一步没成；2 用法或环境不对（没有 Docker、端口被占、库名不合规）。
import { spawn, spawnSync } from "node:child_process";
import net from "node:net";
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";

import {
  assertDockerRunning,
  assertResettable,
  containerState,
  DEPS,
  docker,
  mustDocker,
  readConfig,
  root,
  runMain,
  STACK,
  StepError,
  UsageError,
} from "./lib.mjs";

const USAGE = "用法：node infra/stack/up.mjs build | up [--lan] [--build] | down [--reset]";
const say = (/** @type {string} */ line) => console.log(`== ${line}`);

/** @typedef {ReturnType<typeof readConfig>} Config */

/**
 * 给 docker compose 的参数与环境：stack.yml 里的 ${LYX_STACK_*} 都从这里来。
 * @param {Config} config
 * @param {{ lan?: boolean, trustedCidrs?: string }} [options]
 */
function compose(config, options = {}) {
  const files = ["-f", STACK.composeFile, ...(options.lan ? ["-f", STACK.lanFile] : [])];
  return {
    args: ["compose", ...files],
    env: {
      ...process.env,
      LYX_STACK_DB: config.db,
      LYX_STACK_TAG: config.tag,
      LYX_STACK_PORT: String(config.port),
      LYX_STACK_BIND: options.lan ? "0.0.0.0" : "127.0.0.1",
      LYX_STACK_TRUSTED_CIDRS: options.trustedCidrs ?? "",
    },
  };
}

/** 构建号：sha-<12 位提交号>；工作区有没提交的改动时带 -dirty。不在 git 检出里就是 dev */
function buildNumber() {
  const git = (/** @type {string[]} */ args) =>
    spawnSync("git", args, { cwd: root, encoding: "utf8" });
  const head = git(["rev-parse", "--short=12", "HEAD"]);
  if (head.status !== 0) return "dev";
  const dirty = (git(["status", "--porcelain"]).stdout ?? "").trim() !== "";
  return `sha-${head.stdout.trim()}${dirty ? "-dirty" : ""}`;
}

/**
 * 跑一条 docker build，输出逐行加上前缀（三个镜像同时构建，输出是交错的）。
 * @param {string} label
 * @param {string[]} args
 * @returns {Promise<{ label: string, status: number }>}
 */
function buildOne(label, args) {
  return new Promise((done) => {
    const child = spawn("docker", ["build", "--progress", "plain", ...args], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
    });
    for (const stream of [child.stdout, child.stderr]) {
      createInterface({ input: stream }).on("line", (line) => console.log(`[${label}] ${line}`));
    }
    child.on("error", (error) => {
      console.error(`[${label}] docker build 没跑起来：${error.message}`);
      done({ label, status: 1 });
    });
    child.on("close", (code) => done({ label, status: code ?? 1 }));
  });
}

/**
 * 三个镜像同时构建：各自的大头是下载，并着跑省一半时间。server 与 gateway 的上下文是仓库根，
 * mediatool 的是它自己的目录（镜像定义是 X-02 的那一份，原样用）。
 * @param {Config} config
 */
async function build(config) {
  const number = buildNumber();
  const registry = process.env.LYX_NPM_REGISTRY?.trim();
  const buildArgs = [
    "--build-arg",
    `LYX_BUILD=${number}`,
    ...(registry ? ["--build-arg", `NPM_CONFIG_REGISTRY=${registry}`] : []),
  ];
  say(`构建三个镜像（构建号 ${number}）：${Object.values(config.images).join("、")}`);
  const results = await Promise.all([
    buildOne("mediatool", ["-t", config.images.mediatool, "infra/docker/mediatool"]),
    buildOne("server", [
      "-f",
      "infra/docker/server/Dockerfile",
      ...buildArgs,
      "-t",
      config.images.server,
      ".",
    ]),
    buildOne("gateway", [
      "-f",
      "infra/docker/gateway/Dockerfile",
      ...buildArgs,
      "-t",
      config.images.gateway,
      ".",
    ]),
  ]);
  const failed = results.filter((result) => result.status !== 0);
  if (failed.length > 0) {
    throw new StepError(
      `镜像没构建成：${failed.map((result) => `${result.label}（退出码 ${result.status}）`).join("、")}。往上翻带同名前缀的输出`,
    );
  }
  say("三个镜像已构建");
}

/** @param {string} image */
const imageExists = (image) =>
  docker(["image", "inspect", "-f", "{{.Id}}", image], { capture: true }).status === 0;

/** 依赖的三个容器都在跑且健康吗 */
function depsReady() {
  return DEPS.containers.every((name) => {
    const state = containerState(name);
    return state !== null && state.status === "running" && state.health === "healthy";
  });
}

function ensureDeps() {
  if (depsReady()) {
    say("依赖已在运行：PostgreSQL、Redis、MinIO");
    return;
  }
  say("依赖没起：先起 PostgreSQL、Redis、MinIO（等同 pnpm infra:up）");
  mustDocker("起本地依赖", ["compose", "-f", DEPS.composeFile, "up", "-d", "--wait"]);
}

/**
 * 在 PostgreSQL 容器里跑一句 SQL，返回输出。
 * @param {string} what
 * @param {string} sql
 */
function psql(what, sql) {
  const { container, user } = DEPS.postgres;
  return mustDocker(
    what,
    [
      "exec",
      container,
      "psql",
      "-X",
      "-U",
      user,
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-Atc",
      sql,
    ],
    { capture: true },
  ).stdout.trim();
}

/** @param {string} db 已经过 readConfig 的格式核对 */
const databaseExists = (db) =>
  psql("查库在不在", `SELECT 1 FROM pg_database WHERE datname = '${db}'`) === "1";

/**
 * 我们自己的 gateway 是不是已经占着这个端口（再跑一遍 up 时）。
 * @param {number} port
 */
function gatewayHolds(port) {
  const result = docker(
    [
      "inspect",
      "--type",
      "container",
      "-f",
      "{{.State.Running}} {{json .HostConfig.PortBindings}}",
      "lyx-gateway",
    ],
    { capture: true },
  );
  return (
    result.status === 0 &&
    result.stdout.startsWith("true ") &&
    result.stdout.includes(`"HostPort":"${port}"`)
  );
}

/**
 * 宿主机上这个端口现在能不能绑。
 * @param {number} port
 * @param {string} host
 * @returns {Promise<boolean>}
 */
function portFree(port, host) {
  return new Promise((done) => {
    const probe = net.createServer();
    probe.once("error", () => done(false));
    probe.listen({ port, host, exclusive: true }, () => probe.close(() => done(true)));
  });
}

/** 共享网络的网段：填进 gateway 的可信代理 */
function networkCidrs() {
  const result = docker(
    ["network", "inspect", "-f", "{{range .IPAM.Config}}{{.Subnet}} {{end}}", DEPS.network],
    { capture: true },
  );
  if (result.status !== 0) {
    throw new StepError(`找不到网络 ${DEPS.network}：它是 local.yml 那个项目的网络，依赖没起来`);
  }
  return result.stdout.trim().split(/\s+/).filter(Boolean).join(" ");
}

/**
 * @param {Config} config
 * @param {{ lan: boolean, build: boolean }} flags
 */
async function up(config, flags) {
  assertDockerRunning();
  ensureDeps();

  const missing = Object.values(config.images).filter((image) => !imageExists(image));
  if (flags.build || missing.length > 0) {
    if (!flags.build) say(`镜像还没有：${missing.join("、")}`);
    await build(config);
  }

  const bind = flags.lan ? "0.0.0.0" : "127.0.0.1";
  if (!gatewayHolds(config.port) && !(await portFree(config.port, bind))) {
    throw new UsageError(
      `端口 ${config.port} 被占用，gateway 起不来。先停掉占用它的进程，或换一个端口：LYX_STACK_PORT=<端口> pnpm stack:up`,
    );
  }

  if (databaseExists(config.db)) {
    say(`库 ${config.db} 已存在：不重建`);
  } else {
    say(`建库 ${config.db}`);
    psql("建库", `CREATE DATABASE "${config.db}"`);
  }

  const one = compose(config, { lan: flags.lan, trustedCidrs: networkCidrs() });
  say("迁移：prisma migrate deploy（server 镜像的一次性容器）");
  mustDocker("迁移", [...one.args, "run", "--rm", "migrate"], { env: one.env });
  say("播种（server 镜像的一次性容器；只插缺的行）");
  mustDocker("播种", [...one.args, "run", "--rm", "seed"], { env: one.env });

  say(`起四个容器，等它们都健康${flags.lan ? "（--lan：绑全部网卡）" : ""}`);
  const started = docker([...one.args, "up", "-d", "--wait", "--wait-timeout", "240"], {
    env: one.env,
  });
  if (started.status !== 0) {
    docker([...one.args, "ps", "-a"], { env: one.env });
    for (const name of STACK.containers) {
      const state = containerState(name);
      if (state === null || (state.status === "running" && state.health === "healthy")) continue;
      console.error(`\n-- ${name}（${state.status}，${state.health}）最后 40 行日志 --`);
      docker(["logs", "--tail", "40", name]);
    }
    throw new StepError("四个容器没有都健康：看上面的状态与日志");
  }

  const at = (/** @type {string} */ host) => `http://${host}:${config.port}`;
  console.log(
    [
      "",
      "整套环境已起：",
      `  后台      ${at(STACK.hosts.admin)}`,
      `  下载页    ${at(STACK.hosts.portal)}`,
      `  接口      ${at(STACK.hosts.api)}（探活 /healthz、/readyz、/health）`,
      `  库 ${config.db}；Redis ${STACK.redisDb} 号库；冒烟 pnpm stack:smoke；停 pnpm stack:down`,
      ...(flags.lan
        ? [
            "  --lan：手机与开发者工具用 http://<本机局域网地址>:" +
              `${config.port}（全部转 api）；对象存储在 lan.yml 写的那个端口`,
          ]
        : []),
    ].join("\n"),
  );
}

/**
 * @param {Config} config
 * @param {{ reset: boolean }} flags
 */
function down(config, flags) {
  // 守卫排在最前面：库名不许删时什么都不动
  if (flags.reset) assertResettable(config.db);
  assertDockerRunning();

  const one = compose(config);
  say("停掉并删除四个容器（卷与库保留，依赖的三个容器不动）");
  mustDocker("停整套环境", [...one.args, "down", "--remove-orphans"], { env: one.env });
  if (!flags.reset) return;

  const postgres = containerState(DEPS.postgres.container);
  if (postgres === null || postgres.status !== "running") {
    throw new StepError(
      `--reset 没做完：${DEPS.postgres.container} 没在运行，库 ${config.db} 没删。先 pnpm infra:up 再重跑`,
    );
  }
  say(`--reset：删库 ${config.db}`);
  psql("删库", `DROP DATABASE IF EXISTS "${config.db}" WITH (FORCE)`);
  say(`--reset：删共享卷 ${STACK.volume}`);
  const volume = docker(["volume", "rm", STACK.volume], { capture: true });
  if (volume.status !== 0 && !/no such volume/i.test(volume.stderr)) {
    throw new StepError(`删共享卷没成：${volume.stderr.trim()}`);
  }
  const redis = containerState(DEPS.redis.container);
  if (redis !== null && redis.status === "running") {
    // 只清本环境的键（SCAN 加 UNLINK），不用 FLUSHDB：这个库号万一还有别人的键，不动它
    say(`--reset：清 Redis ${STACK.redisDb} 号库里 ${STACK.redisKeyPattern} 的键`);
    const cli = `redis-cli -n ${STACK.redisDb}`;
    mustDocker(
      "清 Redis 的键",
      [
        "exec",
        DEPS.redis.container,
        "sh",
        "-c",
        `${cli} --scan --pattern '${STACK.redisKeyPattern}' | xargs -r -n 500 ${cli} UNLINK`,
      ],
      { capture: true },
    );
  }
  say("已重置：下次 pnpm stack:up 从空库开始");
}

await runMain(async () => {
  const [command, ...rest] = process.argv.slice(2);
  if (command !== "build" && command !== "up" && command !== "down") throw new UsageError(USAGE);
  let flags;
  try {
    flags = parseArgs({
      args: rest,
      options: {
        lan: { type: "boolean", default: false },
        build: { type: "boolean", default: false },
        reset: { type: "boolean", default: false },
      },
    }).values;
  } catch {
    throw new UsageError(USAGE);
  }
  const config = readConfig();
  if (command === "build") {
    assertDockerRunning();
    await build(config);
  } else if (command === "up") {
    await up(config, { lan: flags.lan, build: flags.build });
  } else {
    down(config, { reset: flags.reset });
  }
});
