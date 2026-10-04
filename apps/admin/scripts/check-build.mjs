#!/usr/bin/env node
// 构建产物检查（W0-28 任务书 第 7 节第 1 条、第 11 节第 1 项）：后台与下载页共用，各自的 build 脚本在 vite build 之后跑它。
//
// 用法：node apps/admin/scripts/check-build.mjs <产物目录> [--app <admin|portal>]
// 口径：
//   1. 写入了构建号：build.json 有非空的 build；index.html 里 <meta name="lyx-build"> 的值与它相同。
//   2. 是生产构建：build.json 的 mode 是 production（带样例页的冒烟构建不能当成生产产物交出去）。
//   3. 产物文件名带内容哈希：assets/ 下至少有一个 .js，全部 .js、.css 的文件名都是 <名字>-<哈希>.<扩展名>；
//      index.html 引用的脚本与样式都在 assets/ 下。
//   4. 生产构建里不含夹具：任何文件里都找不到夹具的标记（apps/admin/src/dev/mark.ts）。
//      样例页、夹具的权限数据与样例数据都带这个标记；出现即说明开发用的代码进了生产包。
// 退出码：0 通过；1 有违规；2 用法或环境错误。本脚本不引依赖。

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

// 标记在这里拼出来：免得本文件自己的文本被当成“产物里出现了标记”的依据去搜
const FIXTURE_MARK = ["lyx", "dev", "fixture"].join("-");
const HASHED_NAME = /^[\w.-]+-[A-Za-z0-9_-]{8,}\.(?:js|css)$/;

function fail(message) {
  console.error(`构建产物检查：${message}`);
  process.exit(2);
}

const args = process.argv.slice(2);
const dist = args[0] && !args[0].startsWith("--") ? resolve(args[0]) : null;
const appFlag = args.indexOf("--app");
const app = appFlag >= 0 ? args[appFlag + 1] : null;
if (!dist) fail("要给出产物目录，如 node apps/admin/scripts/check-build.mjs dist/app");
if (!existsSync(dist) || !statSync(dist).isDirectory()) fail(`产物目录不存在：${dist}。先跑构建`);

const problems = [];

function listFiles(dir, prefix = "") {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? listFiles(join(dir, entry.name), `${prefix}${entry.name}/`)
      : [`${prefix}${entry.name}`],
  );
}

// 1、2：构建号与构建模式
let build = null;
const buildFile = join(dist, "build.json");
if (!existsSync(buildFile)) problems.push("没有 build.json：构建号没有写入");
else {
  try {
    const info = JSON.parse(readFileSync(buildFile, "utf8"));
    if (typeof info.build !== "string" || info.build.trim() === "") {
      problems.push("build.json 里的构建号是空的");
    } else build = info.build;
    if (info.mode !== "production") {
      problems.push(`不是生产构建：build.json 的 mode 是 ${JSON.stringify(info.mode)}`);
    }
    if (app && info.app !== app) {
      problems.push(`build.json 的 app 是 ${JSON.stringify(info.app)}，应为 ${app}`);
    }
  } catch (error) {
    problems.push(`build.json 解析不了：${error.message}`);
  }
}

const indexFile = join(dist, "index.html");
let html = "";
if (!existsSync(indexFile)) problems.push("没有 index.html");
else {
  html = readFileSync(indexFile, "utf8");
  const meta = /<meta\s+name="lyx-build"\s+content="([^"]*)"/.exec(html);
  if (!meta) problems.push('index.html 里没有 <meta name="lyx-build">：构建号没有写入');
  else if (build !== null && meta[1] !== build) {
    problems.push(`index.html 的构建号（${meta[1]}）与 build.json 的（${build}）不一致`);
  }
}

// 3：文件名带内容哈希
const files = listFiles(dist);
const assets = files.filter((file) => /\.(?:js|css)$/.test(file));
if (!assets.some((file) => file.endsWith(".js"))) problems.push("产物里没有脚本文件");
for (const file of assets) {
  const name = file.slice(file.lastIndexOf("/") + 1);
  if (!file.startsWith("assets/") || !HASHED_NAME.test(name)) {
    problems.push(`文件名不带内容哈希：${file}`);
  }
}
for (const match of html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)) {
  const target = match[1].replace(/^\//, "");
  if (!assets.includes(target)) problems.push(`index.html 引用的 ${match[1]} 不在产物里`);
}

// 4：不含夹具
for (const file of files) {
  if (!/\.(?:js|css|html|json|map)$/.test(file)) continue;
  if (readFileSync(join(dist, file), "utf8").includes(FIXTURE_MARK)) {
    problems.push(`生产构建里出现了夹具的标记（${FIXTURE_MARK}）：${file}。样例页或夹具进了生产包`);
  }
}

if (problems.length > 0) {
  console.error(`构建产物检查没有通过（${dist}）：`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(
  `构建产物检查通过：${app ?? "应用"}，构建号 ${build}；带哈希的脚本与样式 ${assets.length} 个；不含夹具。`,
);
