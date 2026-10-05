#!/usr/bin/env node
// @ts-check
// 狸有戏 · 本地整套环境的冒烟（W1-22 任务书 第 7 节第 2、4、5 条）。在宿主机上跑，只用 Node 内置模块与 docker 命令行。
//
//   node infra/stack/smoke.mjs                pnpm stack:smoke：三段都跑（要先 pnpm stack:up）
//   node infra/stack/smoke.mjs --image-only   只看 server 镜像的内容，不要整套环境在跑，不连库
//   node infra/stack/smoke.mjs --inspect-only 只核对四个容器的约束（读 docker inspect）
//   加 --lan：gateway 是用 pnpm stack:up --lan 起的（发布的端口绑全部网卡，另有对象存储的端口），端口那一条按它核对
//
// 三段：
//   镜像    pg_dump 的主版本 = infra/compose/local.yml 里 PostgreSQL 的主版本；age 可跑；三个 TTF 的 sha256 与字体目录
//           README 的表一致、两份许可文本在；没有 ffmpeg、ffprobe；运行用户不是 root；缺必填变量时 worker --check 与
//           check-env 非 0 并指出键名，给全变量时 check-env 以 0 退出
//   经网关  api 域名的 /healthz、/readyz 回 200，/health 里 worker 一项不是 down；后台、下载页的入口页不缓存、带安全头，
//           页里引用的每个 /assets/ 文件 200 且长缓存；域名与接口面不配的组合由 gateway 回 404（不转给 api）；
//           请求体超 2MB（回调超 1MB）得 413；从 worker 容器经共享卷里的套接字问 mediatool 的 /healthz 得 200；
//           给全变量时 worker --check 以 0 退出（它要连跑过迁移的库，所以在这一段）
//   约束    mediatool 的十三项与 infra/docker/mediatool/compose.verify.yml 的写法一致；api、worker、gateway 非 root、
//           根只读；只有 gateway 发布端口，且只绑回环地址
// 每一条打印“通过 / 不通过”，不通过的附上看到的值；有一条不通过即以 1 退出。
import http from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

import {
  assertDockerRunning,
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

/** @type {string[]} */
const failures = [];
const say = (/** @type {string} */ line) => console.log(`\n== ${line}`);

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

const read = (/** @type {string} */ path) => readFileSync(join(root, path), "utf8");

// ---------- 镜像 ----------

/** local.yml 里 PostgreSQL 镜像的主版本 */
function declaredPgMajor() {
  const major = /^ {4}image: postgres:(\d+)[-.\w]*$/m.exec(read("infra/compose/local.yml"))?.[1];
  if (!major) throw new StepError("infra/compose/local.yml 里读不出 PostgreSQL 的主版本");
  return major;
}

/** 字体目录 README 第 1 节的表：文件名 → sha256 */
function declaredFonts() {
  const table = read("infra/docker/server/fonts/README.md");
  const fonts = new Map(
    [...table.matchAll(/^\| `([\w.-]+\.ttf)` \|.*\| sha256 `([0-9a-f]{64})` \|$/gm)].map((row) => [
      row[1] ?? "",
      row[2] ?? "",
    ]),
  );
  if (fonts.size === 0) throw new StepError("字体目录的 README 里读不出校验和的表");
  return fonts;
}

/**
 * 在 server 镜像的一次性容器里跑一条命令：不接网络，约束与正式起的容器相同。
 * @param {string} image
 * @param {string[]} command
 * @param {Record<string, string>} [env]
 */
function inImage(image, command, env = {}) {
  return docker(
    [
      "run",
      "--rm",
      "--network",
      "none",
      "--read-only",
      "--tmpfs",
      "/tmp",
      "--cap-drop",
      "ALL",
      ...Object.entries(env).flatMap(([key, value]) => ["-e", `${key}=${value}`]),
      image,
      ...command,
    ],
    { capture: true, timeoutMs: 120_000 },
  );
}

/** @param {string} image */
function imageChecks(image) {
  say(`镜像 ${image}`);
  if (docker(["image", "inspect", "-f", "{{.Id}}", image], { capture: true }).status !== 0) {
    throw new UsageError(`没有镜像 ${image}：先 pnpm stack:build`);
  }

  const major = declaredPgMajor();
  const pgDump = inImage(image, ["pg_dump", "--version"]);
  check(
    `pg_dump 的主版本是 ${major}（与 local.yml 里的 PostgreSQL 相同）`,
    pgDump.status === 0 && new RegExp(`^pg_dump \\(PostgreSQL\\) ${major}\\.`).test(pgDump.stdout),
    pgDump.stdout.trim() || pgDump.stderr.trim(),
  );
  const age = inImage(image, ["age", "--version"]);
  check("age 可跑", age.status === 0 && age.stdout.trim() !== "", age.stderr.trim());

  const fonts = declaredFonts();
  const sums = inImage(image, [
    "sh",
    "-c",
    'cd "$LYX_PDF_FONT_DIR" && sha256sum *.ttf && ls OFL-*.txt',
  ]);
  const seen = new Map(
    [...sums.stdout.matchAll(/^([0-9a-f]{64}) {2}(\S+\.ttf)$/gm)].map((row) => [row[2], row[1]]),
  );
  check(
    `字体目录（LYX_PDF_FONT_DIR）里是 README 登记的 ${fonts.size} 个 TTF，sha256 逐个相同`,
    sums.status === 0 &&
      seen.size === fonts.size &&
      [...fonts].every(([name, sum]) => seen.get(name) === sum),
    sums.stdout.trim() || sums.stderr.trim(),
  );
  check(
    "两份字体许可文本在",
    (sums.stdout.match(/^OFL-\w+\.txt$/gm) ?? []).length === 2,
    sums.stdout.trim(),
  );

  const ffmpeg = inImage(image, ["sh", "-c", "command -v ffmpeg ffprobe"]);
  check(
    "没有 ffmpeg、ffprobe",
    ffmpeg.status !== 0 && ffmpeg.stdout.trim() === "",
    ffmpeg.stdout.trim(),
  );

  const user = mustDocker("读镜像配置", ["image", "inspect", "-f", "{{.Config.User}}", image], {
    capture: true,
  }).stdout.trim();
  const uid = inImage(image, ["id", "-u"]);
  check(
    "运行用户不是 root",
    !["", "0", "root", "0:0", "root:root"].includes(user) && uid.stdout.trim() !== "0",
    { user, uid: uid.stdout.trim() },
  );

  const noEnv = inImage(image, ["node", "apps/worker/dist/index.js", "--check"]);
  check(
    "worker --check 缺必填变量：非 0 退出，指出键名",
    noEnv.status !== 0 && /DATABASE_URL: 必填/.test(noEnv.stderr),
    { status: noEnv.status, stderr: noEnv.stderr.trim().slice(0, 300) },
  );
  const envMissing = inImage(image, ["node", "apps/api/dist/check-env.js"], { APP_ENV: "local" });
  check(
    "check-env 缺必填变量：非 0 退出，指出键名",
    envMissing.status !== 0 && /REDIS_URL: 必填/.test(envMissing.stderr),
    { status: envMissing.status, stderr: envMissing.stderr.trim().slice(0, 300) },
  );
  // 只校验写法，不连：值是不指向任何地方的占位
  const envFull = inImage(image, ["node", "apps/api/dist/check-env.js"], {
    APP_ENV: "local",
    DATABASE_URL: "postgresql://placeholder@db.invalid:5432/placeholder",
    REDIS_URL: "redis://redis.invalid:6379/0",
  });
  check("check-env 给全变量：以 0 退出", envFull.status === 0, {
    status: envFull.status,
    stderr: envFull.stderr.trim().slice(0, 300),
  });
  const prisma = inImage(image, ["prisma", "--version"]);
  check(
    "prisma 命令行可跑（迁移入口）",
    prisma.status === 0 && /^prisma\s*:\s*\d+\./m.test(prisma.stdout),
    { status: prisma.status, output: `${prisma.stdout}\n${prisma.stderr}`.trim().slice(0, 300) },
  );
}

// ---------- 经网关 ----------

/**
 * 发一个请求到本机的 gateway，Host 头另给（不依赖本机把 *.localhost 解析到回环地址）。
 * @param {number} port
 * @param {string} host
 * @param {string} path
 * @param {{ method?: string, bodyBytes?: number }} [options]
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

const sleep = (/** @type {number} */ ms) => new Promise((done) => setTimeout(done, ms));

/**
 * 后台、下载页的入口页与它引用的资源。
 * @param {number} port
 * @param {string} host
 * @param {string} label
 */
async function staticChecks(port, host, label) {
  const page = await request(port, host, "/");
  check(
    `${label}：${host}/ 给出入口页（带构建号）`,
    page.status === 200 &&
      /text\/html/.test(String(page.headers["content-type"])) &&
      /<meta name="lyx-build" content="[^"]+"/.test(page.body),
    { status: page.status, type: page.headers["content-type"] },
  );
  check(
    `${label}：入口页不缓存`,
    page.headers["cache-control"] === "no-cache",
    page.headers["cache-control"],
  );
  check(
    `${label}：入口页带安全响应头（CSP、nosniff、禁止被嵌入）`,
    /script-src 'self'/.test(String(page.headers["content-security-policy"])) &&
      page.headers["x-content-type-options"] === "nosniff" &&
      page.headers["x-frame-options"] === "DENY",
    {
      csp: page.headers["content-security-policy"],
      nosniff: page.headers["x-content-type-options"],
      frame: page.headers["x-frame-options"],
    },
  );
  const assets = [
    ...new Set([...page.body.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1] ?? "")),
  ];
  /** @type {string[]} */
  const bad = [];
  for (const asset of assets) {
    const res = await request(port, host, asset);
    const cache = String(res.headers["cache-control"]);
    if (res.status !== 200 || !/max-age=31536000/.test(cache) || !/immutable/.test(cache)) {
      bad.push(`${asset} → ${res.status}，Cache-Control: ${cache}`);
    }
  }
  check(
    `${label}：入口页引用的 ${assets.length} 个 /assets/ 文件都是 200 且长缓存`,
    assets.length > 0 && bad.length === 0,
    assets.length === 0 ? "入口页里没有 /assets/ 的引用" : bad,
  );
  const missing = await request(port, host, "/assets/no-such-file.js");
  check(
    `${label}：不存在的 /assets/ 文件回 404，不回落到入口页，也不长缓存`,
    missing.status === 404 && missing.headers["cache-control"] === undefined,
    { status: missing.status, cache: missing.headers["cache-control"] },
  );
  const route = await request(port, host, "/some/front-end/route");
  check(
    `${label}：前端路由的地址回落到入口页`,
    route.status === 200 && /<meta name="lyx-build"/.test(route.body),
    route.status,
  );
}

/**
 * @param {ReturnType<typeof readConfig>} config
 */
async function gatewayChecks(config) {
  const { port } = config;
  const { api, admin, portal } = STACK.hosts;
  say(`经网关（127.0.0.1:${port}）`);

  for (const path of ["/healthz", "/readyz"]) {
    const res = await request(port, api, path);
    check(`${api}${path} 回 200`, res.status === 200, { status: res.status, body: res.body });
  }
  // /health 有几秒的缓存；worker 刚拿到租约时等一等。整体状态码不断言：探针循环 M2 才有，在那之前是 503
  let health = { status: 0, body: "" };
  let worker = "";
  for (let attempt = 0; attempt < 20; attempt += 1) {
    health = await request(port, api, "/health");
    try {
      worker = String(JSON.parse(health.body).worker);
    } catch {
      worker = "";
    }
    if (worker !== "" && worker !== "down") break;
    await sleep(2_000);
  }
  check(`${api}/health 里 worker 一项不是 down（worker 持有租约）`, worker === "ok", {
    status: health.status,
    body: health.body.slice(0, 300),
  });

  // Host 不是三个域名之一（负载均衡按节点地址探活）：只给探活
  const byAddress = await request(port, `127.0.0.1:${port}`, "/readyz");
  check("按地址来的 /readyz 回 200（负载均衡探活）", byAddress.status === 200, byAddress.status);

  await staticChecks(port, admin, "后台");
  await staticChecks(port, portal, "下载页");

  // 域名隔离：不配的组合由 gateway 自己回 404。api 的应答一律带 X-Request-Id，没有它就说明没转过去
  const isolated = [
    [admin, "/api/v1/m/bootstrap"],
    [admin, "/api/v1/portal/sessions"],
    [admin, "/api/v1/hooks/wechat-pay"],
    [portal, "/api/v1/admin/sessions"],
    [portal, "/api/v1/m/bootstrap"],
    [api, "/api/v1/admin/sessions"],
    [api, "/api/v1/portal/sessions"],
    [api, "/internal/health/finance"],
    [api, "/"],
    ["unknown.localhost", "/api/v1/m/bootstrap"],
  ];
  for (const [host = "", path = ""] of isolated) {
    const res = await request(port, host, path);
    check(
      `${host}${path} 得 404，且没有转给 api`,
      res.status === 404 && res.headers["x-request-id"] === undefined,
      { status: res.status, requestId: res.headers["x-request-id"] },
    );
  }
  // 配得上的组合确实转到了 api：路径不存在，404 是 api 给的（带 X-Request-Id）
  const proxied = [
    [api, "/api/v1/m/lyx-smoke-no-such-route"],
    [admin, "/api/v1/admin/lyx-smoke-no-such-route"],
    [portal, "/api/v1/portal/lyx-smoke-no-such-route"],
  ];
  for (const [host = "", path = ""] of proxied) {
    const res = await request(port, host, path);
    check(
      `${host}${path} 转到了 api（404 带 X-Request-Id）`,
      res.status === 404 && typeof res.headers["x-request-id"] === "string",
      { status: res.status, requestId: res.headers["x-request-id"] },
    );
  }

  const MB = 1024 * 1024;
  const tooBig = await request(port, api, "/api/v1/m/lyx-smoke-no-such-route", {
    method: "POST",
    bodyBytes: 2 * MB + 1,
  });
  check("请求体超过 2MB 得 413", tooBig.status === 413, tooBig.status);
  const underLimit = await request(port, api, "/api/v1/m/lyx-smoke-no-such-route", {
    method: "POST",
    bodyBytes: MB + 1,
  });
  check(
    "请求体 1MB 多一点（不到 2MB）不被 gateway 拦",
    underLimit.status !== 413,
    underLimit.status,
  );
  const hookTooBig = await request(port, api, "/api/v1/hooks/lyx-smoke-no-such-route", {
    method: "POST",
    bodyBytes: MB + 1,
  });
  check("回调的请求体超过 1MB 得 413", hookTooBig.status === 413, hookTooBig.status);

  // 从 worker 容器经共享卷里的套接字问 mediatool
  const probe =
    'require("node:http").get({ socketPath: "/work/.sock/mediatool.sock", path: "/healthz", timeout: 5000 }, (res) => { console.log(res.statusCode); res.resume(); }).on("error", (e) => { console.log("ERR " + e.message); }).on("timeout", function () { this.destroy(new Error("timeout")); })';
  const socket = docker(["exec", "lyx-worker", "node", "-e", probe], { capture: true });
  check(
    "从 worker 容器经共享卷里的套接字问 mediatool 的 /healthz 得 200",
    socket.status === 0 && socket.stdout.trim() === "200",
    `${socket.stdout}${socket.stderr}`.trim(),
  );

  // 给全变量的 worker --check：环境变量照抄正在跑的 worker 容器的（不在这里另写一份连接串）
  const env = JSON.parse(
    mustDocker(
      "读 worker 容器的环境变量",
      ["inspect", "-f", "{{json .Config.Env}}", "lyx-worker"],
      {
        capture: true,
      },
    ).stdout,
  ).filter((/** @type {string} */ pair) =>
    /^(APP_ENV|LOG_LEVEL|DATABASE_URL|REDIS_URL)=/.test(pair),
  );
  const selfCheck = docker(
    [
      "run",
      "--rm",
      "--network",
      DEPS.network,
      "--read-only",
      "--tmpfs",
      "/tmp",
      "--cap-drop",
      "ALL",
      ...env.flatMap((/** @type {string} */ pair) => ["-e", pair]),
      config.images.server,
      "node",
      "apps/worker/dist/index.js",
      "--check",
    ],
    { capture: true, timeoutMs: 120_000 },
  );
  check("worker --check 给全变量：以 0 退出", selfCheck.status === 0, {
    status: selfCheck.status,
    stderr: selfCheck.stderr.trim().slice(0, 400),
  });
}

// ---------- 约束 ----------

/** compose.verify.yml 里 mediatool 一段的写法：期望值从这里读，不在脚本里另写一份 */
function mediatoolSpec() {
  const text = read("infra/docker/mediatool/compose.verify.yml");
  const block = /^ {2}mediatool:\n((?: {4}.*\n|\n)+)/m.exec(text)?.[1];
  if (!block) throw new StepError("compose.verify.yml 里找不到 mediatool 一段");
  const scalar = (/** @type {string} */ key) =>
    new RegExp(`^ {4}${key}: (.+)$`, "m").exec(block)?.[1]?.replace(/^"|"$/g, "");
  const list = (/** @type {string} */ key) =>
    [
      ...(new RegExp(`^ {4}${key}:\\n((?: {6}- .+\\n)+)`, "m").exec(block)?.[1] ?? "").matchAll(
        /^ {6}- (.+)$/gm,
      ),
    ].map((row) => row[1] ?? "");
  const memory = /^(\d+)([mg])$/.exec(scalar("mem_limit") ?? "");
  const spec = {
    networkMode: scalar("network_mode"),
    readOnly: scalar("read_only") === "true",
    user: scalar("user"),
    capDrop: list("cap_drop"),
    securityOpt: list("security_opt"),
    pidsLimit: Number(scalar("pids_limit")),
    memoryBytes: memory ? Number(memory[1]) * (memory[2] === "g" ? 1024 ** 3 : 1024 ** 2) : NaN,
    nanoCpus: Number(scalar("cpus")) * 1e9,
    tmpfs: list("tmpfs"),
    volumes: list("volumes"),
  };
  const incomplete = Object.entries(spec).filter(
    ([, value]) =>
      value === undefined ||
      (typeof value === "number" && !Number.isFinite(value)) ||
      (Array.isArray(value) && value.length === 0),
  );
  if (incomplete.length > 0) {
    throw new StepError(
      `compose.verify.yml 的 mediatool 一段读不全：${incomplete.map(([key]) => key).join("、")}`,
    );
  }
  return spec;
}

/**
 * @param {string} name
 * @returns {any}
 */
function inspect(name) {
  const result = docker(["inspect", "--type", "container", name], { capture: true });
  if (result.status !== 0) throw new UsageError(`没有容器 ${name}：先 pnpm stack:up`);
  return JSON.parse(result.stdout)[0];
}

/** @param {any} info */
const publishedPorts = (info) =>
  Object.entries(info.HostConfig.PortBindings ?? {}).flatMap(([port, bindings]) =>
    /** @type {{ HostIp: string, HostPort: string }[]} */ (bindings ?? []).map(
      (binding) => `${binding.HostIp}:${binding.HostPort}->${port}`,
    ),
  );

/**
 * @param {ReturnType<typeof readConfig>} config
 * @param {{ lan: boolean }} flags
 */
function constraintChecks(config, flags) {
  say("容器约束（docker inspect）");
  const spec = mediatoolSpec();

  const mediatool = inspect("lyx-mediatool");
  const host = mediatool.HostConfig;
  const m = (/** @type {string} */ what) => `mediatool：${what}`;
  check(
    m(`无网络（network_mode: ${spec.networkMode}）`),
    host.NetworkMode === spec.networkMode,
    host.NetworkMode,
  );
  check(
    m("只接在 none 网络上"),
    Object.keys(mediatool.NetworkSettings.Networks ?? {}).join() === "none",
    Object.keys(mediatool.NetworkSettings.Networks ?? {}),
  );
  check(m("根文件系统只读"), host.ReadonlyRootfs === spec.readOnly, host.ReadonlyRootfs);
  check(
    m(`运行用户 ${spec.user}，不是 root`),
    mediatool.Config.User === spec.user,
    mediatool.Config.User,
  );
  check(
    m("去掉全部能力，没有加回任何一项"),
    JSON.stringify(host.CapDrop) === JSON.stringify(spec.capDrop) &&
      (host.CapAdd ?? []).length === 0,
    { CapDrop: host.CapDrop, CapAdd: host.CapAdd },
  );
  check(
    m("no-new-privileges"),
    spec.securityOpt.every((opt) => (host.SecurityOpt ?? []).includes(opt)),
    host.SecurityOpt,
  );
  check(m("不是特权容器"), host.Privileged === false, host.Privileged);
  check(m(`进程数上限 ${spec.pidsLimit}`), host.PidsLimit === spec.pidsLimit, host.PidsLimit);
  check(m("内存上限与 compose.verify.yml 相同"), host.Memory === spec.memoryBytes, host.Memory);
  // 宿主机的内核不支持限制交换区时，Docker 会把这一项丢掉（inspect 里是 -1）：那就核对不了，明说，不算不通过
  const swapLimit = docker(["info", "--format", "{{.SwapLimit}}"], { capture: true });
  if (swapLimit.stdout.trim() === "false") {
    console.log(
      "  没核对 mediatool：交换区的上限（宿主机不支持限制交换区，docker info 的 SwapLimit 是 false）",
    );
  } else {
    check(
      m("内存加交换区的上限等于内存上限（不许用交换区）"),
      host.MemorySwap === spec.memoryBytes,
      host.MemorySwap,
    );
  }
  check(m("CPU 上限与 compose.verify.yml 相同"), host.NanoCpus === spec.nanoCpus, host.NanoCpus);
  const tmp = /^\/tmp:(.+)$/.exec(spec.tmpfs[0] ?? "")?.[1] ?? "";
  check(
    m(`/tmp 是内存盘（${tmp}）`),
    Object.keys(host.Tmpfs ?? {}).join() === "/tmp" && host.Tmpfs["/tmp"] === tmp,
    host.Tmpfs,
  );
  const mounts = (mediatool.Mounts ?? []).map(
    (/** @type {any} */ mount) => `${mount.Type}:${mount.Destination}`,
  );
  check(m("只挂了共享目录 /work（命名卷）"), mounts.join() === "volume:/work", mounts);
  // 不带环境变量：容器里的环境变量就是镜像自带的那几个，Compose 一个都没加
  const imageEnv = JSON.parse(
    mustDocker(
      "读 mediatool 镜像的配置",
      ["image", "inspect", "-f", "{{json .Config.Env}}", mediatool.Image],
      {
        capture: true,
      },
    ).stdout,
  );
  const extra = (mediatool.Config.Env ?? []).filter(
    (/** @type {string} */ pair) => !imageEnv.includes(pair),
  );
  check(
    m("不带环境变量（只有镜像自带的）"),
    extra.length === 0,
    extra.map((/** @type {string} */ pair) => pair.split("=")[0]),
  );
  check(m("不发布端口"), publishedPorts(mediatool).length === 0, publishedPorts(mediatool));

  for (const name of ["lyx-api", "lyx-worker", "lyx-gateway"]) {
    const info = inspect(name);
    const user = String(info.Config.User);
    check(
      `${name}：非 root、根文件系统只读、去掉全部能力`,
      !/^(|0|root)(:.*)?$/.test(user) &&
        info.HostConfig.ReadonlyRootfs === true &&
        JSON.stringify(info.HostConfig.CapDrop) === '["ALL"]' &&
        info.HostConfig.Privileged === false,
      {
        User: user,
        ReadonlyRootfs: info.HostConfig.ReadonlyRootfs,
        CapDrop: info.HostConfig.CapDrop,
      },
    );
    if (name !== "lyx-gateway") {
      check(`${name}：不发布端口`, publishedPorts(info).length === 0, publishedPorts(info));
    }
  }
  for (const name of ["lyx-api", "lyx-worker"]) {
    check(`${name}：带 init 进程`, inspect(name).HostConfig.Init === true);
  }
  const ports = publishedPorts(inspect("lyx-gateway"));
  if (flags.lan) {
    check(
      `gateway：--lan 时发布 ${config.port} 与对象存储的端口`,
      ports.length === 2 && ports.some((port) => port.endsWith(`:${config.port}->8080/tcp`)),
      ports,
    );
  } else {
    check(
      `gateway：只发布 ${config.port}，且只绑回环地址`,
      ports.join() === `127.0.0.1:${config.port}->8080/tcp`,
      ports,
    );
  }
}

await runMain(async () => {
  let flags;
  try {
    flags = parseArgs({
      options: {
        "image-only": { type: "boolean", default: false },
        "inspect-only": { type: "boolean", default: false },
        lan: { type: "boolean", default: false },
      },
    }).values;
  } catch {
    throw new UsageError(
      "用法：node infra/stack/smoke.mjs [--image-only | --inspect-only] [--lan]",
    );
  }
  if (flags["image-only"] && flags["inspect-only"]) {
    throw new UsageError("--image-only 与 --inspect-only 只能给一个");
  }
  const config = readConfig();
  assertDockerRunning();
  if (!flags["inspect-only"]) imageChecks(config.images.server);
  if (!flags["image-only"] && !flags["inspect-only"]) await gatewayChecks(config);
  if (!flags["image-only"]) constraintChecks(config, { lan: flags.lan });

  if (failures.length > 0) {
    throw new StepError(`\n冒烟不通过，共 ${failures.length} 条：\n- ${failures.join("\n- ")}`);
  }
  console.log("\n冒烟通过");
});
