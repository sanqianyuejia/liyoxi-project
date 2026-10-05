import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import type { AddressInfo, Server } from "node:net";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { makeTempDir, repoRoot, runAsync } from "./helpers.js";

// 本地整套环境（W1-22）：起停脚本与冒烟脚本的行为，三个 Compose 与镜像定义的写法。
// 脚本是真子进程，docker 命令桩掉：PATH 最前面放一个假的 docker，它把每次调用记进一个文件，
// 再按“规则表”应答（第一条对得上的规则算数；都对不上即退出码 0、没有输出）。不起任何容器，不连库。
// 用例放在这个目录：infra 项目只收 ci/test 下的用例（改 infra/vitest.config.ts 的已有行是放松类门禁改动）。

const read = (path: string) => readFileSync(join(repoRoot, path), "utf8");
const UP = join(repoRoot, "infra/stack/up.mjs");
const SMOKE = join(repoRoot, "infra/stack/smoke.mjs");

interface Rule {
  /** 对“参数用空格接起来”的正则 */
  match: string;
  status?: number;
  stdout?: string;
  stderr?: string;
}

const FAKE_DOCKER = `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
const line = args.join(" ");
const picked = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith("LYX_STACK_")));
fs.appendFileSync(process.env.FAKE_DOCKER_CALLS, JSON.stringify({ args, env: picked }) + "\\n");
const rules = JSON.parse(fs.readFileSync(process.env.FAKE_DOCKER_RULES, "utf8"));
const rule = rules.find((one) => new RegExp(one.match).test(line)) ?? {};
if (rule.stdout) process.stdout.write(rule.stdout);
if (rule.stderr) process.stderr.write(rule.stderr);
process.exit(rule.status ?? 0);
`;

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

interface Call {
  args: string[];
  env: Record<string, string>;
}

/** 在假的 docker 之下跑一个脚本，返回退出码、输出与 docker 的调用记录 */
async function runWithFakeDocker(
  script: string,
  args: string[],
  rules: Rule[],
  env: Record<string, string> = {},
) {
  const temp = makeTempDir("lyx-stack-");
  cleanups.push(temp.cleanup);
  const bin = join(temp.dir, "docker");
  writeFileSync(bin, FAKE_DOCKER);
  chmodSync(bin, 0o755);
  const callsFile = join(temp.dir, "calls.jsonl");
  writeFileSync(join(temp.dir, "rules.json"), JSON.stringify(rules));
  const saved = { ...process.env };
  // 子进程继承 process.env：只在这一次调用期间改，跑完还原
  Object.assign(process.env, {
    PATH: `${temp.dir}:${saved.PATH ?? ""}`,
    FAKE_DOCKER_CALLS: callsFile,
    FAKE_DOCKER_RULES: join(temp.dir, "rules.json"),
    ...env,
  });
  for (const key of ["LYX_STACK_DB", "LYX_STACK_PORT", "LYX_STACK_TAG", "LYX_NPM_REGISTRY"]) {
    if (!(key in env)) delete process.env[key];
  }
  try {
    const result = await runAsync("node", [script, ...args], repoRoot);
    const calls: Call[] = existsSync(callsFile)
      ? readFileSync(callsFile, "utf8")
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line) as Call)
      : [];
    return { ...result, calls, lines: calls.map((call) => call.args.join(" ")) };
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
}

/** 占住本机一个空闲端口，用例结束时放开 */
async function holdPort(): Promise<number> {
  const server: Server = createServer();
  await new Promise<void>((done) => server.listen({ port: 0, host: "127.0.0.1" }, done));
  cleanups.push(() => new Promise<void>((done) => server.close(() => done())));
  return (server.address() as AddressInfo).port;
}

/** 找一个现在空闲的端口（占一下就放开） */
async function freePort(): Promise<number> {
  const server: Server = createServer();
  await new Promise<void>((done) => server.listen({ port: 0, host: "127.0.0.1" }, done));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((done) => server.close(() => done()));
  return port;
}

// 规则表的几块积木
const DEPS_UP: Rule = {
  match: "^inspect --type container -f \\S+State\\.Status.* lyx-(postgres|redis|minio)$",
  stdout: "running healthy\n",
};
const DEPS_DOWN: Rule = {
  match: "^inspect --type container -f \\S+State\\.Status.* lyx-(postgres|redis|minio)$",
  status: 1,
  stderr: "Error: No such container\n",
};
const NO_GATEWAY: Rule = { match: "PortBindings.* lyx-gateway$", status: 1 };
const DB_EXISTS: Rule = { match: "SELECT 1 FROM pg_database", stdout: "1\n" };
const DB_MISSING: Rule = { match: "SELECT 1 FROM pg_database", stdout: "" };
const NETWORK: Rule = { match: "^network inspect", stdout: "172.30.0.0/16 \n" };

const indexOf = (lines: string[], pattern: RegExp) => lines.findIndex((line) => pattern.test(line));

describe("pnpm stack:up（起停脚本，docker 桩掉）", () => {
  it("依赖没起：先用 local.yml 起依赖，再往下；库已存在就不建", async () => {
    const port = await freePort();
    const result = await runWithFakeDocker(
      UP,
      ["up"],
      [DEPS_DOWN, NO_GATEWAY, DB_EXISTS, NETWORK],
      { LYX_STACK_PORT: String(port) },
    );
    expect(result.output).toContain("依赖没起");
    expect(result.status).toBe(0);
    const deps = indexOf(result.lines, /^compose -f \S+infra\/compose\/local\.yml up -d --wait$/);
    const migrate = indexOf(result.lines, /stack\.yml run --rm migrate$/);
    const seed = indexOf(result.lines, /stack\.yml run --rm seed$/);
    const up = indexOf(result.lines, /stack\.yml up -d --wait/);
    expect(deps).toBeGreaterThan(-1);
    expect([deps, migrate, seed, up]).toEqual([deps, migrate, seed, up].toSorted((a, b) => a - b));
    expect(migrate).toBeGreaterThan(deps);
    expect(result.lines.filter((line) => line.includes("CREATE DATABASE"))).toEqual([]);
    expect(result.output).toContain("库 lyx_stack 已存在：不重建");
    expect(result.output).toContain(`http://admin.localhost:${port}`);
  });

  it("依赖已在运行：不动 local.yml；库不存在就建，然后迁移、播种、起容器；网段传给 gateway，只绑回环", async () => {
    const port = await freePort();
    const result = await runWithFakeDocker(UP, ["up"], [DEPS_UP, NO_GATEWAY, DB_MISSING, NETWORK], {
      LYX_STACK_PORT: String(port),
    });
    expect(result.status).toBe(0);
    expect(result.lines.filter((line) => line.includes("local.yml"))).toEqual([]);
    const create = indexOf(result.lines, /CREATE DATABASE "lyx_stack"$/);
    const migrate = indexOf(result.lines, /run --rm migrate$/);
    const seed = indexOf(result.lines, /run --rm seed$/);
    const up = indexOf(result.lines, /up -d --wait/);
    expect(create).toBeGreaterThan(-1);
    expect(migrate).toBeGreaterThan(create);
    expect(seed).toBeGreaterThan(migrate);
    expect(up).toBeGreaterThan(seed);
    expect(result.calls[up]?.env).toMatchObject({
      LYX_STACK_DB: "lyx_stack",
      LYX_STACK_BIND: "127.0.0.1",
      LYX_STACK_PORT: String(port),
      LYX_STACK_TRUSTED_CIDRS: "172.30.0.0/16",
    });
    // 不带 --lan：不叠局域网那一份
    expect(result.lines.filter((line) => line.includes("lan.yml"))).toEqual([]);
  });

  it("端口被别人占着：以 2 退出并说明，不建库、不迁移、不起容器", async () => {
    const port = await holdPort();
    const result = await runWithFakeDocker(UP, ["up"], [DEPS_UP, NO_GATEWAY, DB_MISSING, NETWORK], {
      LYX_STACK_PORT: String(port),
    });
    expect(result.status).toBe(2);
    expect(result.output).toContain(`端口 ${port} 被占用`);
    expect(
      result.lines.filter((line) => /CREATE DATABASE|run --rm|up -d --wait/.test(line)),
    ).toEqual([]);
  });

  it("端口是自己的 gateway 占着（再跑一遍）：照常往下，不报错", async () => {
    const port = await holdPort();
    const ours: Rule = {
      match: "PortBindings.* lyx-gateway$",
      stdout: `true {"8080/tcp":[{"HostIp":"127.0.0.1","HostPort":"${port}"}]}\n`,
    };
    const result = await runWithFakeDocker(UP, ["up"], [DEPS_UP, ours, DB_EXISTS, NETWORK], {
      LYX_STACK_PORT: String(port),
    });
    expect(result.status).toBe(0);
    expect(indexOf(result.lines, /up -d --wait/)).toBeGreaterThan(-1);
  });

  it("镜像不在：先构建三个镜像（带构建号）；--lan 叠上局域网那一份并绑全部网卡", async () => {
    const port = await freePort();
    const result = await runWithFakeDocker(
      UP,
      ["up", "--lan"],
      [DEPS_UP, { match: "^image inspect", status: 1 }, NO_GATEWAY, DB_EXISTS, NETWORK],
      { LYX_STACK_PORT: String(port), LYX_NPM_REGISTRY: "https://registry.example.invalid" },
    );
    expect(result.status).toBe(0);
    const builds = result.lines.filter((line) => line.startsWith("build "));
    expect(builds.map((line) => / -t (\S+)/.exec(line)?.[1]).toSorted()).toEqual([
      "liyoxi/gateway:local",
      "liyoxi/mediatool:local",
      "liyoxi/server:local",
    ]);
    for (const line of builds.filter((one) => !one.includes("mediatool"))) {
      expect(line).toMatch(/--build-arg LYX_BUILD=(sha-[0-9a-f]{12}(-dirty)?|dev) /);
      expect(line).toContain("--build-arg NPM_CONFIG_REGISTRY=https://registry.example.invalid");
    }
    const up = result.calls.find(
      (call) => call.args.includes("--wait") && call.args.includes("up"),
    );
    expect(up?.args.join(" ")).toMatch(/stack\.yml -f \S+infra\/stack\/lan\.yml up -d --wait/);
    expect(up?.env.LYX_STACK_BIND).toBe("0.0.0.0");
  });

  it("容器没有都健康：以 1 退出", async () => {
    const port = await freePort();
    const result = await runWithFakeDocker(
      UP,
      ["up"],
      [DEPS_UP, NO_GATEWAY, DB_EXISTS, NETWORK, { match: "up -d --wait", status: 1 }],
      { LYX_STACK_PORT: String(port) },
    );
    expect(result.status).toBe(1);
    expect(result.output).toContain("四个容器没有都健康");
  });
});

describe("pnpm stack:down", () => {
  it("不带 --reset：只停本环境的容器，不删库、不删卷、不动依赖", async () => {
    const result = await runWithFakeDocker(UP, ["down"], []);
    expect(result.status).toBe(0);
    expect(result.lines).toHaveLength(2);
    expect(result.lines[0]).toMatch(/^version /);
    expect(result.lines[1]).toMatch(
      /^compose -f \S+infra\/compose\/stack\.yml down --remove-orphans$/,
    );
  });

  it("--reset：删本环境的库与共享卷、清它在 Redis 里的键；别的库一个不动", async () => {
    const running: Rule = { match: "^inspect --type container", stdout: "running healthy\n" };
    const result = await runWithFakeDocker(UP, ["down", "--reset"], [running]);
    expect(result.status).toBe(0);
    const sql = result.lines.filter((line) => /\b(DROP|CREATE|ALTER|TRUNCATE|DELETE)\b/.test(line));
    expect(sql).toHaveLength(1);
    expect(sql[0]).toMatch(
      /^exec lyx-postgres psql .* DROP DATABASE IF EXISTS "lyx_stack" WITH \(FORCE\)$/,
    );
    expect(result.lines).toContain("volume rm lyx-stack-work");
    const redis = result.lines.find((line) => line.startsWith("exec lyx-redis"));
    expect(redis).toContain("redis-cli -n 1 --scan --pattern 'lyx:local:*'");
    expect(redis).toContain("UNLINK");
    expect(result.lines.join("\n")).not.toMatch(/FLUSHDB|FLUSHALL|local\.yml/);
    // 库号与 stack.yml 里写的是同一个
    expect(read("infra/compose/stack.yml")).toContain("REDIS_URL: redis://lyx-redis:6379/1");
  });

  it.each([
    ["liyoxi", "不以 lyx_ 开头"],
    ["postgres", "不以 lyx_ 开头"],
    ["lyx_migrate_check", "校验库或测试库"],
    ["lyx_schema_check", "校验库或测试库"],
    ["lyx_test_services_ab12_1", "校验库或测试库"],
  ])("--reset 遇到库名 %s：拒绝执行，一条 docker 命令都不发", async (db, reason) => {
    const result = await runWithFakeDocker(UP, ["down", "--reset"], [], { LYX_STACK_DB: db });
    expect(result.status).toBe(2);
    expect(result.output).toContain("拒绝执行");
    expect(result.output).toContain(reason);
    expect(result.calls).toEqual([]);
  });

  it("库名带引号之类的字符：以 2 退出，不拼进 SQL", async () => {
    const result = await runWithFakeDocker(UP, ["up"], [], { LYX_STACK_DB: 'lyx_x"; DROP' });
    expect(result.status).toBe(2);
    expect(result.calls).toEqual([]);
  });
});

describe("冒烟脚本的约束核对（docker inspect 桩掉）", () => {
  const IMAGE_ENV = ["PATH=/usr/local/bin", "NODE_VERSION=24.21.0", "NODE_ENV=production"];
  const server = (ports: Record<string, unknown> = {}) => ({
    Config: { User: "1000:1000", Env: ["APP_ENV=local"] },
    HostConfig: {
      ReadonlyRootfs: true,
      CapDrop: ["ALL"],
      Privileged: false,
      Init: true,
      PortBindings: ports,
    },
  });
  const good = () => ({
    "lyx-mediatool": {
      Image: "sha256:mediatool",
      Config: { User: "1000:1000", Env: [...IMAGE_ENV] },
      NetworkSettings: { Networks: { none: {} } },
      Mounts: [{ Type: "volume", Destination: "/work" }],
      HostConfig: {
        NetworkMode: "none",
        ReadonlyRootfs: true,
        CapDrop: ["ALL"],
        CapAdd: null,
        SecurityOpt: ["no-new-privileges:true"],
        Privileged: false,
        PidsLimit: 128,
        Memory: 1024 ** 3,
        MemorySwap: 1024 ** 3,
        NanoCpus: 1e9,
        Tmpfs: { "/tmp": "size=64m" },
        PortBindings: {},
      },
    },
    "lyx-api": server(),
    "lyx-worker": server(),
    "lyx-gateway": {
      ...server({ "8080/tcp": [{ HostIp: "127.0.0.1", HostPort: "8080" }] }),
      Config: { User: "101:101", Env: [] },
    },
  });
  const rulesOf = (containers: Record<string, unknown>): Rule[] => [
    { match: "^image inspect -f \\S+json \\.Config\\.Env", stdout: JSON.stringify(IMAGE_ENV) },
    ...Object.entries(containers).map(([name, info]) => ({
      match: `^inspect --type container ${name}$`,
      stdout: JSON.stringify([info]),
    })),
  ];

  it("四个容器的配置都合规：通过", async () => {
    const result = await runWithFakeDocker(SMOKE, ["--inspect-only"], rulesOf(good()));
    expect(result.output).not.toContain("不通过");
    expect(result.status).toBe(0);
  });

  it("mediatool 接了网络、多带一个环境变量、没限交换区；gateway 绑了全部网卡；api 以 root 跑：逐条查出，以 1 退出", async () => {
    const bad = good();
    bad["lyx-mediatool"].HostConfig.NetworkMode = "bridge";
    bad["lyx-mediatool"].HostConfig.MemorySwap = 2 * 1024 ** 3;
    bad["lyx-mediatool"].Config.Env.push("DATABASE_URL=x");
    bad["lyx-gateway"].HostConfig.PortBindings = {
      "8080/tcp": [{ HostIp: "0.0.0.0", HostPort: "8080" }],
    };
    bad["lyx-api"].Config.User = "";
    const result = await runWithFakeDocker(SMOKE, ["--inspect-only"], rulesOf(bad));
    expect(result.status).toBe(1);
    const failed = result.output.split("\n").filter((line) => line.includes("不通过 "));
    expect(failed.map((line) => line.replace(/^\s*不通过\s+/, ""))).toEqual([
      "mediatool：无网络（network_mode: none）",
      "mediatool：内存加交换区的上限等于内存上限（不许用交换区）",
      "mediatool：不带环境变量（只有镜像自带的）",
      "lyx-api：非 root、根文件系统只读、去掉全部能力",
      "gateway：只发布 8080，且只绑回环地址",
    ]);
  });
});

describe("整套环境的 Compose 与镜像定义", () => {
  const stack = read("infra/compose/stack.yml");
  const local = read("infra/compose/local.yml");
  const serviceBlock = (text: string, name: string) =>
    new RegExp(`^ {2}${name}:\\n((?: {4}.*\\n|\\n)+)`, "m").exec(text)?.[1] ?? "";

  it("另一个项目名，接 local.yml 那个项目的网络；四个容器名写死；库与 Redis 的账号、地址取 local.yml 的", () => {
    expect(stack).toMatch(/^name: liyoxi-stack$/m);
    const project = /^name: (\S+)$/m.exec(local)?.[1];
    expect(stack).toMatch(
      new RegExp(
        `^networks:\\n(?: {2}#.*\\n)* {2}default:\\n {4}name: ${project}_default\\n {4}external: true$`,
        "m",
      ),
    );
    const names = [...stack.matchAll(/^ {4}container_name: (\S+)$/gm)].map((match) => match[1]);
    expect(names).toEqual(["lyx-mediatool", "lyx-api", "lyx-worker", "lyx-gateway"]);
    const user = /POSTGRES_USER: (\S+)/.exec(local)?.[1];
    const password = /POSTGRES_PASSWORD: (\S+)/.exec(local)?.[1];
    const urls = [...stack.matchAll(/^ {6}DATABASE_URL: (\S+)$/gm)].map((match) => match[1]);
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(url).toBe(
        `postgresql://${user}:${password}@lyx-postgres:5432/\${LYX_STACK_DB:-lyx_stack}`,
      );
    }
    // 口令只有 local.yml 那一组；没有密钥文件与 env_file
    expect(stack).not.toMatch(/env_file|_FILE:|secrets:/);
  });

  it("只有 gateway 发布端口，缺省只绑回环地址；镜像都带标签变量，不用 latest", () => {
    expect(stack.match(/^ {4}ports:$/gm)).toHaveLength(1);
    expect(serviceBlock(stack, "gateway")).toContain(
      '      - "${LYX_STACK_BIND:-127.0.0.1}:${LYX_STACK_PORT:-8080}:8080"',
    );
    const images = [...stack.matchAll(/^ {4}image: (\S+)$/gm)].map((match) => match[1] ?? "");
    expect(images.length).toBeGreaterThan(0);
    for (const image of images) {
      expect(image).toMatch(/^liyoxi\/(server|gateway|mediatool):\$\{LYX_STACK_TAG:-local\}$/);
    }
  });

  it("mediatool 一段照抄 compose.verify.yml：那里的每一行这里都有（镜像一行除外），另限了交换区", () => {
    const verify = serviceBlock(read("infra/docker/mediatool/compose.verify.yml"), "mediatool")
      .split("\n")
      .filter((line) => line.trim() !== "" && !line.startsWith("    image:"));
    expect(verify.length).toBeGreaterThan(10);
    const mine = serviceBlock(stack, "mediatool").split("\n");
    for (const line of verify) expect(mine).toContain(line);
    expect(mine).toContain("    memswap_limit: 1g");
    expect(mine.filter((line) => /^ {4}(environment|env_file|ports|networks):/.test(line))).toEqual(
      [],
    );
  });

  it("api、worker、gateway 与两个一次性容器：非 root、根只读、去掉全部能力、不许提权", () => {
    for (const name of ["api", "worker", "gateway", "migrate", "seed"]) {
      const block = serviceBlock(stack, name);
      expect(block).toMatch(/^ {4}read_only: true$/m);
      expect(block).toMatch(/^ {4}user: "(1000:1000|101:101)"$/m);
      expect(block).toMatch(/^ {4}cap_drop:\n {6}- ALL$/m);
      expect(block).toMatch(/^ {4}security_opt:\n {6}- no-new-privileges:true$/m);
    }
  });

  const DOCKERFILES = [
    "infra/docker/server/Dockerfile",
    "infra/docker/gateway/Dockerfile",
    "infra/docker/mediatool/Dockerfile",
  ];

  it("基础镜像都固定到摘要；三处的 node 是同一个摘要", () => {
    const nodeDigests = new Set<string>();
    for (const file of DOCKERFILES) {
      const text = read(file);
      const stages = new Set(
        [...text.matchAll(/^FROM \S+ AS (\S+)$/gm)].map((match) => match[1] ?? ""),
      );
      const bases = [...text.matchAll(/^FROM (\S+)/gm)]
        .map((match) => match[1] ?? "")
        .filter((base) => !stages.has(base));
      expect(bases.length).toBeGreaterThan(0);
      for (const base of bases) {
        expect(base).toMatch(/^(node:24-slim|nginx:stable-alpine)@sha256:[0-9a-f]{64}$/);
        if (base.startsWith("node:")) nodeDigests.add(base);
      }
    }
    expect(nodeDigests.size).toBe(1);
  });

  it.each(["infra/docker/server/Dockerfile", "infra/docker/gateway/Dockerfile"])(
    "%s 的构建上下文是白名单：先全部排除；.git、docs、node_modules、.env 进不来",
    (file) => {
      const lines = read(`${file}.dockerignore`)
        .split("\n")
        .filter((line) => line.trim() !== "" && !line.startsWith("#"));
      expect(lines[0]).toBe("*");
      const allowed = lines.filter((line) => line.startsWith("!")).map((line) => line.slice(1));
      expect(allowed.length).toBeGreaterThan(0);
      for (const path of allowed) {
        expect(path).not.toMatch(/^\.git|^docs|^design|^tools|node_modules|\.env|^\*|^\/|\.\./);
      }
      // 放行在前、再排除在后：后写的赢
      const lastAllow = lines.findLastIndex((line) => line.startsWith("!"));
      for (const pattern of ["**/node_modules", "**/dist", "**/.env*"]) {
        expect(lines.indexOf(pattern)).toBeGreaterThan(lastAllow);
      }
      // Dockerfile 里从上下文拷的路径都在白名单之内
      const copied = [...read(file).matchAll(/^COPY (?!--from)(.+) \S+$/gm)].flatMap((match) =>
        (match[1] ?? "").split(" ").filter((token) => !token.startsWith("--")),
      );
      expect(copied.length).toBeGreaterThan(0);
      for (const source of copied) {
        const path = source.replace(/\/$/, "");
        expect(allowed.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))).toBe(
          true,
        );
      }
    },
  );

  it("server 镜像：非 root、字体目录的变量、PostgreSQL 客户端的主版本与 local.yml 的数据库相同", () => {
    const text = read("infra/docker/server/Dockerfile");
    expect(text).toMatch(/^USER 1000:1000$/m);
    expect(text).toMatch(/^ {4}LYX_PDF_FONT_DIR=\/app\/fonts \\$/m);
    const major = /^ {4}image: postgres:(\d+)/m.exec(local)?.[1];
    expect(text).toMatch(new RegExp(`^ARG PG_MAJOR=${major}$`, "m"));
  });

  it("local.yml 开头的注释指到整套环境那一份", () => {
    expect(local).toContain("infra/compose/stack.yml");
  });
});
