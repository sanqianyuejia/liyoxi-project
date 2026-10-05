#!/usr/bin/env node
// 四个计数的报表（W0-30；计划 第 5.7 节“实现进度”“页面”行、第 10.2 节“四个计数与归属”行、第 13 节）。
// 四个计数：已落地接口数、待落地数、留桩数、未实现页面数；另出 x01 归属的未落地清单。
// 里程碑退出时四样都要清零：归本里程碑的接口待落地数、应在本里程碑回补的留桩、应在本里程碑实现的页面未实现数为 0，
// 应在本里程碑落地的 x01 条目都有处理器与测试。
//
// 用法（在仓库根目录）：
//   node infra/ci/four-counts.mjs                      打印报表。根脚本是 pnpm counts:report
//   node infra/ci/four-counts.mjs --require M0,M1      这几个里程碑有一样没清零即非 0 退出，并列出没清零的条目
//   --detail            x01 的未落地清单逐条列出（缺省只列 --require 的里程碑的）
//   --out <文件>        报表另存一份（Markdown）
// 各数从哪来（括号里是缺省路径；用例与反例用这几个参数换）：
//   接口    跑 infra/ci/landed.mjs --report，取它的合计一句与按里程碑的表：判定口径只在那一处。
//           --mounted、--stubs 原样传给它（已挂载清单 apps/api/dist/mounted-operations.json 由 apps/api 的用例写出，
//           不入库：没有它时探活 3 条按待落地算，报表里会注明）
//   留桩    --stubs <目录>（docs/plan/stubs）：状态为“留桩中”的文件数；按“回补里程碑”分列
//   页面    --pages <文件>（docs/plan/pages.md，生成物）：取“汇总”一节的两张表
//   x01     --x01 <文件>（docs/plan/x01-map.md，生成物）：取“条目”一节，一项一行
// x01 条目“有处理器与测试”的口径（按名字在源码里出现与否判，同已落地判定认测试的办法；判不了处理器写得对不对）：
//   名字    订阅者、定时器、周期任务、回调取名称里第一个反引号括起的；循环、队列、命令行取最后一个（括号里的代码名）
//   有处理器 名字以字符串字面量出现在 packages/services/src、apps/worker/src、apps/api/src 的非测试源码里
//           （*.test.ts、testing/、__fixtures__/ 不算）。循环与队列只看 apps/worker/src：它们在任务进程里装配，
//           代码名又多是 notify、docs 这样的常见词，放宽到服务层会误判
//   有测试   名字按整词出现在 packages/services/src、apps/worker、apps/api 的 *.test.ts 里
//   限度     常见词做代码名的条目“有测试”一项判得松；里程碑退出时循环与队列另对一遍 x01 第 4.3、4.4 节
// 退出码：0 正常（没带 --require，或要求的里程碑都清零）；1 有里程碑没清零；2 用法或环境错误（含读不了输入）。
// 本脚本不引依赖。

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { cells, LEDGERS, milestoneOf, readLedger } from "./plan-ledger-lib.mjs";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url)).replace(/\/$/, "");
const DEFAULTS = {
  mounted: "apps/api/dist/mounted-operations.json",
  stubs: "docs/plan/stubs",
  pages: "docs/plan/pages.md",
  x01: "docs/plan/x01-map.md",
};
const HANDLER_ROOTS = ["packages/services/src", "apps/worker/src", "apps/api/src"];
/** 循环与队列的处理器只在任务进程里找 */
const WORKER_ONLY = ["循环", "队列"];
const WORKER_ROOT = "apps/worker/src";
const TEST_ROOTS = ["packages/services/src", "apps/worker", "apps/api"];
/** 名字取括号里的代码名的三类 */
const CODE_NAMED = ["循环", "队列", "命令行"];

class UsageError extends Error {}

function parseArgs(argv) {
  const options = { ...DEFAULTS, require: [], detail: false, out: null };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--detail") {
      options.detail = true;
      continue;
    }
    const name = flag.startsWith("--") ? flag.slice(2) : "";
    if (!(name in DEFAULTS) && name !== "require" && name !== "out") {
      throw new UsageError(`不认识的参数 ${flag}`);
    }
    const value = argv[index + 1];
    if (value === undefined) throw new UsageError(`${flag} 后面要跟一个值`);
    options[name] = name === "require" ? value.split(",").filter(Boolean) : value;
    index += 1;
  }
  const bad = options.require.find((milestone) => !/^M\d+$/.test(milestone));
  if (bad !== undefined) throw new UsageError(`--require 只收里程碑号（M0、M1……），收到 ${bad}`);
  return options;
}

const at = (path) => (isAbsolute(path) ? path : resolve(repoRoot, path));
const read = (path, what) => {
  try {
    return readFileSync(at(path), "utf8");
  } catch {
    throw new UsageError(`读不了${what} ${path}`);
  }
};
const byMilestone = (a, b) => Number(a.slice(1)) - Number(b.slice(1));

// ---------- 接口：已落地数、待落地数 ----------

function routeCounts(options) {
  const run = spawnSync(
    process.execPath,
    [
      join(repoRoot, "infra/ci/landed.mjs"),
      "--report",
      "--mounted",
      at(options.mounted),
      "--stubs",
      at(options.stubs),
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );
  if (run.status !== 0) {
    throw new UsageError(`待落地清单没出来（infra/ci/landed.mjs --report）：${run.stderr.trim()}`);
  }
  const head = run.stdout.match(/V1\.0 接口 (\d+) 条：已落地 (\d+)，待落地 (\d+)；基线 ([^。]+)。/);
  if (head === null) throw new UsageError("认不出 landed.mjs 的合计一句：它的输出格式变了");
  const perMilestone = new Map();
  for (const line of run.stdout.split("\n")) {
    if (line.startsWith("## ")) break;
    const row = cells(line);
    if (row !== null && row.length === 4 && /^M\d+$/.test(row[0])) {
      perMilestone.set(row[0], {
        due: Number(row[1]),
        landed: Number(row[2]),
        pending: Number(row[3]),
      });
    }
  }
  if (perMilestone.size === 0)
    throw new UsageError("认不出 landed.mjs 按里程碑的表：它的输出格式变了");
  return {
    total: Number(head[1]),
    landed: Number(head[2]),
    pending: Number(head[3]),
    baseline: head[4],
    perMilestone,
    mountedMissing: !existsSync(at(options.mounted)),
  };
}

// ---------- 留桩 ----------

function stubCounts(options) {
  if (!existsSync(at(options.stubs))) throw new UsageError(`留桩目录 ${options.stubs} 不存在`);
  const { records, problems } = readLedger(at(options.stubs), LEDGERS.stubs);
  if (problems.length > 0) {
    throw new UsageError(
      `留桩文件不合规（node infra/ci/plan-summaries.mjs --check 会逐条指出）：${problems[0]}`,
    );
  }
  const open = records.filter((record) => record.fields["状态"] === "留桩中");
  const perMilestone = new Map();
  for (const record of open) {
    const milestone = milestoneOf(record.fields["回补里程碑"]);
    perMilestone.set(milestone, [...(perMilestone.get(milestone) ?? []), record]);
  }
  return { open: open.length, closed: records.length - open.length, perMilestone };
}

// ---------- 页面 ----------

function pageCounts(options) {
  const lines = read(options.pages, "页面清单").split("\n");
  let total;
  let milestones;
  const perMilestone = new Map();
  for (const line of lines) {
    if (line.startsWith("## 2")) break;
    const row = cells(line);
    if (row === null) continue;
    if (row[0] === "端") {
      // 两张表各一个表头：第一张有“未实现”一列，第二张的列是里程碑号
      total = row.includes("未实现") ? { column: row.indexOf("未实现"), sum: 0 } : total;
      milestones = row.slice(1).every((name) => /^M\d+$/.test(name)) ? row.slice(1) : undefined;
      continue;
    }
    if (/^:?-+:?$/.test(row[0])) continue;
    if (milestones !== undefined) {
      milestones.forEach((milestone, index) => {
        perMilestone.set(milestone, (perMilestone.get(milestone) ?? 0) + Number(row[index + 1]));
      });
    } else if (total !== undefined) {
      total.sum += Number(row[total.column]);
    }
  }
  if (total === undefined || perMilestone.size === 0 || Number.isNaN(total.sum)) {
    throw new UsageError(`认不出页面清单 ${options.pages} “汇总”一节的两张表：它的格式变了`);
  }
  return { pending: total.sum, perMilestone };
}

// ---------- x01 ----------

/** 目录下的 .ts 文件（不进 node_modules、dist 与点开头的目录） */
function sources(dir) {
  if (!existsSync(dir)) return [];
  const found = [];
  for (const name of readdirSync(dir).sort()) {
    if (name === "node_modules" || name === "dist" || name.startsWith(".")) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) found.push(...sources(path));
    else if (name.endsWith(".ts")) found.push(path);
  }
  return found;
}
const isTest = (path) => path.endsWith(".test.ts");
const isTestSupport = (path) => /\/(testing|__fixtures__|test)\//.test(path);
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function x01Items(options) {
  const lines = read(options.x01, "x01 归属表").split("\n");
  const start = lines.findIndex((line) => /^## .*条目$/.test(line.trim()));
  if (start < 0) throw new UsageError(`x01 归属表 ${options.x01} 里没有“条目”一节`);
  const items = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("## ")) break;
    const row = cells(line);
    if (row === null || row.length !== 4 || !/^M\d+$/.test(row[3])) continue;
    const quoted = [...row[1].matchAll(/`([^`]+)`/g)].map((match) => match[1]);
    if (quoted.length === 0)
      throw new UsageError(`x01 归属表里这一行没有反引号括起的名字：${line}`);
    const name = CODE_NAMED.includes(row[0]) ? quoted.at(-1) : quoted[0];
    items.push({ category: row[0], label: row[1], name, module: row[2], milestone: row[3] });
  }
  if (items.length === 0)
    throw new UsageError(`x01 归属表 ${options.x01} 的“条目”一节没有读到条目`);

  const handlerTextOf = (roots) =>
    roots
      .flatMap((root) => sources(at(root)))
      .filter((path) => !isTest(path) && !isTestSupport(path))
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");
  const handlerText = handlerTextOf(HANDLER_ROOTS);
  const workerText = handlerTextOf([WORKER_ROOT]);
  const testText = TEST_ROOTS.flatMap((root) => sources(at(root)))
    .filter(isTest)
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");
  for (const item of items) {
    const word = escape(item.name);
    item.missing = [
      ...(new RegExp(`["'\`]${word}["'\`]`).test(
        WORKER_ONLY.includes(item.category) ? workerText : handlerText,
      )
        ? []
        : ["处理器"]),
      ...(new RegExp(`(?<![\\w.])${word}(?![\\w.])`).test(testText) ? [] : ["测试"]),
    ];
  }
  return items;
}

// ---------- 报表 ----------

function main(argv) {
  const options = parseArgs(argv);
  const routes = routeCounts(options);
  const stubs = stubCounts(options);
  const pages = pageCounts(options);
  const x01 = x01Items(options);

  const milestones = [
    ...new Set([
      ...routes.perMilestone.keys(),
      ...stubs.perMilestone.keys(),
      ...pages.perMilestone.keys(),
      ...x01.map((item) => item.milestone),
    ]),
  ].sort(byMilestone);
  const rows = milestones.map((milestone) => {
    const mine = x01.filter((item) => item.milestone === milestone);
    return {
      milestone,
      routes: routes.perMilestone.get(milestone)?.pending ?? 0,
      stubs: stubs.perMilestone.get(milestone) ?? [],
      pages: pages.perMilestone.get(milestone) ?? 0,
      x01: mine,
      x01Pending: mine.filter((item) => item.missing.length > 0),
    };
  });

  const out = [
    "# 四个计数",
    "",
    "| 计数 | 现在 |",
    "| --- | --- |",
    `| 已落地接口数 | ${routes.landed}（V1.0 共 ${routes.total} 条） |`,
    `| 待落地数 | ${routes.pending}（基线 ${routes.baseline}） |`,
    `| 留桩数 | ${stubs.open}（已回补 ${stubs.closed}） |`,
    `| 未实现页面数 | ${pages.pending} |`,
    "",
  ];
  if (routes.mountedMissing) {
    out.push(
      `注：已挂载清单 ${options.mounted} 还没生成（它不入库，由 apps/api 的用例写出：pnpm exec vitest run --project api），接口一律按“没有处理器”算。`,
      "",
    );
  }
  out.push(
    "各里程碑退出时要清零的四样（没清零的数）：",
    "",
    "| 里程碑 | 接口待落地 | 应回补的留桩 | 未实现页面 | x01 条目未落地 |",
    "| --- | --- | --- | --- | --- |",
    ...rows.map(
      (row) =>
        `| ${row.milestone} | ${row.routes} | ${row.stubs.length} | ${row.pages} | ${row.x01Pending.length}（共 ${row.x01.length} 项） |`,
    ),
    "",
  );
  const listed = rows.filter(
    (row) =>
      (options.detail || options.require.includes(row.milestone)) && row.x01Pending.length > 0,
  );
  if (listed.length > 0) {
    out.push(
      "x01 归属的未落地清单：",
      "",
      "| 里程碑 | 类别 | 名称 | 所属模块 | 还缺 |",
      "| --- | --- | --- | --- | --- |",
    );
    for (const row of listed) {
      for (const item of row.x01Pending) {
        out.push(
          `| ${row.milestone} | ${item.category} | ${item.label} | ${item.module} | ${item.missing.join("、")} |`,
        );
      }
    }
    out.push("");
  } else if (!options.detail) {
    out.push(
      "x01 的未落地清单逐条看：加 --detail；接口的待落地清单：node infra/ci/landed.mjs --report。",
      "",
    );
  }
  const report = `${out.join("\n")}`;
  process.stdout.write(report);
  if (options.out !== null) {
    mkdirSync(dirname(at(options.out)), { recursive: true });
    writeFileSync(at(options.out), report);
  }

  const failures = [];
  for (const milestone of options.require) {
    const row = rows.find((one) => one.milestone === milestone);
    if (row === undefined) continue;
    if (row.routes > 0) failures.push(`${milestone}：还有 ${row.routes} 条接口待落地`);
    if (row.stubs.length > 0) {
      failures.push(
        `${milestone}：应在本里程碑回补的留桩还有 ${row.stubs.length} 项：${row.stubs.map((stub) => stub.file).join("、")}`,
      );
    }
    if (row.pages > 0)
      failures.push(`${milestone}：应在本里程碑实现的页面还有 ${row.pages} 页未实现`);
    if (row.x01Pending.length > 0) {
      failures.push(
        `${milestone}：x01 条目还有 ${row.x01Pending.length} 项没有处理器或测试：${row.x01Pending
          .map((item) => `${item.name}（缺${item.missing.join("、")}）`)
          .join("；")}`,
      );
    }
  }
  if (failures.length > 0) {
    console.error(`里程碑没有清零：\n- ${failures.join("\n- ")}`);
    return 1;
  }
  if (options.require.length > 0) console.log(`${options.require.join("、")} 的四样都已清零。`);
  return 0;
}

try {
  process.exit(main(process.argv.slice(2)));
} catch (error) {
  if (!(error instanceof UsageError)) throw error;
  console.error(
    `四个计数：${error.message}。用法：node infra/ci/four-counts.mjs [--require <里程碑,…>] [--detail] [--out <文件>]`,
  );
  process.exit(2);
}
