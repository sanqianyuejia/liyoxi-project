#!/usr/bin/env node
// .env.example 核对：键集合等于 loadEnv 读的键集合，值都是占位（计划 第 3 节 ⑦；CLAUDE.md 硬性规则 1）。
//
// 用法：node infra/ci/check-env-example.mjs [--file <样例文件>] [--keys <逗号分隔的键名>]
//   不带参数  核对仓库根的 .env.example；键集合取 packages/services/src/kernel/env.ts 的 ENV_KEYS
//   --file    换一份样例文件（用例与反例用）
//   --keys    不加载 env.ts，直接给键集合（用例用）
// 口径：
//   1. 非空、非注释的行都是 KEY=VALUE；键只含大写字母、数字、下划线；不重复。
//   2. 键集合与 loadEnv 的键集合相等，多了少了都报。
//   3. 值是占位：空，或者去掉 <…> 占位段与开头的“协议://”之后，只剩 : / @ ? & = 这几个连接符号。
//      字面的主机、账号、口令、端口、路径都不许出现。
// 退出码：0 通过；1 有不一致；2 用法或环境错误。报错只列键名与行号，不回显值。
// 本脚本不引依赖。env.ts 靠 Node 自带的类型擦除直接加载（Node 24 起默认开启）。

import { readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url)).replace(/\/$/, "");
const ENV_MODULE = "packages/services/src/kernel/env.ts";
const KEY = /^[A-Z][A-Z0-9_]*$/;

function fail(message) {
  console.error(`.env.example 核对：${message}`);
  process.exit(2);
}

function parseArgs(argv) {
  const options = { file: join(repoRoot, ".env.example"), keys: null };
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag !== "--file" && flag !== "--keys") fail(`不认识的参数 ${flag}`);
    if (value === undefined) fail(`${flag} 后面要跟一个值`);
    if (flag === "--file") options.file = isAbsolute(value) ? value : resolve(process.cwd(), value);
    else options.keys = value.split(",").filter(Boolean);
  }
  return options;
}

async function loadEnvKeys() {
  try {
    const module = await import(pathToFileURL(join(repoRoot, ENV_MODULE)).href);
    if (!Array.isArray(module.ENV_KEYS)) throw new Error("没有导出 ENV_KEYS");
    return [...module.ENV_KEYS];
  } catch (error) {
    return fail(`加载不了 ${ENV_MODULE}（先跑 pnpm install）。${error.message}`);
  }
}

/** 值是不是占位：空，或去掉占位段与协议头之后只剩连接符号 */
function isPlaceholder(value) {
  if (value === "") return true;
  const rest = value.replace(/<[^<>]+>/g, "").replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  return rest !== value && /^[:/@?&=]*$/.test(rest);
}

const options = parseArgs(process.argv.slice(2));
const expected = options.keys ?? (await loadEnvKeys());

let text;
try {
  text = readFileSync(options.file, "utf8");
} catch (error) {
  fail(`读不了样例文件。${error.message}`);
}

const problems = [];
const seen = [];
text.split("\n").forEach((rawLine, index) => {
  const line = rawLine.trim();
  if (line === "" || line.startsWith("#")) return;
  const where = `第 ${index + 1} 行`;
  const eq = line.indexOf("=");
  const key = eq === -1 ? line : line.slice(0, eq);
  if (eq === -1 || !KEY.test(key)) {
    problems.push(`${where}：不是 KEY=VALUE 的写法（键只含大写字母、数字、下划线）`);
    return;
  }
  if (seen.includes(key)) problems.push(`${where}：${key} 重复`);
  seen.push(key);
  if (!isPlaceholder(line.slice(eq + 1).trim())) {
    problems.push(`${where}：${key} 的值不是占位。样例里只写 <说明>，不写真实值`);
  }
});

for (const key of expected) {
  if (!seen.includes(key)) problems.push(`缺 ${key}：loadEnv 读它，样例里没有`);
}
for (const key of new Set(seen)) {
  if (!expected.includes(key)) problems.push(`多了 ${key}：样例里有，loadEnv 不读它`);
}

if (problems.length > 0) {
  console.error(`.env.example 核对未通过：${problems.length} 处`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}

console.log(`.env.example 核对通过：${expected.length} 个键与 loadEnv 一致，值都是占位。`);
