#!/usr/bin/env node
// pnpm test:isolation：两个会话同时跑测试，都要绿，且两边用的库名与 Redis 前缀没有交集（W0-05b）。
// 计划 第 6.3 节退出条件 ⑧ 的两半都在这里：4 个 Vitest worker 并行；两个会话同时跑。
//
// 用法：node packages/services/src/testing/isolation.mjs [--scope all|connected] [--shard <i>/<n>] [--workers <n>]
//                                                          [--keep] [--dry-run] [--list]
//       node packages/services/src/testing/isolation.mjs --check <甲的用量记录> <乙的用量记录> [--expect <要有哪几项>]
//   不带参数   起两个子进程，各跑一遍全量测试（`pnpm test --maxWorkers=<n>`），会话标识不同（LYX_TEST_SESSION），
//              各记一份用量记录（LYX_TEST_USAGE_FILE：每建一个库、每发一个 Redis 前缀记一行）；
//              两边都退出 0 之后核对两份记录。
//   --scope    all（缺省）跑全量；connected 只跑连 PostgreSQL、Redis 的测试项目，CI 的那一步用它。
//              哪些项目算 connected 不在这里列：挂了 globalSetup 的项目都算（现在是 packages/db、packages/services）。
//              测试支架要求用它的项目挂 globalSetup（没挂时 useTestDatabase、useTestRedis 直接报错），
//              所以新的包挂上就自动进来，不用改这里，也不用改 CI。
//   --shard    只跑范围里的第 i 片（共 n 片）：两个会话各跑这一片。分法是 Vitest 自己的（原样传给它的 --shard：
//              用例文件的路径取哈希、排序后按个数等分），所以 n 片合起来就是不带 --shard 的那一遍，互不重叠。
//              全量在 2 核的执行机上超过 10 分钟，CI 把它分成几个任务各跑一片（.github/workflows/ci.yml）。
//              核对照旧，只有两项按片认，见下面“核对什么”。
//   --workers  每个会话几个 Vitest worker。缺省按本机的核数定：两个会话合起来不超过可用核数，
//              每个会话最多 4 个、至少 1 个（10 核的机器各 4 个，4 核各 2 个，2 核各 1 个）。
//              worker 开得比核数多，别的用例会被挤到超时：CI 的执行机只有 2 核，各开 4 个时就是这样红的。
//   --keep     跑完留着日志与用量记录。缺省：通过即删；没过才留着，并打印位置
//   --dry-run  只打印要跑什么（范围里的项目、每个会话的 worker 数；带 --shard 时另有这一片要核对哪几项），不跑测试
//   --list     不跑测试，打印范围里（带 --shard 时是这一片里）的用例文件，一行一个：项目、制表符、相对仓库根的路径
//   --check    不跑测试，只核对给出的两份用量记录（门禁自测的反例用）。--expect 给“要有哪几项”：
//              parallel、redis 用逗号连起来，或 none；不给即两项都要（不分片时的口径）
// 核对什么：两份记录都有库、有 Redis 前缀；各有一条“4 个 worker 同时在场、4 个互不相同的库”的记录
//（packages/db/src/testing/parallel.test.ts 嵌套跑一轮确定的 4 个 worker 写的，不随 --workers 变）；
// 两边的库名没有交集，Redis 前缀没有交集。范围缩到连库的用例都没跑到时，前两项就过不了。
// 分片时（--shard）：库名、Redis 前缀没有交集照旧，每一片都要有库；另两项各认一个文件——
//   “4 个 worker 同时在场”的记录：只要求含 packages/db/src/testing/parallel.test.ts 的那一片有；
//   Redis 前缀：只要求含 packages/services/src/testing/redis-isolation.test.ts 的那一片有（别的片有没有随它分到的用例）。
// 这一片里有哪些文件是问 Vitest 得来的（用它自己的分片器），跑完再对一遍：两个会话实际跑的文件数都等于这个数。
// 各片互不重叠、合起来是全部，所以这两个文件各恰好在一片里：合起来看，不分片时要有的三项一项不少。
// 要本地的 PostgreSQL 与 Redis 在运行，并给出 DATABASE_URL、REDIS_URL（CLAUDE.md 第 9 节）。
// 退出码：0 通过；1 有一边测试没过，或核对不过；2 用法错误。
// 本脚本只在 --scope connected、--shard、--list 时引 vitest/node（问 Vitest 各项目挂了什么、有哪些用例文件），
// 别的路径不引依赖。

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createWriteStream, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
/** “4 个 worker 同时在场”那条记录要的个数：嵌套的那一轮固定是 4 个 */
const PARALLEL_WORKERS = 4;
/** 每个会话的 worker 数上限（任务书验收第 2 条：各 4 个） */
const MAX_SESSION_WORKERS = 4;
const SCOPES = ["all", "connected"];
/** 分片时两项核对各认的文件（相对仓库根）：谁那一片里有它，谁就得有对应的记录 */
const PARALLEL_FILE = "packages/db/src/testing/parallel.test.ts";
const REDIS_FILE = "packages/services/src/testing/redis-isolation.test.ts";
const EXPECT_ALL = { parallel: true, redis: true };

const say = (line) => process.stdout.write(`${line}\n`);

class UsageError extends Error {}

/** 读一份用量记录：一行一个 JSON。返回 { databases, redis, parallel } */
function readUsage(file) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    throw new Error(`用量记录读不了：${file}`);
  }
  const usage = { databases: new Set(), redis: new Set(), parallel: [] };
  for (const [index, line] of text.split("\n").entries()) {
    if (line.trim() === "") continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      throw new Error(`用量记录第 ${index + 1} 行不是 JSON：${file}`);
    }
    if (record.kind === "database") usage.databases.add(String(record.value));
    else if (record.kind === "redis") usage.redis.add(String(record.value));
    else if (record.kind === "parallel" && Array.isArray(record.value)) {
      usage.parallel.push(record.value.map(String));
      for (const name of record.value) usage.databases.add(String(name));
    }
  }
  return usage;
}

/** 核对两份用量记录，返回问题清单（空 = 通过）。expect：Redis 前缀、“4 个 worker”的记录这两项要不要有 */
function checkUsage(a, b, expect = EXPECT_ALL) {
  const problems = [];
  for (const [label, usage] of [
    ["甲", a],
    ["乙", b],
  ]) {
    if (usage.databases.size === 0) problems.push(`${label}的用量记录里没有库：连库的用例没跑到`);
    if (expect.redis && usage.redis.size === 0) {
      problems.push(`${label}的用量记录里没有 Redis 前缀：连 Redis 的用例没跑到`);
    }
    for (const name of usage.databases) {
      if (!name.startsWith("lyx_test_")) problems.push(`${label}用了不带测试前缀的库：${name}`);
    }
    for (const prefix of usage.redis) {
      if (!prefix.startsWith("lyx:test:")) {
        problems.push(`${label}用了不带测试前缀的 Redis 键前缀：${prefix}`);
      }
    }
    const four = usage.parallel.some((names) => new Set(names).size >= PARALLEL_WORKERS);
    if (expect.parallel && !four) {
      problems.push(
        `${label}没有“${PARALLEL_WORKERS} 个 worker 同时在场、${PARALLEL_WORKERS} 个互不相同的库”的记录`,
      );
    }
  }
  const shared = (left, right) => [...left].filter((value) => right.has(value)).sort();
  const databases = shared(a.databases, b.databases);
  const redis = shared(a.redis, b.redis);
  if (databases.length > 0) problems.push(`库名有交集：${databases.join("、")}`);
  if (redis.length > 0) problems.push(`Redis 前缀有交集：${redis.join("、")}`);
  return problems;
}

function report(a, b, expect = EXPECT_ALL) {
  const problems = checkUsage(a, b, expect);
  say(`  甲：库 ${a.databases.size} 个，Redis 前缀 ${a.redis.size} 个`);
  say(`  乙：库 ${b.databases.size} 个，Redis 前缀 ${b.redis.size} 个`);
  if (problems.length === 0) {
    say("  库名交集 0 个，Redis 前缀交集 0 个");
    return true;
  }
  for (const problem of problems) console.error(`  不通过：${problem}`);
  return false;
}

/** 每个会话几个 worker：两个会话合起来不超过可用核数，每个会话最多 4 个、至少 1 个 */
function defaultWorkers(cores) {
  return Math.max(1, Math.min(MAX_SESSION_WORKERS, Math.floor(cores / 2)));
}

/**
 * 问 Vitest：范围里有哪些测试项目；wantFiles 时另问范围里（给了 shard 就是这一片里）有哪些用例文件。
 * 连 PostgreSQL、Redis 的测试项目：挂了 globalSetup 的都算。问的是 Vitest 自己解析出来的配置，
 * 不是去读各包 vitest.config.ts 的文本；只解析配置、列文件，不执行 globalSetup、不跑用例。
 * 分片用的是 Vitest 配置里的那个分片器（跑测试时 --shard 用的同一个），不在这里另写一遍算法。
 */
async function inspect(scope, shard, wantFiles) {
  const { createVitest } = await import("vitest/node");
  const vitest = await createVitest("test", {
    root: repoRoot,
    watch: false,
    ...(shard ? { shard: `${shard.index}/${shard.count}` } : {}),
  });
  try {
    const projects = vitest.projects
      .filter((project) => scope === "all" || project.config.globalSetup.length > 0)
      .map((project) => project.name)
      .sort();
    if (!wantFiles) return { projects, files: null };
    const names = new Set(projects);
    let specs = (await vitest.globTestSpecifications()).filter((spec) =>
      names.has(spec.project.name),
    );
    if (shard) specs = await new vitest.config.sequence.sequencer(vitest).shard(specs);
    const files = specs
      .map((spec) => ({ project: spec.project.name, file: relative(repoRoot, spec.moduleId) }))
      .sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
    return { projects, files };
  } finally {
    await vitest.close();
  }
}

function parseArgs(args) {
  const options = {
    scope: "all",
    shard: null,
    workers: undefined,
    keep: false,
    dryRun: false,
    list: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--keep") options.keep = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--list") options.list = true;
    else if (arg === "--shard") {
      const match = /^([1-9][0-9]?)\/([1-9][0-9]?)$/.exec(args[(index += 1)] ?? "");
      const shard = match ? { index: Number(match[1]), count: Number(match[2]) } : null;
      if (shard === null || shard.index > shard.count) {
        throw new UsageError("--shard 后面要跟 <第几片>/<共几片>，如 2/4");
      }
      options.shard = shard;
    } else if (arg === "--scope") {
      const scope = args[(index += 1)];
      if (!SCOPES.includes(scope)) {
        throw new UsageError(`--scope 后面要跟 ${SCOPES.join(" 或 ")}`);
      }
      options.scope = scope;
    } else if (arg === "--workers") {
      const workers = args[(index += 1)];
      if (!/^[1-9][0-9]?$/.test(workers ?? "")) {
        throw new UsageError("--workers 后面要跟 1–99 的整数");
      }
      options.workers = Number(workers);
    } else throw new UsageError(`不认识的参数 ${arg}`);
  }
  return options;
}

/** 跑一遍测试：输出进日志文件，返回退出码 */
function runSession(session, dir, vitestArgs) {
  const usageFile = join(dir, `usage-${session}.jsonl`);
  const logFile = join(dir, `test-${session}.log`);
  const log = createWriteStream(logFile);
  const child = spawn("pnpm", ["test", ...vitestArgs], {
    cwd: repoRoot,
    env: { ...process.env, LYX_TEST_SESSION: session, LYX_TEST_USAGE_FILE: usageFile },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  const done = new Promise((resolve) => {
    child.on("error", (error) => {
      log.write(`\npnpm 没跑起来：${error.message}\n`);
      resolve(-1);
    });
    child.on("close", (code) => resolve(code ?? -1));
  }).then((code) => new Promise((resolve) => log.end(() => resolve(code))));
  return { session, usageFile, logFile, done };
}

/** 日志汇总里“Test Files  …（N）”括号里的总数：这个会话实际跑了几个用例文件；读不出返回 null */
function ranFiles(file) {
  try {
    // 去掉颜色码（ESC 开头的一段）：不在正则里写控制字符
    const text = readFileSync(file, "utf8")
      .split(String.fromCharCode(27))
      .map((part, index) => (index === 0 ? part : part.replace(/^\[[0-9;]*m/, "")))
      .join("");
    const total = /^\s*Test Files\s.*\((\d+)\)\s*$/m.exec(text)?.[1];
    return total === undefined ? null : Number(total);
  } catch {
    return null;
  }
}

/** --expect 的值：parallel、redis 用逗号连起来，或 none */
function parseExpect(value) {
  const names = value === "none" ? [] : (value ?? "").split(",");
  if (value === undefined || names.some((name) => name !== "parallel" && name !== "redis")) {
    throw new UsageError("--expect 后面要跟 parallel、redis（逗号连起来）或 none");
  }
  return { parallel: names.includes("parallel"), redis: names.includes("redis") };
}

/** 日志的最后几行（测试的汇总在那里） */
function tail(file, lines) {
  try {
    return readFileSync(file, "utf8").trimEnd().split("\n").slice(-lines).join("\n");
  } catch {
    return "（日志读不了）";
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--check") {
    const withExpect = args.length === 5 && args[3] === "--expect";
    if (args.length !== 3 && !withExpect) {
      console.error(
        "test:isolation：--check 后面要跟两份用量记录的路径，另可带 --expect <要有哪几项>",
      );
      return 2;
    }
    const expect = withExpect ? parseExpect(args[4]) : EXPECT_ALL;
    say("test:isolation（只核对用量记录）");
    return report(readUsage(args[1]), readUsage(args[2]), expect) ? 0 : 1;
  }
  const options = parseArgs(args);

  const cores = availableParallelism();
  const workers = options.workers ?? defaultWorkers(cores);
  const vitestArgs = [`--maxWorkers=${workers}`];
  let what = "全量测试";
  let files = null;
  if (options.scope === "connected" || options.shard !== null || options.list) {
    const info = await inspect(
      options.scope,
      options.shard,
      options.shard !== null || options.list,
    );
    files = info.files;
    if (options.scope === "connected") {
      if (info.projects.length === 0) {
        console.error("test:isolation：没有哪个测试项目挂了 globalSetup，connected 的范围是空的");
        return 1;
      }
      for (const project of info.projects) vitestArgs.push("--project", project);
      what = `连库的测试项目（挂了 globalSetup 的：${info.projects.join("、")}）`;
    }
  }
  if (options.list) {
    for (const { project, file } of files) say(`${project}\t${file}`);
    return 0;
  }
  // 分片：这一片要有哪几项，看那两个文件在不在这一片里
  let expect = EXPECT_ALL;
  if (options.shard !== null) {
    const { index, count } = options.shard;
    if (files.length === 0) {
      console.error(`test:isolation：第 ${index}/${count} 片里没有用例文件（片数比文件还多）`);
      return 1;
    }
    vitestArgs.push(`--shard=${index}/${count}`);
    what += `的第 ${index} 片（共 ${count} 片；这一片 ${files.length} 个用例文件）`;
    expect = {
      parallel: files.some(({ file }) => file === PARALLEL_FILE),
      redis: files.some(({ file }) => file === REDIS_FILE),
    };
  }

  // 两个会话标识：同一个随机尾巴，各加一个字母。每次运行都不同，别的检出同时在跑也撞不上
  const stem = randomBytes(4).toString("hex");
  const sessions = [`i${stem}a`, `i${stem}b`];
  say(
    `test:isolation：两个会话（${sessions.join("、")}）同时跑${what}，各 ${workers} 个 worker（本机可用 ${cores} 核）`,
  );
  say(`  每个会话的命令：pnpm test ${vitestArgs.join(" ")}`);
  if (workers * 2 > cores && cores >= 2) {
    say(
      `  注意：两个会话合起来 ${workers * 2} 个 worker，比可用的 ${cores} 核多，别的用例可能被挤到超时`,
    );
  }
  if (options.shard !== null) {
    say(
      `  这一片的核对：库名与 Redis 前缀没有交集；两边都要有库${expect.parallel ? "、“4 个 worker 同时在场”的记录（parallel.test.ts 在这一片）" : ""}${expect.redis ? "、Redis 前缀（redis-isolation.test.ts 在这一片）" : ""}`,
    );
  }
  if (options.dryRun) return 0;

  const dir = mkdtempSync(join(tmpdir(), "lyx-test-isolation-"));
  const runs = sessions.map((session) => runSession(session, dir, vitestArgs));
  const codes = await Promise.all(runs.map((run) => run.done));

  let ok = true;
  for (const [index, run] of runs.entries()) {
    const code = codes[index];
    say(`  会话 ${run.session}：退出码 ${code}`);
    // 通过时只留汇总那几行；没过时把日志的末尾打出来
    say(
      tail(run.logFile, code === 0 ? 6 : 80)
        .split("\n")
        .map((line) => `    ${line}`)
        .join("\n"),
    );
    if (code !== 0) ok = false;
    // 分片：实际跑的文件数要等于问 Vitest 得来的这一片的文件数（上面“这一片要有哪几项”就是照那份名单定的）
    else if (options.shard !== null && ranFiles(run.logFile) !== files.length) {
      console.error(
        `  会话 ${run.session} 跑了 ${ranFiles(run.logFile) ?? "不知道几"} 个用例文件，这一片应当是 ${files.length} 个：分片对不上`,
      );
      ok = false;
    }
  }
  if (!ok) {
    console.error("test:isolation：有一边的测试没过，不再核对用量记录");
  } else {
    ok = report(readUsage(runs[0].usageFile), readUsage(runs[1].usageFile), expect);
  }
  // 通过即删；没过的留着看
  if (ok && !options.keep) rmSync(dir, { recursive: true, force: true });
  else say(`  日志与用量记录留在 ${dir}`);
  return ok ? 0 : 1;
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(`test:isolation：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = error instanceof UsageError ? 2 : 1;
}
