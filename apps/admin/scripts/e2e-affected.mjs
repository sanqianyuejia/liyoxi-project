#!/usr/bin/env node
// 后台冒烟要不要跑：按受影响范围（计划 第 5.5 节“改动 apps/admin 的 PR 另跑后台 Playwright 冒烟”）。
//
// 用法：node apps/admin/scripts/e2e-affected.mjs --base <git 引用>      在仓库根目录跑
//   --base 给了（PR）：看 <base> 与 HEAD 的共同祖先之后改了哪些文件，改到下面“受影响范围”里的才跑。
//   --base 为空（推到 main、手动）：一律跑。
// 受影响范围：后台自己（apps/admin/）；它依赖的两个工作区包（packages/shared/、packages/contract/）；
// 它的 tsconfig 预设所在的 packages/config/；设计变量的来源 design/tokens.json（改了它要重新生成
// packages/shared 下的生成物才生效，这里一并算上，免得只改来源的 PR 漏跑）；
// 会改变装了什么或怎么跑的几个文件（pnpm-lock.yaml、根 package.json、pnpm-workspace.yaml、.npmrc、
// .nvmrc、.node-version、.github/workflows/ci.yml）。
// 结论打印出来；在 GitHub Actions 里另写进 $GITHUB_OUTPUT 的 run=true|false，后面的步骤按它决定跑不跑。
// 拿不准（共同祖先找不到、git 出错）一律按要跑算：宁可多跑，不漏跑。
// 退出码：0（结论在输出里）；2 用法错误。本脚本不引依赖。

import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";

const AFFECTING = [
  "apps/admin/",
  "packages/shared/",
  "packages/contract/",
  "packages/config/",
  "design/tokens.json",
  "pnpm-lock.yaml",
  "package.json",
  "pnpm-workspace.yaml",
  ".npmrc",
  ".nvmrc",
  ".node-version",
  ".github/workflows/ci.yml",
];

const args = process.argv.slice(2);
const at = args.indexOf("--base");
if (at < 0 || args[at + 1] === undefined) {
  console.error("后台冒烟范围：要给 --base <git 引用>（推到 main 时给空串）");
  process.exit(2);
}
const base = args[at + 1].trim();

/** 改到的文件里，落在受影响范围内的那些 */
function affectingFiles(files) {
  return files.filter((file) =>
    AFFECTING.some((scope) => (scope.endsWith("/") ? file.startsWith(scope) : file === scope)),
  );
}

function decide() {
  if (base === "") return { run: true, why: "不是 PR（没有基线）：一律跑" };
  let changed;
  try {
    changed = execFileSync("git", ["diff", "--name-only", `${base}...HEAD`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    })
      .split("\n")
      .filter(Boolean);
  } catch (error) {
    return {
      run: true,
      why: `算不出相对 ${base} 改了什么（${String(error.message).trim()}）：按要跑算`,
    };
  }
  const hits = affectingFiles(changed);
  return hits.length > 0
    ? {
        run: true,
        why: `相对 ${base} 改到了后台或它依赖的部分：${hits.slice(0, 5).join("、")}${hits.length > 5 ? ` 等 ${hits.length} 个文件` : ""}`,
      }
    : { run: false, why: `相对 ${base} 改的 ${changed.length} 个文件都不在后台的受影响范围内` };
}

const decision = decide();
console.log(`后台冒烟：${decision.run ? "要跑" : "不用跑"}。${decision.why}`);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `run=${decision.run}\n`);
