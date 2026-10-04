#!/usr/bin/env node
// 状态汇总：读 docs/plan/status/ 下各包的状态文件，生成 SUMMARY.md（docs/plan/status/README.md 第 5 节）。
//
// 用法：node infra/ci/status-summary.mjs [--dir <状态目录>] [--check]
//   不带参数  读 docs/plan/status/*.md（README.md、SUMMARY.md 除外），写 docs/plan/status/SUMMARY.md。
//             根脚本是 pnpm status:summary
//   --dir     换一个状态目录（用例与反例用）；汇总写到该目录下的 SUMMARY.md
//   --check   不写文件，只比对：现有的 SUMMARY.md 与重新生成的不一致即失败
// 口径：
//   1. 每个状态文件第一行是“# <编号> <名称>”，字段表的键照 README 第 2 节；编号与文件名一致。
//   2. “状态”只认 README 第 3 节的四个取值，别的即报错。
//   3. 依赖：先去掉全角括号里的说明，按“；”“、”拆开。是工作包编号的，要有对应的状态文件；
//      “M<n> 退出”指该里程碑的包全部完成；其余（Q、E 项与文字条件）脚本判不了，原样列出。
//   4. 可开工的包 = 状态是“未开工”，且依赖里的工作包（含“M<n> 退出”展开的）都写着“完成”。
//   5. 输出不带时间，同样的输入生成同样的文件。
// 退出码：0 通过；1 状态文件有问题，或 --check 发现不一致；2 用法或环境错误。
// 本脚本不引依赖。

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url)).replace(/\/$/, "");
const STATUSES = ["未开工", "进行中", "阻塞", "完成"];
const REQUIRED_KEYS = ["编号", "里程碑", "状态", "PR", "依赖", "评审级别", "规模", "阻塞原因"];
const PACKAGE_ID = /^(?:W\d+|X)-\d+[a-z]?$/;
const MILESTONE_EXIT = /^(M\d+) 退出$/;
const SKIPPED = ["README.md", "SUMMARY.md"];

function fail(message) {
  console.error(`状态汇总：${message}`);
  process.exit(2);
}

function parseArgs(argv) {
  const options = { dir: join(repoRoot, "docs/plan/status"), check: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--check") options.check = true;
    else if (flag === "--dir") {
      const value = argv[(index += 1)];
      if (value === undefined) fail("--dir 后面要跟目录");
      options.dir = isAbsolute(value) ? value : resolve(process.cwd(), value);
    } else fail(`不认识的参数 ${flag}`);
  }
  return options;
}

/** 表格的一行拆成单元格；不是表格行返回 null */
function cells(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return null;
  return trimmed
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.trim());
}

/** 编号的排序键：W0-05 < W0-05b < W0-06a；X 排在 W 后面 */
function idKey(id) {
  const match = id.match(/^([A-Z])(\d*)-(\d+)([a-z]?)$/);
  if (!match) return [id, 0, 0, ""];
  return [match[1], Number(match[2] || 0), Number(match[3]), match[4]];
}
function compareIds(a, b) {
  const [ka, kb] = [idKey(a), idKey(b)];
  for (let index = 0; index < ka.length; index += 1) {
    if (ka[index] < kb[index]) return -1;
    if (ka[index] > kb[index]) return 1;
  }
  return 0;
}

/** 里程碑的排序：M0、M1 … 在前，其余（技术验证泳道等）按名字排在后 */
function compareMilestones(a, b) {
  const [na, nb] = [a.match(/^M(\d+)$/), b.match(/^M(\d+)$/)];
  if (na && nb) return Number(na[1]) - Number(nb[1]);
  if (na || nb) return na ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

function parseDependencies(text) {
  const result = { packages: [], milestones: [], others: [] };
  if (text === "—" || text === "") return result;
  const segments = text.replace(/（[^（）]*）/g, "").split("；");
  for (const segment of segments) {
    const tokens = segment.split("、").map((token) => token.trim());
    if (tokens.every((token) => PACKAGE_ID.test(token))) {
      result.packages.push(...tokens);
      continue;
    }
    const exit = segment.trim().match(MILESTONE_EXIT);
    if (exit) result.milestones.push(exit[1]);
    else if (segment.trim() !== "") result.others.push(segment.trim());
  }
  return result;
}

const options = parseArgs(process.argv.slice(2));
if (!existsSync(options.dir)) fail(`状态目录 ${options.dir} 不存在`);
const shownDir = relative(process.cwd(), options.dir) || ".";

// ---------- 1. 读各包的状态文件 ----------

const problems = [];
const packages = [];
const files = readdirSync(options.dir)
  .filter((name) => name.endsWith(".md") && !SKIPPED.includes(name))
  .sort();
if (files.length === 0) fail(`${shownDir} 下没有状态文件`);

for (const file of files) {
  const lines = readFileSync(join(options.dir, file), "utf8").split("\n");
  const title = (lines[0] ?? "").match(/^# (\S+) (.+)$/);
  if (!title) {
    problems.push(`${file}：第一行要写成“# <编号> <名称>”`);
    continue;
  }
  const fields = {};
  for (const line of lines) {
    const row = cells(line);
    if (row && row.length === 2 && !(row[0] in fields)) fields[row[0]] = row[1];
  }
  const missing = REQUIRED_KEYS.filter((key) => fields[key] === undefined);
  if (missing.length > 0) {
    problems.push(`${file}：字段表缺 ${missing.join("、")}`);
    continue;
  }
  const id = title[1];
  if (fields["编号"] !== id || file !== `${id}.md`) {
    problems.push(`${file}：标题、“编号”一行与文件名里的编号不一致`);
  }
  if (!STATUSES.includes(fields["状态"])) {
    problems.push(
      `${file}：状态“${fields["状态"]}”不在取值范围内，只能是 ${STATUSES.join("、")}（docs/plan/status/README.md 第 3 节）`,
    );
  }
  packages.push({ id, name: title[2].trim(), fields, deps: parseDependencies(fields["依赖"]) });
}

const byId = new Map(packages.map((item) => [item.id, item]));
const milestones = [...new Set(packages.map((item) => item.fields["里程碑"]))].sort(
  compareMilestones,
);
const membersOf = (milestone) =>
  packages
    .filter((item) => item.fields["里程碑"] === milestone)
    .sort((a, b) => compareIds(a.id, b.id));

for (const item of packages) {
  for (const dep of item.deps.packages) {
    if (!byId.has(dep)) problems.push(`${item.id}.md：依赖里的 ${dep} 没有状态文件`);
  }
  for (const milestone of item.deps.milestones) {
    if (!milestones.includes(milestone)) {
      problems.push(`${item.id}.md：依赖里的“${milestone} 退出”对不上任何里程碑`);
    }
  }
}

if (problems.length > 0) {
  console.error(`状态汇总未通过：${problems.length} 处`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}

// ---------- 2. 可开工的包 ----------

const done = (id) => byId.get(id).fields["状态"] === "完成";
const ready = packages
  .filter((item) => item.fields["状态"] === "未开工")
  .filter((item) => item.deps.packages.every(done))
  .filter((item) => item.deps.milestones.every((m) => membersOf(m).every((p) => done(p.id))))
  .sort(
    (a, b) => compareMilestones(a.fields["里程碑"], b.fields["里程碑"]) || compareIds(a.id, b.id),
  );

// ---------- 3. 生成 ----------

const link = (item) => `[${item.id}](${item.id}.md)`;
const out = [];
out.push("# 进度汇总");
out.push("");
out.push(
  "<!-- 生成物：由 pnpm status:summary（infra/ci/status-summary.mjs）从本目录各包的状态文件生成。不手改；冲突时变基后重新生成。 -->",
);
out.push("");
out.push(
  "各包的状态以各自的文件为准；改了状态文件就重新跑 `pnpm status:summary`，CI 核对本文件与重新生成的结果无差异。写法见 [README.md](README.md)。",
);
out.push("");
out.push("## 1. 计数");
out.push("");
out.push(`| 里程碑 | 包数 | ${STATUSES.join(" | ")} |`);
out.push(`| --- | --- | ${STATUSES.map(() => "---").join(" | ")} |`);
const countRow = (label, items) =>
  `| ${label} | ${items.length} | ${STATUSES.map((s) => items.filter((item) => item.fields["状态"] === s).length).join(" | ")} |`;
for (const milestone of milestones) out.push(countRow(milestone, membersOf(milestone)));
out.push(countRow("合计", packages));
out.push("");
out.push("## 2. 可开工的包");
out.push("");
out.push(
  "判定：状态是“未开工”，且“依赖”里的工作包都已合并（main 上该包的状态文件写“完成”）。Q、E 项与文字条件脚本判不了，列在“另需核对”，开工前自己核对。同泳道按编号先后取。",
);
out.push("");
if (ready.length === 0) {
  out.push("现在没有可开工的包。");
} else {
  out.push("| 编号 | 名称 | 里程碑 | 级别 | 规模 | 另需核对 |");
  out.push("| --- | --- | --- | --- | --- | --- |");
  for (const item of ready) {
    const others = item.deps.others.join("；") || "—";
    out.push(
      `| ${link(item)} | ${item.name} | ${item.fields["里程碑"]} | ${item.fields["评审级别"]} | ${item.fields["规模"]} | ${others} |`,
    );
  }
}
out.push("");
out.push("## 3. 各包状态");
for (const milestone of milestones) {
  out.push("");
  out.push(`### ${milestone}`);
  out.push("");
  out.push("| 编号 | 名称 | 状态 | PR | 依赖 | 级别 | 规模 | 阻塞原因 |");
  out.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const item of membersOf(milestone)) {
    const f = item.fields;
    out.push(
      `| ${link(item)} | ${item.name} | ${f["状态"]} | ${f["PR"]} | ${f["依赖"]} | ${f["评审级别"]} | ${f["规模"]} | ${f["阻塞原因"]} |`,
    );
  }
}
const generated = `${out.join("\n")}\n`;

const target = join(options.dir, "SUMMARY.md");
const shownTarget = relative(process.cwd(), target) || "SUMMARY.md";

if (options.check) {
  const current = existsSync(target) ? readFileSync(target, "utf8") : null;
  if (current !== generated) {
    console.error(
      `状态汇总未通过：${shownTarget} 与状态文件不一致。重新跑 pnpm status:summary 并提交，不要手改。`,
    );
    process.exit(1);
  }
  console.log(`状态汇总核对通过：${shownTarget} 与 ${packages.length} 个状态文件一致。`);
} else {
  writeFileSync(target, generated);
  const readyIds = ready.map((item) => item.id).join("、") || "无";
  console.log(`状态汇总已生成：${shownTarget}，${packages.length} 个包；可开工：${readyIds}。`);
}
