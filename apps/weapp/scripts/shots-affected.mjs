#!/usr/bin/env node
// 小程序截图要不要跑：按受影响范围（计划 第 5.5 节的时长预算；写法照 apps/admin/scripts/e2e-affected.mjs）。
//
// 用法：node apps/weapp/scripts/shots-affected.mjs --base <git 引用>      在仓库根目录跑
//   --base 给了（PR）：看 <base> 与 HEAD 的共同祖先之后改了哪些文件，改到下面“受影响范围”里的才跑。
//   --base 为空（推到 main、手动）：一律跑。
// 受影响范围：小程序自己（apps/weapp/）；页面上看得见的设计变量与图标（packages/shared/src/design/、
// design/tokens.json）；会改变装了什么或怎么跑的几个文件（pnpm-lock.yaml、.github/workflows/ci.yml）。
// 范围取得窄：截图是给人看的页面证据，不是门禁；H5 构建加起浏览器要一分多钟，不让不相干的 PR 都付这个时间。
// 结论打印出来；在 GitHub Actions 里另写进 $GITHUB_OUTPUT 的 run=true|false，后面的步骤按它决定跑不跑。
// 拿不准（共同祖先找不到、git 出错）一律按要跑算。
// 退出码：0（结论在输出里）；2 用法错误。本脚本不引依赖。

import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";

const AFFECTING = [
  "apps/weapp/",
  "packages/shared/src/design/",
  "design/tokens.json",
  "pnpm-lock.yaml",
  ".github/workflows/ci.yml",
];

const args = process.argv.slice(2);
const at = args.indexOf("--base");
if (at < 0 || args[at + 1] === undefined) {
  console.error("小程序截图范围：要给 --base <git 引用>（推到 main 时给空串）");
  process.exit(2);
}
const base = args[at + 1].trim();

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
  const hits = changed.filter((file) =>
    AFFECTING.some((scope) => (scope.endsWith("/") ? file.startsWith(scope) : file === scope)),
  );
  return hits.length > 0
    ? {
        run: true,
        why: `相对 ${base} 改到了小程序或它看得见的部分：${hits.slice(0, 5).join("、")}${hits.length > 5 ? ` 等 ${hits.length} 个文件` : ""}`,
      }
    : {
        run: false,
        why: `相对 ${base} 改的 ${changed.length} 个文件都不在小程序截图的受影响范围内`,
      };
}

const decision = decide();
console.log(`小程序截图：${decision.run ? "要跑" : "不用跑"}。${decision.why}`);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `run=${decision.run}\n`);
