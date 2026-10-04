#!/usr/bin/env node
// 页面清单：由各端的页面登记生成 docs/plan/pages.md，一页一行，写里程碑、工作包与是否已实现
//（计划 第 5.7 节“页面”行、第 8.3 节；W0-28 任务书 第 7 节第 10 条）。
//
// 用法：node infra/ci/pages/generate.mjs [--check] [--out <文件>] [--root <仓库根>]
//   不带参数  重新生成 docs/plan/pages.md
//   --check   只比对，不写：登记表与入库的 pages.md 不一致即失败（CI 跑这个）
//   --out     写到别的文件（门禁自测与用例用）；与 --check 同用时拿那个文件来比
//   --root    换一个仓库根（门禁自测在副本里跑时用）
// 数据源：sources/ 下一个端一个文件，自动收集，按各自的 order 排先后。后来的端（小程序由 W0-27a 加）
// 只往 sources/ 里加自己的文件，不改本脚本，也不改别的端的文件。数据源的写法见 sources/admin.mjs 开头。
// 登记文件是 TypeScript：这里用 Node 自带的类型擦除直接 import（Node 24 默认开着），所以登记文件里只许
// import type，不能有要运行的 import，也不能用枚举这类擦不掉的写法。
// 退出码：0 成功或无差异；1 有差异或登记有问题；2 用法或环境错误。本脚本不引依赖。

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const OUTPUT = "docs/plan/pages.md";
const MILESTONES = ["M1", "M2", "M3", "M4", "M5", "M6", "M7"];

function fail(message) {
  console.error(`页面清单：${message}`);
  process.exit(2);
}

function parseArgs(argv) {
  const options = { check: false, out: null, root: resolve(here, "../../..") };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--check") options.check = true;
    else if (flag === "--out" || flag === "--root") {
      const value = argv[(index += 1)];
      if (value === undefined) fail(`${flag} 后面要跟一个值`);
      if (flag === "--out") options.out = resolve(value);
      else options.root = resolve(value);
    } else fail(`不认识的参数 ${flag}`);
  }
  return options;
}

/** 表格单元格：竖线与换行会把表格拆坏 */
const cell = (value) =>
  String(value ?? "")
    .replaceAll("|", "\\|")
    .replaceAll("\n", " ");

function table(columns, rows) {
  return [
    `| ${columns.join(" | ")} |`,
    `| ${columns.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(cell).join(" | ")} |`),
  ].join("\n");
}

/**
 * 一个端的统计。pages 的每一项至少有：milestone（M1–M7 或 V1.1）、implemented、entryHidden（可选）。
 * 应实现未实现页数是里程碑退出时要清零的那个数（计划 第 5.7 节的第四个计数）。
 */
function countPages(pages) {
  const v10 = pages.filter((page) => page.milestone !== "V1.1");
  const pending = Object.fromEntries(MILESTONES.map((milestone) => [milestone, 0]));
  for (const page of v10) {
    if (!MILESTONES.includes(page.milestone)) {
      throw new Error(
        `页面 ${page.key} 的里程碑 ${page.milestone} 不在 ${MILESTONES.join("、")}、V1.1 之内`,
      );
    }
    if (!page.implemented) pending[page.milestone] += 1;
  }
  return {
    total: pages.length,
    v10: v10.length,
    implemented: v10.filter((page) => page.implemented).length,
    v11: pages.length - v10.length,
    entryHidden: pages.filter((page) => page.entryHidden).length,
    pending,
  };
}

async function loadSources(root) {
  const dir = join(here, "sources");
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".mjs"))
    .sort();
  const sources = [];
  for (const file of files) {
    const module = await import(pathToFileURL(join(dir, file)).href);
    const source = module.default;
    if (!source || typeof source.load !== "function" || typeof source.title !== "string") {
      throw new Error(`数据源 sources/${file} 要默认导出 { key, order, title, load }`);
    }
    sources.push({ ...source, data: await source.load({ root }) });
  }
  return sources.sort((a, b) => a.order - b.order);
}

function render(sources) {
  const lines = [
    "# 页面清单",
    "",
    "<!-- 生成物，勿手改。重新生成：node infra/ci/pages/generate.mjs；CI 用 --check 核对无差异。 -->",
    "",
    "| 项 | 内容 |",
    "| --- | --- |",
    "| 用途 | 三个前端的逐页清单：一页一行，写里程碑、工作包与是否已实现。CI 由它统计“应实现未实现页面数”，每个里程碑退出时为 0（[计划](../08-development-plan.md) 第 5.7 节“页面”行、第 8.3 节） |",
    `| 来源 | ${sources.map((source) => `${source.title}：${source.data.origin}`).join("；")} |`,
    "| 怎么改 | 改登记文件，再跑 `node infra/ci/pages/generate.mjs`，与登记文件同一个 PR 提交。页面包合并时把自己那一页的“已实现”改成 true；改里程碑归属另在 `docs/plan/changes/` 记一条（计划 第 5.7 节） |",
    "| 还没有的 | 商家端小程序的部分由 W0-27a 加数据源（`infra/ci/pages/sources/`） |",
    "",
    "## 1. 汇总",
    "",
    table(
      ["端", "登记", "V1.0 应实现", "已实现", "未实现", "V1.1 只登记", "入口隐藏"],
      sources.map(({ title, data }) => {
        const counts = countPages(data.pages);
        return [
          title,
          counts.total,
          counts.v10,
          counts.implemented,
          counts.v10 - counts.implemented,
          counts.v11,
          counts.entryHidden,
        ];
      }),
    ),
    "",
    "应实现未实现页面数，按里程碑：",
    "",
    table(
      ["端", ...MILESTONES],
      sources.map(({ title, data }) => {
        const counts = countPages(data.pages);
        return [title, ...MILESTONES.map((milestone) => counts.pending[milestone])];
      }),
    ),
    "",
    "“入口隐藏”的页面照做、外壳不给入口（规范 第 14 节第 12 项），计入应实现，不算留桩。",
  ];
  sources.forEach((source, index) => {
    lines.push("", `## ${index + 2}. ${source.title}`, "", ...source.data.intro);
    source.data.sections.forEach((section, sectionIndex) => {
      lines.push(
        "",
        `### ${index + 2}.${sectionIndex + 1} ${section.title}`,
        "",
        ...(section.note ? [section.note, ""] : []),
        table(section.columns, section.rows),
      );
    });
  });
  return `${lines.join("\n")}\n`;
}

const options = parseArgs(process.argv.slice(2));
const target = options.out ?? join(options.root, OUTPUT);

let content;
try {
  content = render(await loadSources(options.root));
} catch (error) {
  console.error(`页面清单：登记有问题，生成不了。${error.message}`);
  process.exit(1);
}

if (options.check) {
  const current = existsSync(target) ? readFileSync(target, "utf8") : null;
  if (current === content) {
    console.log(`页面清单无差异：${OUTPUT} 与页面登记一致。`);
    process.exit(0);
  }
  console.error(
    current === null
      ? `页面清单：${OUTPUT} 不存在。`
      : `页面清单：${OUTPUT} 与页面登记不一致（手改了生成物，或改了登记没有重新生成）。`,
  );
  if (current !== null) {
    const [before, after] = [current.split("\n"), content.split("\n")];
    const line = before.findIndex((text, index) => text !== after[index]);
    const at = line < 0 ? Math.min(before.length, after.length) : line;
    console.error(`  第一处差异在第 ${at + 1} 行：`);
    console.error(`    入库的：${before[at] ?? "（没有这一行）"}`);
    console.error(`    应该是：${after[at] ?? "（没有这一行）"}`);
  }
  console.error("  重新生成：node infra/ci/pages/generate.mjs");
  process.exit(1);
}

writeFileSync(target, content);
console.log(`页面清单已生成：${options.out ?? OUTPUT}`);
