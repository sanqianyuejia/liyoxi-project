import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { makeTempDir, repoRoot } from "./helpers.js";

// 预发节点（W2-25 的第一步）：密钥清单与 node.yml 的写法核对，密钥齐备检查、密钥生成、库初始化、节点步骤、
// 节点初始化五个脚本的行为，systemd 单元与宿主机 nginx 站点模板的写法。
// 脚本是真 bash；docker、systemctl、ss 之类的命令桩掉：PATH 最前面放同名的假命令，它把每次调用记进一个文件，
// 再按“规则表”应答（对“命令名 参数…”的正则，第一条对得上的算数；都对不上即退出码 0、没有输出）。
// 不起任何容器，不连库，不动本机的任何系统文件。真容器上的那一遍是 pnpm stg:rehearse（stack-smoke 工作流里跑）。
// 用例放在这个目录：infra 项目只收 ci/test 下的用例。

const read = (path: string) => readFileSync(join(repoRoot, path), "utf8");
const CHECK = "infra/deploy/check-secrets.sh";
const GEN = "infra/bootstrap/gen-secrets.sh";
const DB_INIT = "infra/bootstrap/db-init.sh";
const STEP = "infra/deploy/node-step.sh";
const NODE_INIT = "infra/bootstrap/node-init.sh";
const RENDER = "infra/deploy/nginx/render.sh";

interface Secret {
  file: string;
  uid: number;
  required: boolean;
  services: string;
  env: string;
  what: string;
}
const manifest = (JSON.parse(read("infra/deploy/secrets.manifest.json")) as { secrets: Secret[] })
  .secrets;
const nodeYml = read("infra/compose/node.yml");
const stgEnv = read("infra/compose/env/stg.env");

/** node.yml 里一个服务的那一段（四格缩进的各行） */
function serviceBlock(name: string): string {
  const block = new RegExp(`^ {2}${name}:\\n((?: {4}.*\\n|\\n)+)`, "m").exec(nodeYml)?.[1];
  if (!block) throw new Error(`node.yml 里没有服务 ${name}`);
  return block;
}
const listOf = (block: string, key: string): string[] =>
  [
    ...(new RegExp(`^ {4}${key}:\\n((?: {6}- .+\\n)+)`, "m").exec(block)?.[1] ?? "").matchAll(
      /^ {6}- (.+)$/gm,
    ),
  ].map((row) => (row[1] ?? "").replace(/^"|"$/g, ""));
const serviceNames = [
  ...(/^services:\n([\s\S]*?)^secrets:/m.exec(nodeYml)?.[1] ?? "").matchAll(/^ {2}([a-z-]+):$/gm),
].map((row) => row[1] ?? "");
const LONG_RUNNING = ["postgres", "redis", "mediatool", "api", "worker", "gateway"];

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});
function tempDir(): string {
  const temp = makeTempDir("lyx-stg-node-");
  cleanups.push(temp.cleanup);
  return temp.dir;
}

interface Rule {
  /** 对“命令名 参数用空格接起来”的正则（POSIX 扩展正则：假命令是 bash 写的，不认 \\S 之类） */
  match: string;
  status?: number;
  stdout?: string;
  stderr?: string;
}
// 假命令用 bash 写：一个用例要调它二十来次，换成 node 写的光启动就要几秒
const FAKE = `#!/bin/bash
line="$(basename "$0") $*"
printf '%s\\t%s\\n' "\${LYX_TAG:-}" "$line" >>"$FAKE_DIR/calls"
index=0
while IFS= read -r pattern; do
  if [[ "$line" =~ $pattern ]]; then
    cat "$FAKE_DIR/$index.out"
    cat "$FAKE_DIR/$index.err" >&2
    exit "$(cat "$FAKE_DIR/$index.status")"
  fi
  index=$((index + 1))
done <"$FAKE_DIR/rules"
exit 0
`;

/** 跑一个仓库里的 bash 脚本。fakes 列的命令换成假的；返回退出码、输出与假命令的调用记录 */
function sh(
  script: string,
  args: string[],
  options: { env?: Record<string, string>; fakes?: string[]; rules?: Rule[] } = {},
) {
  const bin = tempDir();
  for (const name of options.fakes ?? []) {
    writeFileSync(join(bin, name), FAKE);
    chmodSync(join(bin, name), 0o755);
  }
  const fakeDir = tempDir();
  const rules = options.rules ?? [];
  writeFileSync(join(fakeDir, "rules"), rules.map((rule) => `${rule.match}\n`).join(""));
  rules.forEach((rule, index) => {
    writeFileSync(join(fakeDir, `${index}.out`), rule.stdout ?? "");
    writeFileSync(join(fakeDir, `${index}.err`), rule.stderr ?? "");
    writeFileSync(join(fakeDir, `${index}.status`), String(rule.status ?? 0));
  });
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !key.startsWith("LYX_") && key !== "SSH_ORIGINAL_COMMAND",
    ),
  );
  const result = spawnSync("bash", [join(repoRoot, script), ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...inherited,
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      FAKE_DIR: fakeDir,
      ...options.env,
    },
  });
  if (result.error) throw result.error;
  const callsFile = join(fakeDir, "calls");
  const calls = existsSync(callsFile)
    ? readFileSync(callsFile, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((row) => {
          const [tag = "", line = ""] = row.split("\t");
          return { line, tag: tag === "" ? null : tag };
        })
    : [];
  return {
    status: result.status ?? -1,
    output: `${result.stdout}\n${result.stderr}`,
    calls,
    lines: calls.map((call) => call.line),
  };
}

const mode = (path: string) => (statSync(path).mode & 0o777).toString(8);
/** 用生成脚本造一套密钥文件（假值），返回密钥目录 */
function generatedSecrets(): string {
  const dir = join(tempDir(), "secrets");
  const result = sh(GEN, ["--dir", dir]);
  expect(result.status, result.output).toBe(0);
  return dir;
}

describe("密钥清单与 node.yml", () => {
  it("清单：每项恰好六个键、值是标量，文件名不重复；字符串里没有反斜杠与花括号", () => {
    expect(manifest.length).toBeGreaterThan(0);
    for (const one of manifest) {
      expect(Object.keys(one)).toEqual(["file", "uid", "required", "services", "env", "what"]);
      expect(one.file).toMatch(/^[a-z0-9][a-z0-9.-]*$/);
      expect(typeof one.uid).toBe("number");
      expect(typeof one.required).toBe("boolean");
      for (const text of [one.services, one.env, one.what]) expect(text).not.toMatch(/[\\{}]/);
    }
    expect(new Set(manifest.map((one) => one.file)).size).toBe(manifest.length);
  });

  it("bash 那一侧按行读出来的清单与 JSON 逐项相同", () => {
    const result = spawnSync("bash", ["-c", ". infra/deploy/lib.sh && manifest_rows"], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim().split("\n")).toEqual(
      manifest.map((one) =>
        [one.file, one.uid, one.required, one.services, one.env].map(String).join("|"),
      ),
    );
  });

  it("node.yml 的挂载与清单逐项一致：按服务分挂，*_FILE 指到 /run/secrets/<文件名>", () => {
    for (const service of serviceNames) {
      const block = serviceBlock(service);
      const expected = manifest.filter((one) => one.services.split(" ").includes(service));
      expect(listOf(block, "secrets").toSorted(), service).toEqual(
        expected.map((one) => one.file).toSorted(),
      );
      for (const one of expected.filter((entry) => entry.env !== "")) {
        expect(block, `${service} 的 ${one.env}`).toContain(
          `      ${one.env}: /run/secrets/${one.file}\n`,
        );
      }
    }
    // 清单里写的服务名在 node.yml 里都有；顶层 secrets 的来源都在密钥目录下
    const mounted = manifest.flatMap((one) => one.services.split(" ").filter(Boolean));
    for (const service of mounted) expect(serviceNames).toContain(service);
    for (const one of manifest.filter((entry) => entry.services !== "")) {
      expect(nodeYml).toContain(`  ${one.file}:\n    file: \${LYX_SECRETS_DIR:?}/${one.file}\n`);
    }
    // 迁移账号的连接串只给两个一次性容器；mediatool 与 gateway 一项密钥都没有
    const migrator = manifest.find((one) => one.file === "migrator-database-url");
    expect(migrator?.services.split(" ").filter((name) => LONG_RUNNING.includes(name))).toEqual([]);
    expect(serviceBlock("mediatool")).not.toMatch(/secrets:|environment:/);
    expect(serviceBlock("gateway")).not.toMatch(/secrets:/);
  });

  it("不用 env_file；environment 里没有连接串与口令；六个常驻容器重启策略 no、日志带轮转", () => {
    expect(nodeYml.replace(/^\s*#.*$/gm, "")).not.toMatch(/env_file/);
    expect(serviceNames.filter((name) => !/profiles:/.test(serviceBlock(name)))).toEqual(
      LONG_RUNNING,
    );
    for (const service of serviceNames) {
      const block = serviceBlock(service);
      expect(block, service).not.toMatch(/:\/\/[^\s"']*:[^\s"']*@/);
      expect(block, service).not.toMatch(/^ {6}\w*(PASSWORD|SECRET|TOKEN|_URL|_KEYS?): /m);
      expect(block, service).toMatch(/^ {4}logging: \*logging$/m);
      if (LONG_RUNNING.includes(service)) expect(block, service).toMatch(/^ {4}restart: "no"$/m);
    }
    expect(nodeYml).toMatch(/driver: json-file\n {2}options:\n {4}max-size: \S+\n {4}max-file: /);
  });

  it("只有 gateway 发布端口，且只绑回环地址；网络是固定网段", () => {
    for (const service of serviceNames) {
      const ports = listOf(serviceBlock(service), "ports");
      if (service === "gateway") {
        expect(ports).toEqual(["127.0.0.1:${LYX_GATEWAY_PORT:-8080}:8080"]);
      } else {
        expect(ports, service).toEqual([]);
      }
    }
    expect(nodeYml).toMatch(/ipam:\n {6}config:\n {8}- subnet: \$\{LYX_NODE_SUBNET:\?\}/);
  });

  it("mediatool 的约束照抄 compose.verify.yml，只有内存不同：256MB，内存加交换合计 1GB", () => {
    const verify = read("infra/docker/mediatool/compose.verify.yml");
    const original = /^ {2}mediatool:\n((?: {4}.*\n|\n)+)/m.exec(verify)?.[1] ?? "";
    const ours = serviceBlock("mediatool");
    const scalar = (block: string, key: string) =>
      new RegExp(`^ {4}${key}: (.+)$`, "m").exec(block)?.[1];
    for (const key of ["network_mode", "read_only", "user", "pids_limit", "cpus"]) {
      expect(scalar(ours, key), key).toBe(scalar(original, key));
      expect(scalar(ours, key), key).toBeDefined();
    }
    for (const key of ["cap_drop", "security_opt", "tmpfs", "volumes"]) {
      expect(listOf(ours, key), key).toEqual(listOf(original, key));
      expect(listOf(ours, key).length, key).toBeGreaterThan(0);
    }
    expect(scalar(ours, "mem_limit")).toBe("256m");
    expect(scalar(ours, "memswap_limit")).toBe("1g");
  });

  it("stg.env 只有非敏感项；node.yml 必填的变量都有出处；库与 Redis 的镜像同 local.yml", () => {
    const keys = [...stgEnv.matchAll(/^([A-Z_]+)=/gm)].map((row) => row[1] ?? "");
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) expect(key).not.toMatch(/PASSWORD|SECRET|TOKEN|URL|KEY|CREDENTIAL/);
    expect(stgEnv).not.toMatch(/:\/\/[^\s]*:[^\s]*@/);
    // 路径与标签由 node-step.sh 给，其余必填的都要在 stg.env 里
    const required = new Set([...nodeYml.matchAll(/\$\{(LYX_[A-Z_]+):\?/g)].map((row) => row[1]));
    for (const key of ["LYX_SRC", "LYX_SECRETS_DIR", "LYX_TAG"]) required.delete(key);
    for (const key of required) expect(keys, key).toContain(key);
    const local = read("infra/compose/local.yml");
    const image = (key: string) => new RegExp(`^${key}=(.+)$`, "m").exec(stgEnv)?.[1];
    expect(local).toContain(`image: ${image("LYX_PG_IMAGE")}\n`);
    expect(local).toContain(`image: ${image("LYX_REDIS_IMAGE")}\n`);
  });

  it("server 镜像带着库的核对脚本，verify-db 引得到它", () => {
    const dockerfile = read("infra/docker/server/Dockerfile");
    expect(dockerfile).toMatch(
      /^COPY infra\/ci\/db-verify-grants\.mjs infra\/ci\/db-grants-rules\.mjs infra\/ci\/db-lib\.mjs infra\/ci\/grants-floor\.txt infra\/ci\/$/m,
    );
    expect(dockerfile).toMatch(
      /^COPY packages\/db\/src\/grants\.expected\.json packages\/db\/src\/$/m,
    );
    expect(read("infra/deploy/verify-db.mjs")).toContain('from "../ci/db-lib.mjs"');
    expect(serviceBlock("verify-db")).toContain(
      "${LYX_SRC:?}/infra/deploy/verify-db.mjs:/app/infra/deploy/verify-db.mjs:ro",
    );
  });
});

describe("gen-secrets.sh 与 check-secrets.sh（任务书 第 7 节第 5 条）", () => {
  it("生成：清单上的文件都在，权限 0400，目录 0700；重跑一个不动；--dry-run 什么都不写；输出里没有内容", () => {
    const dir = join(tempDir(), "secrets");
    const dry = sh(GEN, ["--dir", dir, "--dry-run"]);
    expect(dry.status).toBe(0);
    expect(existsSync(dir)).toBe(false);
    const first = sh(GEN, ["--dir", dir]);
    expect(first.status, first.output).toBe(0);
    expect(readdirSync(dir).toSorted()).toEqual(manifest.map((one) => one.file).toSorted());
    expect(mode(dir)).toBe("700");
    const before = new Map(
      manifest.map((one) => [one.file, readFileSync(join(dir, one.file), "utf8")]),
    );
    for (const [file, content] of before) {
      expect(mode(join(dir, file)), file).toBe("400");
      expect(content.trim().length, file).toBeGreaterThan(20);
      for (const piece of content.match(/[A-Za-z0-9+/=_-]{24,}/g) ?? []) {
        expect(first.output).not.toContain(piece);
      }
    }
    // 三份密钥文件是 loadEnv 认的形状；Redis 的两处是同一个口令
    expect(Object.keys(JSON.parse(before.get("data-keys.json") ?? ""))).toEqual([
      "current",
      "keys",
    ]);
    expect(Object.keys(JSON.parse(before.get("bidx-keys.json") ?? ""))).toEqual(["phone", "uscc"]);
    expect(Object.keys(JSON.parse(before.get("auth-keys.json") ?? ""))).toEqual([
      "ticket",
      "device",
      "mfa",
    ]);
    const redisPassword = /^requirepass (\S+)$/m.exec(before.get("redis-auth.conf") ?? "")?.[1];
    expect(before.get("redis-url")).toContain(`:${redisPassword}@redis:6379/`);
    const again = sh(GEN, ["--dir", dir]);
    expect(again.status).toBe(0);
    expect(again.output).not.toContain("已生成");
    for (const [file, content] of before) {
      expect(readFileSync(join(dir, file), "utf8"), file).toBe(content);
    }
  });

  it("成对的文件只剩一个：停下，不猜", () => {
    const dir = generatedSecrets();
    chmodSync(join(dir, "redis-url"), 0o600);
    spawnSync("rm", ["-f", join(dir, "redis-url")]);
    const result = sh(GEN, ["--dir", dir]);
    expect(result.status).toBe(1);
    expect(result.output).toContain("要成对");
  });

  it("齐备：通过；只看一个服务时，别的服务的文件缺了也不管", () => {
    const dir = generatedSecrets();
    const all = sh(CHECK, ["--dir", dir, "--skip-owner"]);
    expect(all.status, all.output).toBe(0);
    expect(all.output).toContain(`查了 ${manifest.length} 个文件`);
    spawnSync("rm", ["-f", join(dir, "auth-keys.json")]);
    expect(sh(CHECK, ["--dir", dir, "--skip-owner", "--service", "postgres"]).status).toBe(0);
    expect(sh(CHECK, ["--dir", dir, "--skip-owner", "--service", "api"]).status).toBe(1);
  });

  it.each<[string, (dir: string) => unknown, string]>([
    [
      "少一个文件",
      (dir: string) => spawnSync("rm", ["-f", join(dir, "database-url")]),
      "没有这个文件",
    ],
    [
      "权限不是 0400",
      (dir: string) => chmodSync(join(dir, "database-url"), 0o440),
      "权限要是 0400",
    ],
    [
      "文件为空",
      (dir: string) => {
        chmodSync(join(dir, "database-url"), 0o600);
        writeFileSync(join(dir, "database-url"), "");
        chmodSync(join(dir, "database-url"), 0o400);
      },
      "文件是空的",
    ],
  ])("%s：非 0 退出，只报文件名，输出里没有文件内容", (_name, damage, reason) => {
    const dir = generatedSecrets();
    const contents = manifest.map((one) => readFileSync(join(dir, one.file), "utf8").trim());
    damage(dir);
    const result = sh(CHECK, ["--dir", dir, "--skip-owner"]);
    expect(result.status).toBe(1);
    expect(result.output).toContain(`不合格  database-url：${reason}`);
    expect(result.output.match(/^不合格 {2}/gm)?.length).toBe(1);
    for (const content of contents) expect(result.output).not.toContain(content);
  });

  it("密钥目录别人进得去：不合格；属主不是清单写的 uid：不合格", () => {
    const dir = generatedSecrets();
    // 不带 --skip-owner：清单里有 999 与 1000 两种属主，当前用户至多是其中一种
    const owner = sh(CHECK, ["--dir", dir]);
    expect(owner.status).toBe(1);
    expect(owner.output).toMatch(/属主要是 uid \d+/);
    chmodSync(dir, 0o755);
    const open = sh(CHECK, ["--dir", dir, "--skip-owner"]);
    expect(open.status).toBe(1);
    expect(open.output).toContain("权限要是 0700");
  });
});

describe("db-init.sh", () => {
  const env = (dir: string) => ({ LYX_SECRETS_DIR: dir, LYX_NODE_PREFIX: "lyxt" });

  it("--dry-run：只核对三份连接串的写法，不调 docker", () => {
    const dir = generatedSecrets();
    const result = sh(DB_INIT, ["--dry-run"], { env: env(dir), fakes: ["docker"] });
    expect(result.status, result.output).toBe(0);
    expect(result.output).toContain("lyx_app_login → lyx_app");
    expect(result.calls).toEqual([]);
  });

  it("口令只经标准输入给 psql：docker 的参数里没有，输出里也没有", () => {
    const dir = generatedSecrets();
    const passwords = ["migrator-database-url", "database-url", "backup-database-url"].map(
      (file) => /:\/\/[^:]+:([^@]+)@/.exec(readFileSync(join(dir, file), "utf8"))?.[1] ?? "",
    );
    const result = sh(DB_INIT, [], { env: env(dir), fakes: ["docker"] });
    expect(result.status, result.output).toBe(0);
    expect(result.lines).toEqual([
      "docker exec lyxt-postgres pg_isready -q -U postgres -d postgres",
      "docker exec -i lyxt-postgres psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres",
    ]);
    for (const password of passwords) {
      expect(password.length).toBeGreaterThan(20);
      expect(result.output).not.toContain(password);
      expect(result.lines.join("\n")).not.toContain(password);
    }
  });

  it.each<[string, string, string, string]>([
    [
      "口令里有要转义的字符",
      "database-url",
      "postgresql://lyx_app_login:a'b@postgres:5432/liyoxi",
      "写法不对",
    ],
    [
      "迁移账号不叫 lyx_migrator",
      "migrator-database-url",
      "postgresql://someone:abc@postgres:5432/liyoxi",
      "要是 lyx_migrator",
    ],
    [
      "登录账号叫 lyx_app",
      "database-url",
      "postgresql://lyx_app:abc@postgres:5432/liyoxi",
      "登录账号不能叫 lyx_app",
    ],
    [
      "三份连接串不是同一个库",
      "backup-database-url",
      "postgresql://lyx_backup_login:abc@postgres:5432/other",
      "不是同一个库",
    ],
  ])("%s：以 2 退出，不连库，不回显文件内容", (_name, file, content, reason) => {
    const dir = generatedSecrets();
    chmodSync(join(dir, file), 0o600);
    writeFileSync(join(dir, file), `${content}\n`);
    const result = sh(DB_INIT, [], { env: env(dir), fakes: ["docker"] });
    expect(result.status).toBe(2);
    expect(result.output).toContain(reason);
    expect(result.output).not.toContain(content);
    expect(result.calls).toEqual([]);
  });
});

describe("node-step.sh（节点步骤，docker 与 systemctl 桩掉）", () => {
  const HEALTHY: Rule = { match: "^docker inspect --type container", stdout: "running healthy\n" };
  function nodeEnv(extra: Record<string, string> = {}) {
    const home = tempDir();
    return { LYX_NODE_HOME: home, LYX_NODE_PREFIX: "lyxt", LYX_NODE_PROJECT: "lyxt", ...extra };
  }
  const composeRun = (service: string) =>
    new RegExp(
      `^docker compose -p lyxt --env-file \\S+infra/compose/env/stg\\.env -f \\S+infra/compose/node\\.yml run --rm --no-deps -T ${service}$`,
    );

  it("migrate、seed、verify-db：用参数给的标签起一次性容器，不带依赖", () => {
    for (const service of ["migrate", "seed", "verify-db"]) {
      const result = sh(STEP, [service, "sha-0123456789ab"], {
        env: nodeEnv(),
        fakes: ["docker"],
        rules: [HEALTHY],
      });
      expect(result.status, result.output).toBe(0);
      const call = result.calls.find((one) => composeRun(service).test(one.line));
      expect(call, result.lines.join("\n")).toBeDefined();
      expect(call?.tag).toBe("sha-0123456789ab");
    }
  });

  it("seed 的断言有违规（一次性容器以 1 退出）：这一步以 1 退出", () => {
    const result = sh(STEP, ["seed", "t1"], {
      env: nodeEnv(),
      fakes: ["docker"],
      rules: [HEALTHY, { match: "run --rm --no-deps -T seed$", status: 1 }],
    });
    expect(result.status).toBe(1);
    expect(result.output).toContain("不要往下起容器");
  });

  it("check-env：密钥不齐就停，不起容器", () => {
    const env = nodeEnv();
    mkdirSync(join(env.LYX_NODE_HOME, "secrets"), { mode: 0o700 });
    const result = sh(STEP, ["check-env", "t1"], { env, fakes: ["docker"] });
    expect(result.status).toBe(1);
    expect(result.output).toContain("密钥文件不齐备");
    expect(result.calls).toEqual([]);
  });

  it("pull：没配镜像仓库前缀时只核对本地镜像在，不拉；配了就拉这个标签", () => {
    const local = sh(STEP, ["pull", "t1"], { env: nodeEnv(), fakes: ["docker"] });
    expect(local.status, local.output).toBe(0);
    expect(local.output).toContain("跳过拉取");
    expect(local.lines.every((line) => line.startsWith("docker image inspect liyoxi/"))).toBe(true);
    const missing = sh(STEP, ["pull", "t1"], {
      env: nodeEnv(),
      fakes: ["docker"],
      rules: [{ match: "^docker image inspect", status: 1 }],
    });
    expect(missing.status).toBe(1);
    const remote = sh(STEP, ["pull", "t1"], {
      env: nodeEnv({ LYX_IMAGE_PREFIX: "registry.example.invalid/lyx/" }),
      fakes: ["docker"],
    });
    expect(remote.status, remote.output).toBe(0);
    expect(remote.calls.at(-1)).toMatchObject({ tag: "t1" });
    expect(remote.lines.at(-1)).toMatch(/node\.yml pull$/);
  });

  it("up（Compose 直接管）：先写 release.env 再起容器，等到都健康", () => {
    const env = nodeEnv({ LYX_NODE_SUPERVISOR: "compose" });
    const result = sh(STEP, ["up", "t2"], { env, fakes: ["docker"], rules: [HEALTHY] });
    expect(result.status, result.output).toBe(0);
    expect(readFileSync(join(env.LYX_NODE_HOME, "release.env"), "utf8")).toMatch(/^LYX_TAG=t2$/m);
    expect(result.lines.some((line) => /node\.yml up -d --remove-orphans$/.test(line))).toBe(true);
  });

  it("up（systemd 管）：库与 Redis 只在没起时起，其余按 mediatool、worker、api、gateway 的顺序重启", () => {
    const result = sh(STEP, ["up", "t3"], {
      env: nodeEnv(),
      fakes: ["docker", "systemctl"],
      rules: [HEALTHY],
    });
    expect(result.status, result.output).toBe(0);
    const systemctl = result.lines.filter((line) => line.startsWith("systemctl "));
    expect(systemctl[0]).toBe("systemctl enable --now lyx-postgres.service lyx-redis.service");
    expect(systemctl.filter((line) => line.startsWith("systemctl restart "))).toEqual(
      ["mediatool", "worker", "api", "gateway"].map(
        (name) => `systemctl restart lyx-${name}.service`,
      ),
    );
    expect(result.lines.some((line) => / up /.test(line))).toBe(false);
  });

  it("run：还没有 release.env 时不起应用容器；有了就按它的标签前台起，不带依赖", () => {
    const env = nodeEnv();
    const none = sh(STEP, ["run", "api"], { env, fakes: ["docker"] });
    expect(none.status).toBe(1);
    expect(none.calls).toEqual([]);
    writeFileSync(join(env.LYX_NODE_HOME, "release.env"), "LYX_TAG=t4\n");
    const result = sh(STEP, ["run", "api"], { env, fakes: ["docker"] });
    expect(result.status, result.output).toBe(0);
    expect(result.calls.at(-1)).toMatchObject({ tag: "t4" });
    expect(result.lines.at(-1)).toMatch(/node\.yml up --no-deps api$/);
  });

  it("status：有容器没在跑即非 0", () => {
    const result = sh(STEP, ["status"], {
      env: nodeEnv(),
      fakes: ["docker"],
      rules: [{ match: "^docker inspect", status: 1 }],
    });
    expect(result.status).toBe(1);
    expect(result.output).toContain("没有这个容器");
  });

  it.each<[string[], string]>([
    [["up"], "要跟一个镜像标签"],
    [["up", "a;b"], "镜像标签只许"],
    [["up", "t1", "extra"], "要跟一个镜像标签"],
    [["nope"], "不认识的步骤"],
    [["run", "nginx"], "不认识的服务"],
    [["status", "x"], "不带参数"],
  ])("用法不对 %j：以 2 退出，什么都不调", (args, reason) => {
    const result = sh(STEP, args, { env: nodeEnv(), fakes: ["docker", "systemctl"] });
    expect(result.status).toBe(2);
    expect(result.output).toContain(reason);
    expect(result.calls).toEqual([]);
  });

  it("经 SSH：步骤与参数取自 SSH_ORIGINAL_COMMAND，逐个核对后经 sudo 以 root 重跑；夹带别的命令、内部步骤一律拒绝", () => {
    const fakes = ["docker", "systemctl", "sudo", "id"];
    const notRoot: Rule = { match: "^id -u$", stdout: "1001\n" };
    const ok = sh(STEP, [], {
      env: nodeEnv({ SSH_ORIGINAL_COMMAND: "migrate sha-0123456789ab" }),
      fakes,
      rules: [notRoot],
    });
    expect(ok.status, ok.output).toBe(0);
    expect(ok.lines).toEqual([
      "id -u",
      `sudo -n -- ${join(repoRoot, STEP)} migrate sha-0123456789ab`,
    ]);
    for (const command of ["up t1; rm -rf /", "up $(id)", "run api", "stop postgres", "wait api"]) {
      const result = sh(STEP, [], {
        env: nodeEnv({ SSH_ORIGINAL_COMMAND: command }),
        fakes,
        rules: [notRoot],
      });
      expect(result.status, command).toBe(2);
      expect(
        result.lines.filter((line) => !line.startsWith("id ")),
        command,
      ).toEqual([]);
    }
  });
});

describe("node-init.sh（任务书 第 7 节第 6 条；系统命令全部桩掉）", () => {
  const FAKES = [
    "docker",
    "ss",
    "pgrep",
    "ip",
    "getent",
    "useradd",
    "systemctl",
    "visudo",
    "chown",
    "id",
    "nginx",
  ];
  const KEY =
    "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFakeFakeFakeFakeFakeFakeFakeFakeFakeFakeFake deploy@ci";

  function setup() {
    const base = tempDir();
    const env = {
      LYX_NODE_HOME: join(base, "opt/liyoxi"),
      LYX_FS_ROOT: join(base, "root"),
      LYX_NODE_PREFIX: "lyx",
    };
    const keyFile = join(base, "deploy.pub");
    writeFileSync(keyFile, `${KEY}\n`);
    const deployHome = join(base, "home/lyx-deploy");
    const rules: Rule[] = [
      { match: "^id -u$", stdout: "0\n" },
      { match: "^id -u lyx-deploy$", status: 1 },
      { match: "^docker version", stdout: "26.1.3\n" },
      { match: "^docker compose version", stdout: "2.27.0\n" },
      { match: "^docker network ls", stdout: "bridge\n" },
      { match: "^docker network inspect", stdout: "bridge 172.17.0.0/16 \n" },
      {
        match: "^getent passwd lyx-deploy$",
        stdout: `lyx-deploy:x:995:995::${deployHome}:/bin/bash\n`,
      },
      { match: "^pgrep ", status: 1 },
    ];
    return { base, env, keyFile, deployHome, rules };
  }
  const changed = (lines: string[]) =>
    lines.filter((line) => /^(useradd|systemctl|chown|visudo) /.test(line));

  it("--dry-run：只核对、只说会做什么；不用 root，不建不改任何东西", () => {
    const { base, env, keyFile, rules } = setup();
    const result = sh(NODE_INIT, ["--dry-run", "--deploy-key", keyFile, "--nginx-oom"], {
      env,
      fakes: FAKES,
      rules: [{ match: "^id -u$", stdout: "1001\n" }, ...rules],
    });
    expect(result.status, result.output).toBe(0);
    expect(result.output).toContain("会做：建发布用户 lyx-deploy");
    expect(result.output).toContain("上面的都没有执行");
    expect(changed(result.lines)).toEqual([]);
    expect(readdirSync(base).toSorted()).toEqual(["deploy.pub"]);
  });

  it("执行：目录、脚本、node.env、发布用户、sudoers、authorized_keys、六个单元都到位；重跑不出错、结果相同", () => {
    const { env, keyFile, deployHome, rules } = setup();
    const args = ["--deploy-key", keyFile, "--registry", "registry.example.invalid/lyx/"];
    const first = sh(NODE_INIT, args, { env, fakes: FAKES, rules });
    expect(first.status, first.output).toBe(0);
    const home = env.LYX_NODE_HOME;
    expect(mode(join(home, "secrets"))).toBe("700");
    expect(readdirSync(join(home, "secrets"))).toEqual([]);
    expect(existsSync(join(home, "static/admin/assets"))).toBe(true);
    for (const file of [
      "compose/node.yml",
      "compose/env/stg.env",
      "deploy/node-step.sh",
      "deploy/secrets.manifest.json",
      "bootstrap/db-init.sh",
    ]) {
      expect(readFileSync(join(home, "infra", file), "utf8"), file).toBe(read(`infra/${file}`));
    }
    expect(readFileSync(join(home, "node.env"), "utf8")).toMatch(
      /^LYX_IMAGE_PREFIX=registry\.example\.invalid\/lyx\/$/m,
    );
    const step = join(home, "infra/deploy/node-step.sh");
    // sudoers：只放行这一个脚本
    const sudoers = readFileSync(join(env.LYX_FS_ROOT, "etc/sudoers.d/lyx-deploy"), "utf8");
    expect(sudoers.split("\n").filter((line) => line !== "" && !line.startsWith("#"))).toEqual([
      "Defaults:lyx-deploy !requiretty",
      `lyx-deploy ALL=(root) NOPASSWD: ${step}`,
    ]);
    // authorized_keys：一行，带限定命令、无终端、无转发
    const keys = readFileSync(join(deployHome, ".ssh/authorized_keys"), "utf8");
    expect(keys).toBe(
      `command="${step}",no-pty,no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-user-rc ${KEY}\n`,
    );
    expect(mode(join(deployHome, ".ssh/authorized_keys"))).toBe("600");
    // 六个单元：路径换成了实际的节点目录
    const units = readdirSync(join(env.LYX_FS_ROOT, "etc/systemd/system")).toSorted();
    expect(units).toEqual(
      ["api", "gateway", "mediatool", "postgres", "redis", "worker"].map(
        (name) => `lyx-${name}.service`,
      ),
    );
    expect(
      readFileSync(join(env.LYX_FS_ROOT, "etc/systemd/system/lyx-api.service"), "utf8"),
    ).toContain(`ExecStart=${step} run api\n`);
    // 不启用、不启动，不碰 nginx；没带 --nginx-oom 就不装那份覆盖文件
    expect(first.lines.filter((line) => line.startsWith("systemctl "))).toEqual([
      "systemctl daemon-reload",
    ]);
    expect(first.lines).toContain("useradd --system --create-home --shell /bin/bash lyx-deploy");
    expect(existsSync(join(env.LYX_FS_ROOT, "etc/systemd/system/nginx.service.d"))).toBe(false);

    // 重跑：用户已在（不再建），结果相同；不给 --registry 时 node.env 不动
    const again = sh(NODE_INIT, ["--deploy-key", keyFile], {
      env,
      fakes: FAKES,
      rules: [{ match: "^id -u lyx-deploy$", stdout: "995\n" }, ...rules],
    });
    expect(again.status, again.output).toBe(0);
    expect(again.lines.some((line) => line.startsWith("useradd "))).toBe(false);
    expect(readFileSync(join(deployHome, ".ssh/authorized_keys"), "utf8")).toBe(keys);
    expect(readFileSync(join(home, "node.env"), "utf8")).toContain("registry.example.invalid/lyx/");
  });

  it("--nginx-oom：才装宿主机 nginx 的覆盖文件，不重启 nginx", () => {
    const { env, rules } = setup();
    const result = sh(NODE_INIT, ["--nginx-oom"], { env, fakes: FAKES, rules });
    expect(result.status, result.output).toBe(0);
    expect(
      readFileSync(
        join(env.LYX_FS_ROOT, "etc/systemd/system/nginx.service.d/lyx-oom.conf"),
        "utf8",
      ),
    ).toMatch(/^OOMScoreAdjust=-\d+$/m);
    expect(result.lines.some((line) => /nginx/.test(line) && /restart|reload/.test(line))).toBe(
      false,
    );
    expect(result.output).toContain("authorized_keys 不写");
  });

  it.each<[string, Rule[], string]>([
    [
      "8080 被别的进程占着",
      [{ match: "^ss -ltnH$", stdout: "LISTEN 0 511 127.0.0.1:8080 0.0.0.0:*\n" }],
      "端口 8080 被别的进程占着",
    ],
    [
      "参考工程的容器在跑",
      [{ match: "^docker ps --format", stdout: "liyo-api liyo\nsome-site \n" }],
      "参考工程的容器在跑：liyo-api",
    ],
    [
      "参考工程的进程在跑",
      [{ match: "^pgrep -fl liyo$", stdout: "4242 node /srv/liyo/dist/server.js\n" }],
      "参考工程的进程在跑",
    ],
    [
      "网段与已有的 Docker 网络相撞",
      [{ match: "^docker network inspect", stdout: "other 172.30.0.0/16 \n" }],
      "与已有的相撞：Docker 网络 other（172.30.0.0/16）",
    ],
    [
      "网段与本机网卡相撞",
      [
        {
          match: "^ip -4 -o addr show$",
          stdout: "2: eth0    inet 172.30.41.7/24 brd 172.30.41.255 scope global eth0\n",
        },
      ],
      "网卡 eth0（172.30.41.7/24）",
    ],
  ])("%s：停下并说明，什么都不改", (_name, extra, reason) => {
    const { base, env, rules } = setup();
    const result = sh(NODE_INIT, [], { env, fakes: FAKES, rules: [...extra, ...rules] });
    expect(result.status).toBe(1);
    expect(result.output).toContain(reason);
    expect(result.output).toContain("什么都没有改");
    expect(changed(result.lines)).toEqual([]);
    expect(readdirSync(base).toSorted()).toEqual(["deploy.pub"]);
  });

  it("80、443 被宿主机 nginx 占着不算冲突；8080 由我们自己的 gateway 占着也不算", () => {
    const { env, rules } = setup();
    const result = sh(NODE_INIT, ["--dry-run"], {
      env,
      fakes: FAKES,
      rules: [
        {
          match: "^ss -ltnH$",
          stdout:
            "LISTEN 0 511 0.0.0.0:80 0.0.0.0:*\nLISTEN 0 511 0.0.0.0:443 0.0.0.0:*\nLISTEN 0 4096 127.0.0.1:8080 0.0.0.0:*\n",
        },
        {
          match: "^docker ps --filter name=\\^lyx-gateway\\$",
          stdout: "127.0.0.1:8080->8080/tcp\n",
        },
        ...rules,
      ],
    });
    expect(result.status, result.output).toBe(0);
    expect(result.output).toContain("由我们自己的 gateway 占着");
  });

  it("不是 root 又不带 --dry-run、公钥文件写法不对：以 2 退出", () => {
    const { base, env, rules } = setup();
    const notRoot = sh(NODE_INIT, [], {
      env,
      fakes: FAKES,
      rules: [{ match: "^id -u$", stdout: "1001\n" }, ...rules],
    });
    expect(notRoot.status).toBe(2);
    const bad = join(base, "bad.pub");
    writeFileSync(bad, `command="/bin/sh" ${KEY}\n`);
    const result = sh(NODE_INIT, ["--deploy-key", bad], { env, fakes: FAKES, rules });
    expect(result.status).toBe(2);
    expect(result.output).toContain("公钥文件的写法不对");
    expect(existsSync(env.LYX_NODE_HOME)).toBe(false);
  });
});

describe("systemd 单元与宿主机 nginx 的站点模板", () => {
  it("六个单元：查密钥文件 → 等依赖 → 前台起容器；进程退出即重启；跟着 Docker 重启", () => {
    for (const service of LONG_RUNNING) {
      const unit = read(`infra/deploy/systemd/lyx-${service}.service`);
      const mounts = manifest.some((one) => one.services.split(" ").includes(service));
      const pre = [...unit.matchAll(/^ExecStartPre=(.+)$/gm)].map((row) => row[1] ?? "");
      // 挂了密钥的服务，起之前第一件事是查它那几项密钥文件
      expect(
        pre[0] === `/opt/liyoxi/infra/deploy/check-secrets.sh --service ${service}`,
        service,
      ).toBe(mounts);
      expect(unit).toContain(`ExecStart=/opt/liyoxi/infra/deploy/node-step.sh run ${service}\n`);
      expect(unit).toContain(`ExecStop=/opt/liyoxi/infra/deploy/node-step.sh stop ${service}\n`);
      expect(unit).toMatch(/^Restart=always$/m);
      expect(unit).toMatch(/^RestartSec=3$/m);
      expect(unit).toMatch(/^PartOf=docker\.service$/m);
      expect(unit).toMatch(/^WantedBy=multi-user\.target$/m);
    }
    expect(read("infra/deploy/systemd/lyx-worker.service")).toContain(
      "node-step.sh wait postgres redis mediatool\n",
    );
  });

  it("站点模板：不加响应头；请求体上限不小于 2MB；Host 原样透传；X-Forwarded-For 是覆盖写", () => {
    const template = read("infra/deploy/nginx/site.conf.template").replace(/^\s*#.*$/gm, "");
    expect(template).not.toMatch(/add_header/);
    const limit = /client_max_body_size (\d+)m;/.exec(template)?.[1];
    expect(Number(limit)).toBeGreaterThanOrEqual(2);
    expect(template).toContain("proxy_set_header Host $host;");
    expect(template).toContain("proxy_set_header X-Forwarded-For $remote_addr;");
    expect(template).not.toContain("$proxy_add_x_forwarded_for");
    expect(template).toContain("proxy_pass http://127.0.0.1:${LYX_GATEWAY_PORT};");
  });

  it("render.sh：三个域名各出一份，变量都替换掉了；域名写错即拒绝", () => {
    const out = join(tempDir(), "sites");
    const result = sh(RENDER, ["--out", out]);
    expect(result.status, result.output).toBe(0);
    expect(readdirSync(out).toSorted()).toEqual(
      ["admin", "api", "portal"].map((site) => `lyx-stg-${site}.conf`),
    );
    for (const site of ["api", "admin", "portal"]) {
      const host = new RegExp(`^LYX_${site.toUpperCase()}_HOST=(.+)$`, "m").exec(stgEnv)?.[1];
      const text = readFileSync(join(out, `lyx-stg-${site}.conf`), "utf8");
      expect(text).toContain(`server_name ${host};`);
      expect(text).toContain(`ssl_certificate /etc/nginx/lyx-tls/${host}/fullchain.pem;`);
      expect(text).not.toContain("${");
    }
    const bad = sh(RENDER, ["--out", out], { env: { LYX_API_HOST: "api.example.com; evil" } });
    expect(bad.status).toBe(2);
    // 证书还没签下来时：只要 80 端口的那一段
    expect(sh(RENDER, ["--out", out, "--http-only"]).status).toBe(0);
    const httpOnly = readFileSync(join(out, "lyx-stg-api.conf"), "utf8");
    expect(httpOnly).toContain("listen 80;");
    expect(httpOnly).toContain("/.well-known/acme-challenge/");
    expect(httpOnly).not.toMatch(/listen 443|ssl_certificate/);
  });
});
