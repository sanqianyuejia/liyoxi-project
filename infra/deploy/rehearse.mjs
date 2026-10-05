#!/usr/bin/env node
// @ts-check
// 狸有戏 · 预发节点的本机演练（W2-25 任务书 第 7 节第 1–4、7 条）。根脚本 pnpm stg:rehearse。
// 照节点上的原样走一遍：同一份 infra/compose/node.yml、同一套脚本（gen-secrets.sh、check-secrets.sh、db-init.sh、
// node-step.sh），只换掉会撞本机别的容器的几样：项目名与容器名前缀（每次随机）、网段、gateway 的端口；
// 容器的生命周期由 Compose 直接管（节点上是 systemd）。密钥是现造的假值，放在临时目录里，演练完连容器、卷一起删。
//
//   node infra/deploy/rehearse.mjs          先要有三个本地镜像（pnpm stack:build），库与 Redis 的镜像本机也要有
//   node infra/deploy/rehearse.mjs --keep   演练完不清场，打印怎么手工清（排查用）
//   加 --without-image-smoke：不跑 server 镜像的冒烟（stack-smoke 工作流里同一个任务已经对同一个镜像跑过）
//
// 走什么：造密钥 → 齐备检查 → deps → db-init → pull（本地镜像，跳过）→ check-env → migrate → seed 两遍（第二遍新增 0 行）
//   → 造一条配置类违规再 seed（要以 1 退出），撤掉后再 seed → up → status → verify-db
// 再核对：六个容器的形态（内存上限等于 ADR-041 第 4.2 节的表、只有 gateway 发布端口且只绑回环、固定网段、重启策略 no、
//   日志轮转、内存见底时先杀谁、密钥按清单分挂、docker inspect 里搜不到任何密钥的值）；Redis 的三项设置；
//   经 gateway 的冒烟（照 infra/stack/smoke.mjs 的“经网关”一段）与 server 镜像的冒烟（就是那个脚本的 --image-only）；
//   真实客户端地址（带 X-Forwarded-For 进来，gateway 的访问日志里记的是它）；宿主机 nginx 的三个站点渲染后 nginx -t。
// 可调的环境变量：LYX_STACK_TAG 镜像标签（缺省 local）；LYX_REHEARSE_PORT gateway 的端口（缺省现找一个空闲的）。
// Linux 上密钥文件的属主照清单改（经一次性的 root 容器）；当前用户读不了改完的文件时，db-init.sh 经 sudo -n 跑。
// 退出码：0 全过；1 有一步没成或有一条核对不通过；2 用法或环境不对（没有 Docker、没有镜像）。
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import http from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

import {
  assertDockerRunning,
  docker,
  mustDocker,
  readConfig,
  root,
  runMain,
  StepError,
  UsageError,
} from "../stack/lib.mjs";

const SERVICES = ["postgres", "redis", "mediatool", "api", "worker", "gateway"];
const ADR = "docs/adr/0041-预发先行-单机预发-共用AppID.md";
const read = (/** @type {string} */ path) => readFileSync(join(root, path), "utf8");
const say = (/** @type {string} */ line) => console.log(`\n== ${line}`);

/** @type {string[]} */
const failures = [];
/**
 * @param {string} what
 * @param {boolean} pass
 * @param {unknown} [seen] 不通过时打印看到的值
 */
function check(what, pass, seen) {
  console.log(`${pass ? "  通过  " : "  不通过"} ${what}`);
  if (!pass) {
    if (seen !== undefined) console.log(`          看到的是：${JSON.stringify(seen)}`);
    failures.push(what);
  }
}

/** stg.env 里的一项 */
function stg(/** @type {string} */ key) {
  const value = new RegExp(`^${key}=(.*)$`, "m").exec(read("infra/compose/env/stg.env"))?.[1];
  if (value === undefined) throw new StepError(`infra/compose/env/stg.env 里没有 ${key}`);
  return value.trim();
}

/** 密钥清单 */
function manifest() {
  /** @type {{ secrets: { file: string, uid: number, services: string }[] }} */
  const parsed = JSON.parse(read("infra/deploy/secrets.manifest.json"));
  return parsed.secrets.map((one) => ({
    ...one,
    services: one.services.split(" ").filter(Boolean),
  }));
}

/** ADR-041 第 4.2 节的表：容器 → 内存上限（字节）；mediatool 另有内存加交换的合计 */
function declaredMemory() {
  const MB = 1024 * 1024;
  /** @type {Map<string, { memory: number, memorySwap?: number }>} */
  const limits = new Map();
  for (const row of read(ADR).matchAll(/^\| `lyx-(\w+)` \|[^|]*\|[^|]*\| (\d+)MB([^|]*)\|/gm)) {
    const swap = /内存加交换合计 (\d+)GB/.exec(row[3] ?? "")?.[1];
    limits.set(row[1] ?? "", {
      memory: Number(row[2]) * MB,
      ...(swap ? { memorySwap: Number(swap) * 1024 * MB } : {}),
    });
  }
  if (SERVICES.some((name) => !limits.has(name))) {
    throw new StepError("ADR-041 第 4.2 节的表里读不全六个容器的内存上限");
  }
  return limits;
}

/** 两个 IPv4 网段有没有交集 */
function overlaps(/** @type {string} */ left, /** @type {string} */ right) {
  const parse = (/** @type {string} */ cidr) => {
    const [address = "", length = "32"] = cidr.split("/");
    const value = address.split(".").reduce((sum, part) => sum * 256 + Number(part), 0);
    return { value, length: Number(length) };
  };
  const [one, other] = [parse(left), parse(right)];
  const size = 2 ** (32 - Math.min(one.length, other.length));
  return Math.floor(one.value / size) === Math.floor(other.value / size);
}

/** 找一段不与本机已有 Docker 网络相撞的 /24 */
function pickSubnet() {
  const taken = docker(["network", "ls", "-q"], { capture: true })
    .stdout.split("\n")
    .filter(Boolean)
    .flatMap((id) =>
      docker(["network", "inspect", "-f", "{{range .IPAM.Config}}{{.Subnet}} {{end}}", id], {
        capture: true,
      })
        .stdout.trim()
        .split(/\s+/),
    )
    .filter((cidr) => /^\d+\.\d+\.\d+\.\d+\/\d+$/.test(cidr));
  for (let third = 42; third < 58; third += 1) {
    const subnet = `172.30.${third}.0/24`;
    if (!taken.some((cidr) => overlaps(cidr, subnet))) return subnet;
  }
  throw new UsageError("172.30.42–57 这十六段都与本机已有的 Docker 网络相撞：清掉没用的网络再跑");
}

/** @returns {Promise<number>} */
function freePort() {
  return new Promise((done, fail) => {
    const probe = net.createServer();
    probe.once("error", fail);
    probe.listen({ port: 0, host: "127.0.0.1" }, () => {
      const { port } = /** @type {import("node:net").AddressInfo} */ (probe.address());
      probe.close(() => done(port));
    });
  });
}

/**
 * 发一个请求到本机的 gateway，Host 头另给。
 * @param {number} port
 * @param {string} host
 * @param {string} path
 * @param {{ method?: string, bodyBytes?: number, headers?: Record<string, string> }} [options]
 * @returns {Promise<{ status: number, headers: http.IncomingHttpHeaders, body: string }>}
 */
function request(port, host, path, options = {}) {
  return new Promise((resolve, reject) => {
    const size = options.bodyBytes ?? 0;
    let answered = false;
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path,
        method: options.method ?? "GET",
        headers: {
          Host: host,
          ...options.headers,
          ...(size > 0
            ? { "Content-Type": "application/octet-stream", "Content-Length": size }
            : {}),
        },
        timeout: 20_000,
      },
      (res) => {
        answered = true;
        /** @type {Buffer[]} */
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error(`请求超时：${host}${path}`)));
    // 请求体超限时 gateway 不等收完就应答并断开：应答到手之后的写入错误不算错
    req.on("error", (error) => {
      if (!answered) reject(new StepError(`请求 ${host}${path} 没成：${error.message}`));
    });
    if (size > 0) req.write(Buffer.alloc(size, 0x61));
    req.end();
  });
}

await runMain(async () => {
  let flags;
  try {
    flags = parseArgs({
      // 经 pnpm 写成 pnpm stg:rehearse -- --keep 时，那个 -- 会原样传进来：不当它是参数的终点
      args: process.argv.slice(2).filter((arg) => arg !== "--"),
      options: {
        keep: { type: "boolean", default: false },
        "without-image-smoke": { type: "boolean", default: false },
      },
    }).values;
  } catch {
    throw new UsageError("用法：node infra/deploy/rehearse.mjs [--keep] [--without-image-smoke]");
  }
  const config = readConfig();
  assertDockerRunning();
  const pgImage = stg("LYX_PG_IMAGE");
  const redisImage = stg("LYX_REDIS_IMAGE");
  for (const image of [...Object.values(config.images), pgImage, redisImage]) {
    if (docker(["image", "inspect", "-f", "{{.Id}}", image], { capture: true }).status !== 0) {
      throw new UsageError(
        `没有镜像 ${image}：三个 liyoxi/* 镜像用 pnpm stack:build 出，库与 Redis 的镜像用 pnpm infra:up 或 docker pull 备好`,
      );
    }
  }

  const id = randomBytes(3).toString("hex");
  const prefix = `lyxrh-${id}`;
  const home = realpathSync(mkdtempSync(join(tmpdir(), "lyx-rehearse-")));
  const secretsDir = join(home, "secrets");
  const subnet = pickSubnet();
  const bridge = subnet.replace(/\.0\/24$/, ".1");
  const port = Number(process.env.LYX_REHEARSE_PORT) || (await freePort());
  const uid = process.getuid?.() ?? 0;
  // Linux 上属主是真的：照清单改，并照样核对。别的系统（macOS 的 Docker）改不了也不看，核对时跳过属主
  const realOwners = process.platform === "linux";
  const hosts = {
    api: stg("LYX_API_HOST"),
    admin: stg("LYX_ADMIN_HOST"),
    portal: stg("LYX_PORTAL_HOST"),
  };
  /** @type {NodeJS.ProcessEnv} */
  const env = {
    ...process.env,
    LYX_NODE_HOME: home,
    LYX_SECRETS_DIR: secretsDir,
    LYX_NODE_PREFIX: prefix,
    LYX_NODE_PROJECT: prefix,
    LYX_NODE_SUBNET: subnet,
    LYX_TRUSTED_PROXY_CIDRS: `${bridge}/32`,
    LYX_GATEWAY_PORT: String(port),
    LYX_NODE_SUPERVISOR: "compose",
    LYX_IMAGE_PREFIX: "",
    LYX_API_HOST: hosts.api,
    LYX_ADMIN_HOST: hosts.admin,
    LYX_PORTAL_HOST: hosts.portal,
    ...(realOwners ? {} : { LYX_SECRETS_SKIP_OWNER: "1" }),
  };
  const name = (/** @type {string} */ service) => `${prefix}-${service}`;

  /**
   * 跑一个脚本，输出原样透出来（另收一份供核对）。返回退出码与输出。
   * @param {string} path 仓库内的路径
   * @param {string[]} args
   * @param {{ sudo?: boolean }} [options]
   */
  function script(path, args, options = {}) {
    const keys = ["LYX_NODE_HOME", "LYX_SECRETS_DIR", "LYX_NODE_PREFIX"];
    const command = options.sudo
      ? ["sudo", "-n", "env", ...keys.map((key) => `${key}=${env[key]}`), "bash"]
      : ["bash"];
    const result = spawnSync(
      command[0] ?? "bash",
      [...command.slice(1), join(root, path), ...args],
      {
        cwd: root,
        env,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      },
    );
    if (result.error) throw new StepError(`${path} 没跑起来：${result.error.message}`);
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    process.stdout.write(output);
    return { status: result.status ?? 1, output };
  }
  /** 节点步骤：非 0 即停，后面的都不跑 */
  function step(/** @type {string[]} */ ...args) {
    say(`node-step.sh ${args.join(" ")}`);
    const result = script("infra/deploy/node-step.sh", args);
    if (result.status !== 0) {
      throw new StepError(`节点步骤 ${args[0]} 没过（退出码 ${result.status}）：后面的步骤不跑`);
    }
    return result.output;
  }
  /** 以超级用户在库里跑一句（经容器里的本机套接字） */
  const superSql = (/** @type {string} */ sql) =>
    mustDocker(
      "在演练的库里跑语句",
      [
        "exec",
        name("postgres"),
        "psql",
        "-X",
        "-q",
        "-At",
        "-v",
        "ON_ERROR_STOP=1",
        "-U",
        "postgres",
      ].concat(["-d", stg("LYX_DB_NAME"), "-c", sql]),
      { capture: true },
    ).stdout.trim();

  console.log(
    `演练：前缀 ${prefix}，网段 ${subnet}，gateway 在 127.0.0.1:${port}，镜像标签 ${config.tag}，临时目录 ${home}`,
  );
  try {
    // ---------- 密钥 ----------
    say("造密钥文件（假值，只在临时目录里）");
    if (script("infra/bootstrap/gen-secrets.sh", ["--dir", secretsDir]).status !== 0) {
      throw new StepError("gen-secrets.sh 没成");
    }
    // 记下每个文件里像密钥的片段（24 个字符以上的一串）：后面在 docker inspect 的输出里找它们
    const needles = new Set(
      manifest().flatMap(
        (one) =>
          readFileSync(join(secretsDir, one.file), "utf8").match(/[A-Za-z0-9+/=_-]{24,}/g) ?? [],
      ),
    );
    if (needles.size < manifest().length) throw new StepError("密钥文件里没读出足够的片段");
    let sudo = false;
    if (realOwners && uid !== 0) {
      const chown = manifest()
        .map((one) => `chown ${one.uid}:${one.uid} /s/${one.file}`)
        .join(" && ");
      mustDocker(
        "把密钥文件的属主改成清单写的 uid",
        ["run", "--rm", "--user", "0", "--network", "none", "-v", `${secretsDir}:/s`].concat([
          "--entrypoint",
          "sh",
          config.images.server,
          "-c",
          chown,
        ]),
        { capture: true },
      );
      sudo = uid !== 1000;
      if (sudo && spawnSync("sudo", ["-n", "true"]).status !== 0) {
        throw new UsageError(
          "Linux 上演练要读属主改过的密钥文件：用 root、uid 1000 或能免密 sudo 的用户跑",
        );
      }
    }
    say("check-secrets.sh");
    if (script("infra/deploy/check-secrets.sh", []).status !== 0) {
      throw new StepError("密钥齐备检查没过");
    }

    // ---------- 节点步骤 ----------
    step("deps");
    say("db-init.sh");
    if (script("infra/bootstrap/db-init.sh", [], { sudo }).status !== 0) {
      throw new StepError("db-init.sh 没成");
    }
    check("pull：本地镜像时跳过拉取", /跳过拉取/.test(step("pull", config.tag)));
    step("check-env", config.tag);
    step("migrate", config.tag);
    const first = step("seed", config.tag);
    const second = step("seed", config.tag);
    check(
      "seed 第一遍有新增，第二遍新增 0 行，六条配置类断言 0 违规",
      /播种完成：新增 [1-9]\d* 行/.test(first) &&
        /播种完成：新增 0 行/.test(second) &&
        /断言：0 条违规/.test(second),
      second.split("\n").slice(-4),
    );
    // 造一条违规：给系统枚举字典多塞一项（播种不删多出来的行，config.N16 会报），seed 要以 1 退出；撤掉后恢复。
    // 字典项不许删（有触发器拦）：撤的时候在这一个会话里关掉触发器。这是演练自己的库，用完即删。
    say("造一条配置类违规，seed 要以 1 退出");
    superSql(
      "INSERT INTO dict_item SELECT (jsonb_populate_record(d, jsonb_build_object('id', gen_random_uuid(), 'code', 'lyx_rehearse', 'name', 'lyx_rehearse'))).* FROM dict_item d JOIN dict_type t ON t.type_key = d.dict_type_key WHERE t.is_system ORDER BY d.dict_type_key, d.code LIMIT 1",
    );
    const violated = script("infra/deploy/node-step.sh", ["seed", config.tag]);
    check(
      "断言有违规时 seed 以 1 退出，并点出是哪一条",
      violated.status === 1 && /违规 config\.N16/.test(violated.output),
      { status: violated.status },
    );
    superSql(
      "SET session_replication_role = replica; DELETE FROM dict_item WHERE code = 'lyx_rehearse'",
    );
    step("seed", config.tag);
    step("up", config.tag);
    step("status");
    check(
      "verify-db：库名、扩展、应用账号、角色与授权",
      /库的核对：通过/.test(step("verify-db", config.tag)),
    );

    // ---------- 容器的形态 ----------
    say("容器的形态（docker inspect）");
    const inspected = mustDocker("读容器信息", ["inspect", ...SERVICES.map(name)], {
      capture: true,
    }).stdout;
    /** @type {Map<string, any>} */
    const info = new Map(
      JSON.parse(inspected).map((/** @type {any} */ one) => [
        String(one.Name).replace(`/${prefix}-`, ""),
        one,
      ]),
    );
    const leaked = [...needles].filter((needle) => inspected.includes(needle));
    check("docker inspect 的输出里搜不到任何密钥的值", leaked.length === 0, `${leaked.length} 处`);
    const limits = declaredMemory();
    const swapLimit = docker(["info", "--format", "{{.SwapLimit}}"], {
      capture: true,
    }).stdout.trim();
    for (const service of SERVICES) {
      const host = info.get(service).HostConfig;
      const want = limits.get(service);
      check(
        `${service}：内存上限等于 ADR-041 第 4.2 节的表（${(want?.memory ?? 0) / 1024 / 1024}MB）`,
        host.Memory === want?.memory,
        host.Memory,
      );
      if (want?.memorySwap !== undefined && swapLimit !== "false") {
        check(
          `${service}：内存加交换合计 1GB`,
          host.MemorySwap === want.memorySwap,
          host.MemorySwap,
        );
      }
      check(
        `${service}：重启策略 no，日志 json-file 带轮转`,
        host.RestartPolicy.Name === "no" &&
          host.LogConfig.Type === "json-file" &&
          Boolean(host.LogConfig.Config["max-size"]) &&
          Boolean(host.LogConfig.Config["max-file"]),
        { restart: host.RestartPolicy.Name, log: host.LogConfig },
      );
      const user = String(info.get(service).Config.User);
      check(
        `${service}：非 root、根文件系统只读、去掉全部能力`,
        !/^(|0|root)(:.*)?$/.test(user) &&
          host.ReadonlyRootfs === true &&
          JSON.stringify(host.CapDrop) === '["ALL"]' &&
          host.Privileged === false,
        { user, readOnly: host.ReadonlyRootfs, capDrop: host.CapDrop },
      );
      const ports = Object.entries(host.PortBindings ?? {}).flatMap(([inner, bindings]) =>
        /** @type {{ HostIp: string, HostPort: string }[]} */ (bindings ?? []).map(
          (binding) => `${binding.HostIp}:${binding.HostPort}->${inner}`,
        ),
      );
      check(
        service === "gateway"
          ? `gateway：只发布 ${port}，且只绑回环地址`
          : `${service}：不发布端口`,
        ports.join() === (service === "gateway" ? `127.0.0.1:${port}->8080/tcp` : ""),
        ports,
      );
      const networks = Object.keys(info.get(service).NetworkSettings.Networks ?? {});
      check(
        service === "mediatool" ? "mediatool：没有网络" : `${service}：只接在固定网段的那个网络上`,
        networks.join() === (service === "mediatool" ? "none" : `${prefix}-node`),
        networks,
      );
      // 密钥按清单分挂：容器里 /run/secrets 下恰好是清单写给它的那几项
      const mounted = (info.get(service).Mounts ?? [])
        .map((/** @type {any} */ mount) => String(mount.Destination))
        .filter((/** @type {string} */ path) => path.startsWith("/run/secrets/"))
        .map((/** @type {string} */ path) => path.slice("/run/secrets/".length))
        .sort();
      const expected = manifest()
        .filter((one) => one.services.includes(service))
        .map((one) => one.file)
        .sort();
      check(
        `${service}：挂的密钥恰好是清单写给它的 ${expected.length} 项`,
        mounted.join() === expected.join(),
        mounted,
      );
    }
    const network = mustDocker(
      "读网络",
      ["network", "inspect", "-f", "{{range .IPAM.Config}}{{.Subnet}}{{end}}", `${prefix}-node`],
      { capture: true },
    ).stdout.trim();
    check(`网络是固定网段 ${subnet}`, network === subnet, network);
    const oom = (/** @type {string} */ service) => Number(info.get(service).HostConfig.OomScoreAdj);
    check(
      "内存见底时先杀 mediatool、最后才轮到库",
      SERVICES.every((service) => service === "mediatool" || oom(service) < oom("mediatool")) &&
        SERVICES.every((service) => service === "postgres" || oom(service) > oom("postgres")),
      SERVICES.map((service) => `${service}=${oom(service)}`),
    );

    // ---------- Redis ----------
    say("Redis 的设置");
    const redis = (/** @type {string} */ command) =>
      docker(["exec", name("redis"), "sh", "-c", command], { capture: true }).stdout.trim();
    const authed = `redis-cli --no-auth-warning -a "$(cut -d' ' -f2 /run/secrets/redis-auth.conf)"`;
    const setting = (/** @type {string} */ key) =>
      redis(`${authed} CONFIG GET ${key}`).split("\n")[1] ?? "";
    check("maxmemory-policy 是 noeviction", setting("maxmemory-policy") === "noeviction");
    check("AOF 开着", setting("appendonly") === "yes", setting("appendonly"));
    check(
      "maxmemory 是 64MB",
      setting("maxmemory") === String(64 * 1024 * 1024),
      setting("maxmemory"),
    );
    check("不带口令连不上", /NOAUTH/.test(redis("redis-cli ping 2>&1")));

    // ---------- 经 gateway ----------
    say(`经 gateway（127.0.0.1:${port}）`);
    for (const path of ["/healthz", "/readyz"]) {
      const res = await request(port, hosts.api, path);
      check(`${hosts.api}${path} 回 200`, res.status === 200, res.status);
    }
    const byAddress = await request(port, `127.0.0.1:${port}`, "/readyz");
    check("按地址来的 /readyz 回 200", byAddress.status === 200, byAddress.status);
    for (const [label, host] of [
      ["后台", hosts.admin],
      ["下载页", hosts.portal],
    ]) {
      const page = await request(port, host ?? "", "/");
      check(
        `${label}：入口页 200、不缓存、带安全响应头`,
        page.status === 200 &&
          /<meta name="lyx-build" content="[^"]+"/.test(page.body) &&
          page.headers["cache-control"] === "no-cache" &&
          page.headers["x-content-type-options"] === "nosniff" &&
          /script-src 'self'/.test(String(page.headers["content-security-policy"])),
        { status: page.status, cache: page.headers["cache-control"] },
      );
      const assets = [
        ...new Set(
          [...page.body.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1] ?? ""),
        ),
      ];
      /** @type {string[]} */
      const bad = [];
      for (const asset of assets) {
        const res = await request(port, host ?? "", asset);
        if (res.status !== 200 || !/immutable/.test(String(res.headers["cache-control"]))) {
          bad.push(`${asset} → ${res.status}`);
        }
      }
      check(
        `${label}：入口页引用的 ${assets.length} 个 /assets/ 文件都是 200 且长缓存`,
        assets.length > 0 && bad.length === 0,
        bad,
      );
    }
    for (const [host, path] of [
      [hosts.admin, "/api/v1/m/bootstrap"],
      [hosts.portal, "/api/v1/admin/sessions"],
      [hosts.api, "/api/v1/admin/sessions"],
      [hosts.api, "/"],
      ["unknown.invalid", "/api/v1/m/bootstrap"],
    ]) {
      const res = await request(port, host ?? "", path ?? "");
      check(
        `${host}${path} 得 404，且没有转给 api`,
        res.status === 404 && res.headers["x-request-id"] === undefined,
        res.status,
      );
    }
    for (const [host, path] of [
      [hosts.api, "/api/v1/m/lyx-smoke-no-such-route"],
      [hosts.admin, "/api/v1/admin/lyx-smoke-no-such-route"],
      [hosts.portal, "/api/v1/portal/lyx-smoke-no-such-route"],
    ]) {
      const res = await request(port, host ?? "", path ?? "");
      check(
        `${host}${path} 转到了 api（404 带 X-Request-Id）`,
        res.status === 404 && typeof res.headers["x-request-id"] === "string",
        res.status,
      );
    }
    const MB = 1024 * 1024;
    const nowhere = "/api/v1/m/lyx-smoke-no-such-route";
    const tooBig = await request(port, hosts.api, nowhere, {
      method: "POST",
      bodyBytes: 2 * MB + 1,
    });
    check("请求体超过 2MB 得 413", tooBig.status === 413, tooBig.status);
    const hookTooBig = await request(port, hosts.api, "/api/v1/hooks/lyx-smoke-no-such-route", {
      method: "POST",
      bodyBytes: MB + 1,
    });
    check("回调的请求体超过 1MB 得 413", hookTooBig.status === 413, hookTooBig.status);
    const probe =
      'require("node:http").get({ socketPath: "/work/.sock/mediatool.sock", path: "/healthz", timeout: 5000 }, (res) => { console.log(res.statusCode); res.resume(); }).on("error", (e) => { console.log("ERR " + e.message); })';
    const socket = docker(["exec", name("worker"), "node", "-e", probe], { capture: true });
    check(
      "从 worker 容器经共享卷里的套接字问 mediatool 得 200",
      socket.stdout.trim() === "200",
      socket.stdout.trim(),
    );

    // 真实客户端地址：宿主机 nginx 覆盖写 X-Forwarded-For；gateway 只信网桥地址带来的，访问日志里记的应是它
    const requestId = "00000000-0000-4000-8000-" + randomBytes(6).toString("hex");
    await request(port, hosts.api, "/healthz", {
      headers: { "X-Forwarded-For": "203.0.113.9", "X-Request-Id": requestId },
    });
    const logged = docker(["logs", "--tail", "200", name("gateway")], { capture: true });
    const line = `${logged.stdout}\n${logged.stderr}`
      .split("\n")
      .find((one) => one.includes(requestId));
    const remote = line ? String(JSON.parse(line).remote_addr) : "";
    check(
      `从宿主机进 gateway 的来源是网桥地址 ${bridge}（在可信网段内）：访问日志记的客户端地址取自 X-Forwarded-For`,
      remote === "203.0.113.9",
      remote || "访问日志里没找到这一条",
    );

    // ---------- server 镜像（W1-22 的冒烟，原样） ----------
    if (!flags["without-image-smoke"]) {
      say("server 镜像的冒烟（node infra/stack/smoke.mjs --image-only）");
      const image = spawnSync(
        process.execPath,
        [join(root, "infra/stack/smoke.mjs"), "--image-only"],
        {
          cwd: root,
          env,
          stdio: "inherit",
        },
      );
      check("infra/stack/smoke.mjs --image-only 通过", image.status === 0, image.status);
    }

    // ---------- 宿主机 nginx 的三个站点 ----------
    say("宿主机 nginx 的三个站点：渲染后 nginx -t");
    const sites = join(home, "nginx-sites");
    const tls = join(home, "nginx-tls");
    if (script("infra/deploy/nginx/render.sh", ["--out", sites]).status !== 0) {
      throw new StepError("render.sh 没成");
    }
    // 现造一张自签证书（库的镜像里有 openssl）；三个域名各放一份，路径照模板里的写法
    for (const host of Object.values(hosts)) mkdirSync(join(tls, host), { recursive: true });
    const firstHost = join(tls, hosts.api);
    mustDocker(
      "造自签证书",
      ["run", "--rm", "--network", "none", "--user", `${uid}:${process.getgid?.() ?? 0}`]
        .concat(["-v", `${firstHost}:/out`, "--entrypoint", "openssl", pgImage, "req", "-x509"])
        .concat(["-newkey", "rsa:2048", "-nodes", "-days", "2", "-subj", "/CN=lyx-rehearse"])
        .concat(["-keyout", "/out/privkey.pem", "-out", "/out/fullchain.pem"]),
      { capture: true },
    );
    for (const host of [hosts.admin, hosts.portal]) {
      for (const file of ["privkey.pem", "fullchain.pem"]) {
        copyFileSync(join(firstHost, file), join(tls, host, file));
      }
    }
    writeFileSync(
      join(home, "nginx-test.conf"),
      "pid /tmp/nginx.pid;\nerror_log stderr;\nevents {}\nhttp {\n  include /etc/nginx/mime.types;\n  include /etc/nginx/lyx-sites/*.conf;\n}\n",
    );
    const tested = docker(
      ["run", "--rm", "--network", "none", "--tmpfs", "/tmp", "--user", "0"]
        .concat(["-v", `${sites}:/etc/nginx/lyx-sites:ro`, "-v", `${tls}:/etc/nginx/lyx-tls:ro`])
        .concat(["-v", `${join(home, "nginx-test.conf")}:/etc/nginx/lyx-test.conf:ro`])
        .concat([
          "--entrypoint",
          "nginx",
          config.images.gateway,
          "-t",
          "-c",
          "/etc/nginx/lyx-test.conf",
        ]),
      { capture: true },
    );
    check(
      "三个站点渲染后 nginx -t 通过",
      tested.status === 0 && /test is successful/.test(tested.stderr),
      tested.stderr.trim().split("\n").slice(-3),
    );
  } catch (error) {
    // 没过时的现场：容器的状态与各自最后几行日志
    docker(["ps", "-a", "--filter", `name=${prefix}-`]);
    for (const service of SERVICES) {
      console.error(`\n-- ${name(service)} 最后 30 行日志 --`);
      docker(["logs", "--tail", "30", name(service)]);
    }
    throw error;
  } finally {
    if (flags.keep) {
      console.log(
        `\n--keep：没有清场。手工清：LYX_SRC=${root} LYX_SECRETS_DIR=${secretsDir} LYX_TAG=${config.tag} LYX_NODE_PREFIX=${prefix} LYX_NODE_SUBNET=${subnet} LYX_TRUSTED_PROXY_CIDRS=${bridge}/32 docker compose -p ${prefix} --env-file infra/compose/env/stg.env -f infra/compose/node.yml down -v --remove-orphans && rm -rf ${home}`,
      );
    } else {
      say("清场：删掉演练的容器、网络、卷与临时目录");
      const down = docker(
        ["compose", "-p", prefix, "--env-file", join(root, "infra/compose/env/stg.env")].concat([
          "-f",
          join(root, "infra/compose/node.yml"),
          "down",
          "-v",
          "--remove-orphans",
        ]),
        { capture: true, env: { ...env, LYX_SRC: root, LYX_TAG: config.tag } },
      );
      if (down.status !== 0) console.error(`清场没清干净：${down.stderr.trim()}`);
      rmSync(home, { recursive: true, force: true });
    }
  }

  if (failures.length > 0) {
    throw new StepError(`\n演练不通过，共 ${failures.length} 条：\n- ${failures.join("\n- ")}`);
  }
  console.log("\n演练通过");
});
