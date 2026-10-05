#!/usr/bin/env node
// 台账三张汇总（W0-30）：留桩、计划变更、外部验证。读各目录下的单项文件，核对它们合不合规，各生成一份 SUMMARY.md
//（docs/plan/README.md 第 1 节）。汇总不入库，要看时现生成（同状态汇总）；CI 只核对单项文件。
//
// 用法：node infra/ci/plan-summaries.mjs [--check] [--root <目录>]
//   不带参数  写 docs/plan/stubs/SUMMARY.md、docs/plan/changes/SUMMARY.md、docs/plan/external-verification/SUMMARY.md
//             （三份都被 git 忽略）。根脚本是 pnpm plan:summaries
//   --check   只核对：单项文件能不能生成出汇总。有不合规的即失败，并指出是哪个文件的哪一项。不写文件
//             （CI 的“台账单项文件核对”一步）
//   --root    换一个仓库根（用例与反例用）：读、写都在它下面的 docs/plan/
// 口径（键与取值以 docs/plan/templates/ 的三份模板为准，读法在 plan-ledger-lib.mjs）：
//   1. 单项文件第一行是“# <标题>”，下面有“| 项 | 内容 |”键值表，模板里的键都在。README.md、SUMMARY.md 不算单项文件。
//   2. 留桩的“状态”只认 留桩中、已回补；“回补里程碑”以里程碑号开头（M4；M2，G2-A）。
//   3. 外部验证的“状态”只认 未开始、进行中、已关闭（通过）、已关闭（按退路）、不做。一个文件里可以有几张表（V5 分两节）。
//   4. 计划变更只查键在不在；类别、PR 是说明性的文字，原样列出。
//   5. 输出不带时间，同样的输入生成同样的文件。
// 退出码：0 通过；1 单项文件有问题（带不带 --check 都一样）；2 用法或环境错误。
// 本脚本不引依赖。

import { existsSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { LEDGERS, milestoneOf, readLedger } from "./plan-ledger-lib.mjs";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url)).replace(/\/$/, "");

function fail(message) {
  console.error(`台账汇总：${message}`);
  process.exit(2);
}

function parseArgs(argv) {
  const options = { check: false, root: repoRoot };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--check") options.check = true;
    else if (flag === "--root") {
      const value = argv[(index += 1)];
      if (value === undefined) fail("--root 后面要跟目录");
      options.root = isAbsolute(value) ? value : resolve(process.cwd(), value);
    } else fail(`不认识的参数 ${flag}`);
  }
  return options;
}

const HEAD = (title, command) => [
  `# ${title}`,
  "",
  `<!-- 生成物：由 ${command}（infra/ci/plan-summaries.mjs）从本目录的单项文件现生成。不入库，不手改；要看最新的就重新跑一遍。 -->`,
  "",
  "各项以各自的文件为准；本文件只是生成那一刻的快照，不入库，CI 也不比对它。写法见 [README.md](README.md)。",
  "",
];
/** 汇总表里的一格：竖线转义，空的写“—” */
const cell = (text) => (text === undefined || text === "" ? "—" : text.replaceAll("|", "\\|"));
const link = (record, text) => `[${cell(text)}](${record.file})`;
const countBy = (records, key) => {
  const counts = new Map();
  for (const record of records) {
    const value = key(record);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
};
const milestoneOrder = (a, b) => Number(a.slice(1)) - Number(b.slice(1));

function renderStubs(records) {
  const open = records.filter((record) => record.fields["状态"] === "留桩中");
  const milestones = [
    ...new Set(records.map((record) => milestoneOf(record.fields["回补里程碑"]))),
  ].sort(milestoneOrder);
  const out = HEAD("留桩汇总", "pnpm plan:summaries");
  out.push(
    `留桩数 ${open.length}（状态为“留桩中”的文件数）；已回补 ${records.length - open.length}。`,
  );
  out.push("", "## 1. 按回补里程碑", "", "| 回补里程碑 | 留桩中 | 已回补 |", "| --- | --- | --- |");
  for (const milestone of milestones) {
    const mine = records.filter((r) => milestoneOf(r.fields["回补里程碑"]) === milestone);
    const left = mine.filter((r) => r.fields["状态"] === "留桩中").length;
    out.push(`| ${milestone} | ${left} | ${mine.length - left} |`);
  }
  out.push("", "## 2. 各项", "");
  out.push("| 留桩 | 状态 | 回补里程碑 | 登记的工作包 | 回补的工作包 | 留桩内容 |");
  out.push("| --- | --- | --- | --- | --- | --- |");
  const sorted = [...records].sort(
    (a, b) =>
      milestoneOrder(milestoneOf(a.fields["回补里程碑"]), milestoneOf(b.fields["回补里程碑"])) ||
      (a.file < b.file ? -1 : 1),
  );
  for (const record of sorted) {
    const f = record.fields;
    out.push(
      `| ${link(record, record.title)} | ${cell(f["状态"])} | ${cell(f["回补里程碑"])} | ${cell(f["登记的工作包"])} | ${cell(f["回补的工作包"])} | ${cell(f["留桩内容"])} |`,
    );
  }
  return out;
}

function renderChanges(records) {
  const out = HEAD("计划变更汇总", "pnpm plan:summaries");
  out.push(`共 ${records.length} 条。`, "");
  out.push("| 变更 | 类别 | PR |", "| --- | --- | --- |");
  for (const record of records) {
    const f = record.fields;
    out.push(`| ${link(record, record.title)} | ${cell(f["类别"])} | ${cell(f["PR"])} |`);
  }
  return out;
}

function renderExternal(records, ledger) {
  const statuses = ledger.values["状态"];
  const counts = countBy(records, (record) => record.fields["状态"]);
  const out = HEAD("外部验证汇总", "pnpm plan:summaries");
  out.push(`共 ${records.length} 项。`, "");
  out.push(`| ${statuses.join(" | ")} |`, `| ${statuses.map(() => "---").join(" | ")} |`);
  out.push(`| ${statuses.map((status) => counts.get(status) ?? 0).join(" | ")} |`);
  out.push("", "| 编号 | 验证项 | 依赖的业主事项 | 谁来做 | 最晚关闭点 | 状态 | 结论 |");
  out.push("| --- | --- | --- | --- | --- | --- | --- |");
  // 先表一（V 编号，按数字），再其余（按编号的字面）
  const order = (record) => {
    const v = record.fields["编号"].match(/^V(\d+)/);
    return v ? [0, Number(v[1]), record.fields["编号"]] : [1, 0, record.fields["编号"]];
  };
  const sorted = [...records].sort((a, b) => {
    const [ka, kb] = [order(a), order(b)];
    return ka[0] - kb[0] || ka[1] - kb[1] || (ka[2] < kb[2] ? -1 : ka[2] > kb[2] ? 1 : 0);
  });
  for (const record of sorted) {
    const f = record.fields;
    out.push(
      `| ${link(record, f["编号"])} | ${cell(f["验证什么"])} | ${cell(f["依赖的业主事项"])} | ${cell(f["谁来做"])} | ${cell(f["最晚关闭点"])} | ${cell(f["状态"])} | ${cell(f["结论"])} |`,
    );
  }
  return out;
}

const RENDER = {
  stubs: renderStubs,
  changes: renderChanges,
  "external-verification": renderExternal,
};

const options = parseArgs(process.argv.slice(2));
const problems = [];
const outputs = [];
for (const [name, ledger] of Object.entries(LEDGERS)) {
  const dir = join(options.root, ledger.dir);
  if (!existsSync(dir)) fail(`目录 ${ledger.dir} 不存在`);
  const read = readLedger(dir, ledger);
  problems.push(...read.problems.map((problem) => `${ledger.dir}/${problem}`));
  if (read.problems.length === 0) {
    outputs.push({
      ledger,
      count: read.records.length,
      text: `${RENDER[name](read.records, ledger).join("\n")}\n`,
    });
  }
}

if (problems.length > 0) {
  console.error(`台账单项文件核对未通过：${problems.length} 处`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}

const tally = outputs.map((item) => `${item.ledger.title.replace("汇总", "")} ${item.count} 条`);
if (options.check) {
  console.log(`台账单项文件核对通过：${tally.join("、")}，都能生成出汇总（没有写文件）。`);
} else {
  for (const item of outputs)
    writeFileSync(join(options.root, item.ledger.dir, "SUMMARY.md"), item.text);
  console.log(
    `台账汇总已生成：${tally.join("、")}；各在 ${outputs.map((item) => `${item.ledger.dir}/SUMMARY.md`).join("、")}。`,
  );
}
