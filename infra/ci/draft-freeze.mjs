#!/usr/bin/env node
// 草稿冻结守卫（W0-06b；计划 第 5.7 节“表结构与约束”行；06 第 8 节）：表结构被迁移接管之后，
// docs/data-model/schema.prisma 与 docs/data-model/constraints/ 是首版迁移的底稿，从此冻结。
// 这里拿它们的 sha256 与登记值比，改了一个字节即失败：结构要变就写新迁移，不回头改底稿。
//
// 用法：node infra/ci/draft-freeze.mjs [--root <目录>]
//   根脚本是 pnpm db:draft-freeze:check。不连库。--root 换一个仓库根目录（用例用）
// 登记值在 infra/ci/draft-freeze.sha256，一行一个文件：“<sha256>  <路径>”（与 shasum -a 256 的输出同一个写法），
// # 开头的是注释。它按 frozen 登记成门禁文件：改它是放松类改动，走单独的 gate-change PR（任务书 第 11 节第 10 项）。
// 不通过的四种：文件的哈希与登记值不同；登记了的文件不在了；constraints/ 下多出没登记的文件；登记表里有重复或认不出的行。
// 分组文档（docs/data-model/*.md）不冻结：它们跟着迁移走，由 schema-check 与库比对。
// 退出码：0 通过；1 草稿被动过；2 用法或环境错误。本脚本不引依赖。

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REGISTRY = "infra/ci/draft-freeze.sha256";
const SCHEMA = "docs/data-model/schema.prisma";
const CONSTRAINTS = "docs/data-model/constraints";

function usage(message) {
  console.error(`草稿冻结守卫：${message}`);
  process.exit(2);
}

const argv = process.argv.slice(2);
let root = fileURLToPath(new URL("../../", import.meta.url)).replace(/\/$/, "");
if (argv.length === 2 && argv[0] === "--root") root = resolve(argv[1]);
else if (argv.length !== 0) usage("用法 node infra/ci/draft-freeze.mjs [--root <目录>]");
if (!existsSync(join(root, REGISTRY))) usage(`找不到登记表 ${REGISTRY}`);

const problems = [];
const registered = new Map();
readFileSync(join(root, REGISTRY), "utf8")
  .split("\n")
  .forEach((line, index) => {
    if (line.trim() === "" || line.startsWith("#")) return;
    const found = line.match(/^([0-9a-f]{64}) {2}(\S+)$/);
    if (!found) problems.push(`${REGISTRY} 第 ${index + 1} 行：写法认不出`);
    else if (registered.has(found[2])) problems.push(`${REGISTRY}：${found[2]} 登记了两次`);
    else registered.set(found[2], found[1]);
  });

const frozen = [SCHEMA];
if (existsSync(join(root, CONSTRAINTS))) {
  for (const entry of readdirSync(join(root, CONSTRAINTS), {
    withFileTypes: true,
    recursive: true,
  })) {
    if (!entry.isDirectory()) frozen.push(relative(root, join(entry.parentPath, entry.name)));
  }
}
for (const path of frozen.sort()) {
  if (!registered.has(path) && existsSync(join(root, path))) {
    problems.push(`${path}：草稿目录下多出一个没登记的文件`);
  }
}
for (const [path, expected] of registered) {
  if (path !== SCHEMA && !path.startsWith(`${CONSTRAINTS}/`)) {
    problems.push(
      `${REGISTRY}：${path} 不在冻结的范围里（只管 ${SCHEMA} 与 ${CONSTRAINTS}/ 下的文件）`,
    );
  } else if (!existsSync(join(root, path))) {
    problems.push(`${path}：登记了的草稿不在了`);
  } else {
    const actual = createHash("sha256")
      .update(readFileSync(join(root, path)))
      .digest("hex");
    if (actual !== expected) {
      problems.push(
        `${path}：草稿被改过，sha256 与登记值不同（现在 ${actual.slice(0, 12)}…，登记 ${expected.slice(0, 12)}…）`,
      );
    }
  }
}
if (registered.size === 0) problems.push(`${REGISTRY}：一个文件都没登记`);
else if (!registered.has(SCHEMA)) problems.push(`${REGISTRY}：${SCHEMA} 没有登记`);

if (problems.length === 0) {
  console.log(`草稿冻结守卫通过：${registered.size} 个草稿文件的 sha256 都等于登记值。`);
  process.exit(0);
}
for (const problem of problems) console.error(`- ${problem}`);
console.error(
  `草稿冻结守卫未通过：${problems.length} 处。草稿已冻结，结构以迁移为准：要改结构就写新迁移（packages/db/README.md 第 4 节），不改草稿。`,
);
process.exit(1);
