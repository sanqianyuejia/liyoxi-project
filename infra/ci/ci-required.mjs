#!/usr/bin/env node
// 汇总任务 required 用的脚本：判定全部必过任务的结论，并统计它们的耗时
//（计划 第 5.5 节：PR 必过检查合计 ≤15 分钟；W0-03 任务书 第 11 节第 6、9 项）。
//
// 用法：node infra/ci/ci-required.mjs --needs <needs 的 JSON> [--jobs <jobs.json>]
//         [--may-skip <逗号分隔的任务名>] [--out <ci-duration.json>] [--budget-seconds <秒>]
//   --needs     工作流里 toJSON(needs) 的值：{ "<任务>": { "result": "success" | "failure" | "cancelled" | "skipped" } }
//               必过任务的名单就是它的键，也就是 required 任务的 needs 列表
//   --jobs      GitHub 接口 actions/runs/<运行>/attempts/<次数>/jobs 的返回，用来取各任务的起止时间；
//               不给或读不了时只判结论，耗时记为未知
//   --may-skip  允许是 skipped 的任务（只在 PR 上跑的任务，推到 main 时会被跳过）
//   --out       把统计另存成 JSON（CI 把它传成产物 ci-duration.json）
//   --budget-seconds  时长预算，缺省 900
// 判定：每个必过任务的结论都是 success（--may-skip 里的可以是 skipped），否则失败。
// 时长：必过任务是并行跑的，所以给两个数。
//   跨度 = 从最早开始到最晚结束，也就是一个 PR 从开始跑到能看结论要等多久。预算比的是它。
//   合计 = 各必过任务耗时之和，也就是占用的执行机时间。只列出，不拿它比预算（任务拆得越细它越大，等的时间却越短）。
// 超过预算只在摘要里标出，不失败。跨度取不到（没拿到任务列表）时不判超不超。
// 摘要写到标准输出；有环境变量 GITHUB_STEP_SUMMARY 时同时追加到它指的文件。
// 退出码：0 全部通过；1 有必过任务没通过；2 用法错误。
// 本脚本不引依赖。

import { appendFileSync, readFileSync, writeFileSync } from "node:fs";

function fail(message) {
  console.error(`required 汇总：${message}`);
  process.exit(2);
}

function parseArgs(argv) {
  const options = { needs: null, jobs: null, maySkip: [], out: null, budgetSeconds: 900 };
  const names = {
    "--needs": "needs",
    "--jobs": "jobs",
    "--may-skip": "maySkip",
    "--out": "out",
    "--budget-seconds": "budgetSeconds",
  };
  for (let index = 0; index < argv.length; index += 2) {
    const name = names[argv[index]];
    const value = argv[index + 1];
    if (!name) fail(`不认识的参数 ${argv[index]}`);
    if (value === undefined) fail(`${argv[index]} 后面要跟一个值`);
    if (name === "maySkip") options.maySkip = value.split(",").filter(Boolean);
    else if (name === "budgetSeconds") options.budgetSeconds = Number(value);
    else options[name] = value;
  }
  if (options.needs === null) fail("缺 --needs");
  if (!Number.isFinite(options.budgetSeconds) || options.budgetSeconds <= 0) {
    fail("--budget-seconds 要是正数");
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));

let needs;
try {
  needs = JSON.parse(options.needs);
} catch (error) {
  fail(`--needs 不是合法的 JSON。${error.message}`);
}
const required = Object.keys(needs ?? {});
if (required.length === 0) fail("--needs 是空的：required 任务的 needs 列表里至少要有一个任务");

/** 接口返回里属于某个任务的记录：名字相同，或是它的矩阵展开（“任务 (…)”） */
let apiJobs = null;
if (options.jobs !== null) {
  try {
    const parsed = JSON.parse(readFileSync(options.jobs, "utf8"));
    if (Array.isArray(parsed.jobs)) apiJobs = parsed.jobs;
  } catch {
    apiJobs = null;
  }
}
const recordsOf = (name) =>
  (apiJobs ?? []).filter((job) => job.name === name || job.name.startsWith(`${name} (`));

const rows = required.map((name) => {
  const result = needs[name]?.result ?? "unknown";
  const ok = result === "success" || (result === "skipped" && options.maySkip.includes(name));
  const spans = recordsOf(name)
    .filter((job) => job.started_at && job.completed_at)
    .map((job) => ({ start: Date.parse(job.started_at), end: Date.parse(job.completed_at) }))
    .filter((span) => Number.isFinite(span.start) && Number.isFinite(span.end));
  const seconds =
    spans.length === 0
      ? null
      : Math.round(spans.reduce((sum, span) => sum + (span.end - span.start), 0) / 1000);
  return { name, result, ok, seconds, spans };
});

const known = rows.filter((row) => row.seconds !== null);
const totalSeconds = known.reduce((sum, row) => sum + row.seconds, 0);
const allSpans = rows.flatMap((row) => row.spans);
const wallSeconds =
  allSpans.length === 0
    ? null
    : Math.round(
        (Math.max(...allSpans.map((s) => s.end)) - Math.min(...allSpans.map((s) => s.start))) /
          1000,
      );
const overBudget = wallSeconds !== null && wallSeconds > options.budgetSeconds;
const failed = rows.filter((row) => !row.ok);

const clock = (seconds) =>
  seconds === null
    ? "未知"
    : `${Math.floor(seconds / 60)} 分 ${String(seconds % 60).padStart(2, "0")} 秒`;
const lines = [
  "### required：必过任务的结论与耗时",
  "",
  "| 任务 | 结论 | 耗时 |",
  "| --- | --- | --- |",
  ...rows.map(
    (row) => `| ${row.name} | ${row.result}${row.ok ? "" : "（未通过）"} | ${clock(row.seconds)} |`,
  ),
  `| 合计 | ${failed.length === 0 ? "全部通过" : `${failed.length} 个未通过`} | ${known.length === 0 ? "未知" : clock(totalSeconds)} |`,
  "",
  `预算 ${clock(options.budgetSeconds)}（计划 第 5.5 节），比的是跨度：从最早开始到最晚结束 ${clock(wallSeconds)}。任务并行跑，“合计”是各任务耗时之和（占用的执行机时间），不拿它比预算。本任务（required）自己的耗时不计入。`,
];
if (known.length < rows.length) {
  lines.push("", "有任务没取到起止时间（被跳过，或没拿到任务列表），合计只含取到的部分。");
}
if (overBudget) {
  lines.push(
    "",
    `**超出预算**：跨度 ${clock(wallSeconds)} > ${clock(options.budgetSeconds)}。不阻断本 PR；按受影响的包运行，或把检查挪到“合并后”一栏（计划 第 5.5 节）。`,
  );
}
const summary = `${lines.join("\n")}\n`;

console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
if (options.out !== null) {
  const report = {
    budgetSeconds: options.budgetSeconds,
    totalSeconds: known.length === 0 ? null : totalSeconds,
    wallSeconds,
    overBudget,
    jobs: rows.map(({ name, result, seconds }) => ({ name, result, seconds })),
  };
  writeFileSync(options.out, `${JSON.stringify(report, null, 2)}\n`);
}

if (failed.length > 0) {
  console.error(
    `required 未通过：${failed.map((row) => `${row.name}（${row.result}）`).join("、")}。`,
  );
  process.exit(1);
}
console.log("required 通过：必过任务全部成功。");
