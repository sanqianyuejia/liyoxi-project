// 台账单项文件的读法（W0-30）：留桩、计划变更、外部验证三个目录共用。自己不是命令，由
// plan-summaries.mjs（三张汇总）与 four-counts.mjs（四个计数）引。
// 单项文件的形状以 docs/plan/templates/ 下的三份模板为准：第一行“# 标题”，下面是“| 项 | 内容 |”两列的键值表。
// 一个文件里可以有几张这样的表（外部验证的 V5 分两节）：每张各读成一条记录。
// 本文件不引依赖。

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** 三个台账：目录、汇总的标题、必有的键、取值受限的键、记录靠哪个键认（没有这个键的表不算记录） */
export const LEDGERS = {
  stubs: {
    dir: "docs/plan/stubs",
    title: "留桩汇总",
    keys: [
      "状态",
      "留桩内容",
      "骨架里的做法",
      "登记的工作包",
      "回补里程碑",
      "回补的工作包",
      "依据",
    ],
    marker: "状态",
    values: { 状态: ["留桩中", "已回补"] },
  },
  changes: {
    dir: "docs/plan/changes",
    title: "计划变更汇总",
    keys: ["改了什么", "原因", "影响的包", "类别", "PR"],
    marker: "改了什么",
    values: {},
  },
  "external-verification": {
    dir: "docs/plan/external-verification",
    title: "外部验证汇总",
    keys: [
      "编号",
      "来源",
      "验证什么",
      "通过标准",
      "依赖的业主事项",
      "谁来做",
      "最晚关闭点",
      "不通过的退路",
      "状态",
      "结论",
      "证据",
      "关闭日期",
    ],
    marker: "编号",
    values: { 状态: ["未开始", "进行中", "已关闭（通过）", "已关闭（按退路）", "不做"] },
  },
};

/** 不算单项文件的：目录说明与现生成的汇总 */
export const SKIPPED = ["README.md", "SUMMARY.md"];

/** 表格的一行拆成单元格（转义的竖线 \| 不当分隔）；不是表格行返回 null */
export function cells(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return null;
  return trimmed
    .slice(1, -1)
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim());
}

/** 一份文件里的键值表：每遇到表头“| 项 | 内容 |”起一张新的。返回 [{ 键: 值 }] */
export function keyValueTables(text) {
  const tables = [];
  let current = null;
  for (const line of text.split("\n")) {
    const row = cells(line);
    if (row === null || row.length < 2) {
      current = null;
      continue;
    }
    if (row.length === 2 && row[0] === "项" && row[1] === "内容") {
      current = {};
      tables.push(current);
    } else if (current !== null && !/^:?-+:?$/.test(row[0]) && !(row[0] in current)) {
      // 内容里自己带竖线的（没转义）：第一格是键，其余并回去
      current[row[0]] = row.slice(1).join(" | ");
    }
  }
  return tables;
}

/** 回补里程碑一栏开头的里程碑号（“M2，G2-A”取 M2）；认不出返回 null */
export const milestoneOf = (text) => text.match(/^M\d+/)?.[0] ?? null;

/**
 * 读一个台账目录。返回 { records, problems }：
 *   records  [{ file, title, fields }]，按文件名排序，一个文件几张表就有几条
 *   problems 不合规之处，一条一句，写明哪个文件的哪一项
 */
export function readLedger(dir, ledger) {
  const records = [];
  const problems = [];
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".md") && !SKIPPED.includes(name))
    .sort();
  for (const file of files) {
    const text = readFileSync(join(dir, file), "utf8");
    const title = text
      .split("\n", 1)[0]
      .match(/^# (.+)$/)?.[1]
      .trim();
    if (title === undefined) {
      problems.push(`${file}：第一行要写成“# <标题>”`);
      continue;
    }
    const tables = keyValueTables(text).filter((table) => ledger.marker in table);
    if (tables.length === 0) {
      problems.push(`${file}：没有找到带“${ledger.marker}”一行的“| 项 | 内容 |”表`);
      continue;
    }
    for (const fields of tables) {
      const missing = ledger.keys.filter((key) => fields[key] === undefined);
      if (missing.length > 0) problems.push(`${file}：表里缺 ${missing.join("、")}`);
      for (const [key, allowed] of Object.entries(ledger.values)) {
        if (fields[key] !== undefined && !allowed.includes(fields[key])) {
          problems.push(
            `${file}：${key}“${fields[key]}”不在取值范围内，只能是 ${allowed.join("、")}`,
          );
        }
      }
      if ("回补里程碑" in fields && milestoneOf(fields["回补里程碑"]) === null) {
        problems.push(`${file}：回补里程碑“${fields["回补里程碑"]}”要以里程碑号开头，如 M4`);
      }
      records.push({ file, title, fields });
    }
  }
  return { records, problems };
}
