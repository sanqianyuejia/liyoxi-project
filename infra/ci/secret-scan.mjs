#!/usr/bin/env node
// 密钥扫描：用 gitleaks 官方镜像的固定标签直接跑，不经第三方 Action（D7 第 2.7 节）。
//
// 用法：node infra/ci/secret-scan.mjs [--dir <目录>]
//   不带参数  扫当前仓库的 git 历史：HEAD 能到的全部提交。在仓库根目录跑；CI 检出时要带完整历史。
//             只扫 HEAD 这一条线，别的分支、标签上的提交不扫：CI 检出带着全部分支，照 gitleaks 的缺省（--all）扫，
//             别人分支上的一处命中会让每个 PR 都红。各分支的提交由它自己的 PR 扫到。
//             合并提交也扫：按它相对第一个父提交的差异扫（--diff-merges=first-parent）。gitleaks 缺省不看合并提交
//             自己的改动，合并时手工写进去的内容（比如解决冲突时加的）会漏掉。代价是合并进来的那一侧被再扫一遍
//   --dir     不看 git，扫一个目录里的文件（反例与临时核对用）
// 放行项只写在仓库根的 .gitleaks.toml：需要时才建，只放本仓库误报的最小放行，逐条写原因；
// 改它是放松类门禁改动。gitleaks 另认一种写在被扫文件里的放行：命中的那一行带 “gitleaks:allow” 注释就不报。
// 这种注释写在业务文件里，门禁改动分类看不到，所以这里用 --ignore-gitleaks-allow 把它关掉：带了注释照样命中。
// 命中的内容一律打码（--redact），日志里不出现密钥本身。
// 要求本机 Docker 在运行。镜像的标签在下面写死，升级单独成 PR。
// 退出码：0 没有命中；1 有命中；2 用法或环境错误（Docker 没在运行、镜像拉不下来、git 历史没读全等）。
// 本脚本不引依赖。

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

const IMAGE = "ghcr.io/gitleaks/gitleaks:v8.30.1";
const LEAK_EXIT_CODE = 3;

function fail(message) {
  console.error(`密钥扫描：${message}`);
  process.exit(2);
}

function parseArgs(argv) {
  const options = { dir: null };
  for (let index = 0; index < argv.length; index += 2) {
    if (argv[index] !== "--dir") fail(`不认识的参数 ${argv[index]}`);
    const value = argv[index + 1];
    if (value === undefined) fail("--dir 后面要跟目录");
    options.dir = isAbsolute(value) ? value : resolve(process.cwd(), value);
  }
  return options;
}

function gitOutput(args, cwd) {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch {
    return null;
  }
}

const options = parseArgs(process.argv.slice(2));
const root = process.cwd();
const mounts = [];
const command = [];

if (options.dir !== null) {
  if (!existsSync(options.dir) || !statSync(options.dir).isDirectory()) {
    fail(`目录 ${options.dir} 不存在`);
  }
  mounts.push(`${options.dir}:/scan:ro`);
  command.push("dir", "/scan");
} else {
  const top = gitOutput(["rev-parse", "--show-toplevel"], root)?.trim();
  if (!top || resolve(top) !== resolve(root)) fail("当前目录须是 git 仓库的根目录");
  // 容器里按同一个绝对路径挂载：worktree 的 .git 是指向主仓库的文件，路径不变才找得到
  mounts.push(`${root}:${root}:ro`);
  const commonDir = resolve(root, gitOutput(["rev-parse", "--git-common-dir"], root).trim());
  if (!commonDir.startsWith(`${root}/`)) mounts.push(`${commonDir}:${commonDir}:ro`);
  // gitleaks 把这一串按空格拆开接在 git log -p -U0 后面；不给时它用 --full-history --all。
  // git log -p 缺省不出合并提交的差异，加 --diff-merges=first-parent 才出
  command.push("git", root, "--log-opts", "--full-history --diff-merges=first-parent HEAD");
  if (existsSync(join(root, ".gitleaks.toml"))) {
    command.push("--config", join(root, ".gitleaks.toml"));
  }
}

const args = [
  "run",
  "--rm",
  ...mounts.flatMap((mount) => ["-v", mount]),
  IMAGE,
  ...command,
  "--ignore-gitleaks-allow",
  "--redact",
  "--verbose",
  "--no-color",
  "--no-banner",
  "--exit-code",
  String(LEAK_EXIT_CODE),
];
const result = spawnSync("docker", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
if (result.error) fail(`docker 没跑起来（本机要装 Docker 并在运行）。${result.error.message}`);

const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
// git log 中途出错（历史里有对象读不到之类）时，gitleaks 只记一行 ERR，照样以 0 退出并报“没有命中”：
// 后面的提交其实没扫。历史没读全不能算通过
const historyIncomplete = /\bERR (?:\[git\]|error="stderr is not empty")/.test(output);
if (result.status === 0 && historyIncomplete) {
  console.error(output);
  fail(
    "git 历史没有读全（gitleaks 报了 git 的错误，见上面的 ERR 行），这次扫描不算数。检出带完整历史了吗？仓库的对象都读得到吗？",
  );
} else if (result.status === 0) {
  console.log(output);
  console.log(`密钥扫描通过：没有命中（${IMAGE}）。`);
} else if (result.status === LEAK_EXIT_CODE) {
  console.error(output);
  console.error(
    "密钥扫描未通过：有疑似密钥。真的密钥要作废并从历史里清掉；确属误报的，在 .gitleaks.toml 里逐条放行并写原因（走 gate-change PR）。",
  );
  process.exit(1);
} else {
  console.error(output);
  fail(
    `gitleaks 没有正常跑完（退出码 ${result.status}）。Docker 在运行吗？镜像 ${IMAGE} 拉得下来吗？`,
  );
}
