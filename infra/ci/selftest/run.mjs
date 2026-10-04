#!/usr/bin/env node
// 门禁自测：对固定的反例逐个跑对应的检查，断言“检查失败，且失败原因对得上”
//（计划 第 6.3 节 ④、第 10.1 节）。门禁被悄悄削弱时这里会红。
//
// 用法：node infra/ci/selftest/run.mjs [--cases <目录>] [--only <文件名里的一段>]
//   不带参数  跑 infra/ci/selftest/cases/ 下的全部反例。根脚本是 pnpm gates:selftest
//   --cases   换一个反例目录（框架自己的用例用）
//   --only    只跑文件名含这一段的反例（本地调试用；CI 不带）
// 一个反例一个文件（cases/*.mjs），自动收集，按文件名排序。后续的包只加文件，不改已有文件。
// 反例文件的写法：
//   export default {
//     gate: "换名检查",                  // 哪一道门禁
//     mutation: "文件里出现旧名",         // 这个反例造了什么
//     reason: /出现旧名/,                // 检查失败时输出里必须出现的内容（正则或字符串）
//     run(ctx) { … return ctx.run("node", [...], { cwd }) },   // 造出反例并跑检查，返回 { status, output }
//   };
//   ctx：repoRoot；tempDir() 给一个用完自动删的临时目录；writeFiles(dir, {路径: 内容})；
//        gitRepo({路径: 内容}) 建一个临时 git 仓库并全部加入暂存区；git(dir, ...参数)；
//        run(命令, 参数, { cwd, input, env }) 跑一条命令，不抛错；node(仓库内脚本, 参数, 选项)。
// 判定：检查的退出码非 0，且输出对得上 reason，才算这一例通过。
// 退出码：0 全部通过；1 有反例没让检查失败、失败原因对不上、反例文件写错，或一个反例都没有；2 用法错误。
// 本脚本不引依赖。

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url)).replace(/\/$/, "");
const CASE_TIMEOUT_MS = 180_000;

function fail(message) {
  console.error(`门禁自测：${message}`);
  process.exit(2);
}

function parseArgs(argv) {
  const options = { cases: join(repoRoot, "infra/ci/selftest/cases"), only: null };
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag !== "--cases" && flag !== "--only") fail(`不认识的参数 ${flag}`);
    if (value === undefined) fail(`${flag} 后面要跟一个值`);
    if (flag === "--cases")
      options.cases = isAbsolute(value) ? value : resolve(process.cwd(), value);
    else options.only = value;
  }
  return options;
}

const tempDirs = [];

function run(command, args = [], { cwd = repoRoot, input, env } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    input,
    encoding: "utf8",
    env: env ? { ...process.env, ...env } : process.env,
    timeout: CASE_TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (result.error)
    return { status: -1, output: `${output}\n命令没跑起来：${result.error.message}` };
  return { status: result.status ?? -1, output };
}

function writeFiles(dir, files) {
  for (const [relativePath, content] of Object.entries(files)) {
    const target = join(dir, relativePath);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
}

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), "lyx-selftest-"));
  tempDirs.push(dir);
  return dir;
}

/** 在临时目录里跑 git，不受本机的钩子、签名、身份设置影响；失败即抛错 */
function git(dir, ...args) {
  const result = run(
    "git",
    [
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "user.name=lyx-selftest",
      "-c",
      "user.email=lyx-selftest@example.invalid",
      ...args,
    ],
    { cwd: dir },
  );
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} 失败：${result.output.trim()}`);
  return result;
}

function gitRepo(files) {
  const dir = tempDir();
  git(dir, "init", "-q", "-b", "main");
  writeFiles(dir, files);
  git(dir, "add", "-A");
  return dir;
}

const ctx = {
  repoRoot,
  tempDir,
  writeFiles,
  git,
  gitRepo,
  run,
  node: (script, args = [], options = {}) =>
    run(process.execPath, [join(repoRoot, script), ...args], options),
};

function matches(reason, output) {
  return reason instanceof RegExp ? reason.test(output) : output.includes(reason);
}

async function runCase(file) {
  let definition;
  try {
    definition = (await import(pathToFileURL(file).href)).default;
  } catch (error) {
    return `反例文件加载不了：${error.message}`;
  }
  const { gate, mutation, reason, run: runCheck } = definition ?? {};
  const reasonOk = reason instanceof RegExp || (typeof reason === "string" && reason !== "");
  if (
    typeof gate !== "string" ||
    typeof mutation !== "string" ||
    !reasonOk ||
    typeof runCheck !== "function"
  ) {
    return "反例文件写错：default 导出要有 gate、mutation、reason、run";
  }
  let result;
  try {
    result = await runCheck(ctx);
  } catch (error) {
    return `反例没造出来：${error.message}`;
  }
  if (typeof result?.status !== "number" || typeof result?.output !== "string") {
    return "反例文件写错：run 要返回 { status, output }";
  }
  if (result.status === 0) return "检查没有失败（退出码 0）：这道门禁没拦住反例";
  const tail = result.output.trim().split("\n").slice(-6).join("\n      ");
  // 命令不存在、超时、被信号杀掉：检查根本没跑完，不能算“检查失败”
  if (result.status < 0) return `检查没跑完，不算检查失败。输出末尾：\n      ${tail}`;
  if (!matches(reason, result.output)) {
    return `检查失败了，但失败原因对不上（期望 ${reason}）。输出末尾：\n      ${tail}`;
  }
  return null;
}

const options = parseArgs(process.argv.slice(2));
if (!existsSync(options.cases)) fail(`反例目录 ${options.cases} 不存在`);

const files = readdirSync(options.cases)
  .filter((name) => name.endsWith(".mjs"))
  .filter((name) => options.only === null || name.includes(options.only))
  .sort();

let failed = 0;
try {
  for (const name of files) {
    const started = Date.now();
    const file = join(options.cases, name);
    const problem = await runCase(file);
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    const definition = problem === null ? (await import(pathToFileURL(file).href)).default : null;
    if (problem === null) {
      console.log(
        `✓ ${name}（${definition.gate}）：${definition.mutation} → 检查失败，且失败原因对得上（${seconds}s）`,
      );
    } else {
      failed += 1;
      console.error(`✗ ${name}：${problem}`);
    }
  }
} finally {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
}

if (files.length === 0) {
  console.error("门禁自测未通过：一个反例都没有。反例放在 infra/ci/selftest/cases/*.mjs");
  process.exit(1);
}
if (failed > 0) {
  console.error(`门禁自测未通过：${files.length} 个反例里有 ${failed} 个没过。`);
  process.exit(1);
}
console.log(`门禁自测通过：${files.length} 个反例都让对应的检查失败，且失败原因对得上。`);
