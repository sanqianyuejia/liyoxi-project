#!/usr/bin/env node
// 结构快照（W0-06b；计划 第 5.7 节“表结构与约束”行）：空库上跑完全部迁移，把表、列、约束、索引、触发器、函数
// 六类读成一份规范化的文本，入库在 packages/db/snapshot/structure.txt。之后每个 PR 重新生成一遍，与入库的不同即失败。
//
// 用法：node infra/ci/db-snapshot.mjs [--db <库>] [--check] [--out <文件>]
//   不带参数  建临时库 lyx_snapshot_check_<进程号>，跑完全部迁移，写快照，删库。根脚本 pnpm db:snapshot
//   --db      不建库，读这个已经跑完迁移的库（只读）。它上面有改动时写出来的就不是迁移的样子：只给排查与用例用
//   --check   不写文件：与入库的快照逐条比，有差异逐条列出（指到是哪个对象的哪一项），退出码 1
//   --out     写到别的文件（配 --check 时是“与哪一份比”）
// CI 里的检查是根脚本 pnpm db:snapshot:check：重新生成 → git diff --exit-code → 快照目录下没有未跟踪的文件。
// 规范化、口径、快照的写法见 db-structure-lib.mjs 开头。连库的办法见 db-lib.mjs 开头（psql；PG* 或 DATABASE_URL）。
// 临时库名带进程号：几个 worktree 共用一个实例，固定的名字会被别的会话删掉重建。
// 退出码：0 写好了，或 --check 无差异；1 --check 有差异；2 用法或环境错误（连不上、不是 PostgreSQL 17、迁移没跑成）。
// 本脚本不引依赖。

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import {
  SNAPSHOT_PATH,
  countProblems,
  diffStructure,
  parseSnapshot,
  readStructure,
  renderSnapshot,
  repoRoot,
  withMigratedDb,
} from "./db-structure-lib.mjs";

const MAX_SHOWN = 40;

function usage(message) {
  console.error(`结构快照：${message}`);
  process.exit(2);
}

function parseArgs(argv) {
  const options = { db: null, check: false, out: null };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--check") options.check = true;
    else if (flag === "--db" || flag === "--out") {
      const value = argv[(index += 1)];
      if (value === undefined) usage(`${flag} 后面要跟一个值`);
      options[flag.slice(2)] = value;
    } else usage(`不认识的参数 ${flag}。用法见脚本开头`);
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
const target = options.out ? resolve(process.cwd(), options.out) : join(repoRoot, SNAPSHOT_PATH);

let structure;
try {
  structure = options.db
    ? readStructure(options.db)
    : withMigratedDb(`lyx_snapshot_check_${process.pid}`, (db) => readStructure(db));
} catch (error) {
  usage(`读不到结构。${error.message}`);
}
if (!structure.version.startsWith("17.")) {
  usage(`快照只认 PostgreSQL 17 的输出，这个库是 ${structure.version}`);
}
const text = renderSnapshot(structure);
const from = options.db ? `库 ${options.db}` : "空库上跑完全部迁移";

if (!options.check) {
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text);
  const total = Object.values(structure.sections).reduce((sum, rows) => sum + rows.length, 0);
  console.log(`结构快照已写入 ${target}：${from}，六节共 ${total} 项。`);
  console.log(
    `没有进快照的分区子表 ${structure.partitions.length} 个：${structure.partitions.join("、") || "无"}`,
  );
  process.exit(0);
}

if (!existsSync(target)) usage(`找不到要比的快照 ${target}：先跑 pnpm db:snapshot`);
const stored = readFileSync(target, "utf8");
if (stored === text) {
  console.log(`结构快照无差异：${from}读出来的与 ${target} 逐字节相同。`);
  process.exit(0);
}
let problems;
try {
  const snapshot = parseSnapshot(stored);
  problems = [
    ...diffStructure(snapshot.sections, structure.sections, ["快照", "库里"]),
    ...countProblems(snapshot.counts, structure.counts, ["快照", "库里"]),
  ];
} catch (error) {
  problems = [`入库的快照读不了：${error.message}`];
}
if (problems.length === 0) problems = ["各项都对得上，差在文件头或排版：重跑 pnpm db:snapshot"];
console.error(`结构快照有差异：${from}读出来的与 ${target} 不同，${problems.length} 处。`);
for (const problem of problems.slice(0, MAX_SHOWN)) console.error(`- ${problem}`);
if (problems.length > MAX_SHOWN) console.error(`- ……只列前 ${MAX_SHOWN} 处`);
console.error(
  "迁移改了结构：重跑 pnpm db:snapshot，把快照与迁移一起提交。迁移没改：是这个库被人动过。",
);
process.exit(1);
