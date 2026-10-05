#!/usr/bin/env node
// 约束清单比对（W0-06b；01 第 6.3 节“手写约束”行、第 12 节）：拿一个跑完迁移的库与入库的结构快照逐条比，
// 再把数量三处对一遍。Prisma 对手写的 CHECK、部分索引、触发器、函数不建也不查（ADR-045），少一个它看不出，这里看。
//
// 用法：node infra/ci/db-constraints.mjs [--db <库>]
//   根脚本是 pnpm db:constraints:check。连库的办法见 db-lib.mjs 开头（psql；PG* 环境变量，或 DATABASE_URL 的主机与账号）
//   --db   要核对的库，默认 lyx_migrate_check（空库上跑过 pnpm db:deploy 的；CI 里就是它）。只读，所以不限库名：
//          核对一个已经部署的库，把 DATABASE_URL 指到那台服务器，--db 写上库名
// 两段，任何一段不过即退出码 1：
//   1. 库里的表、列、约束、索引、触发器、函数与快照的六节逐条一致。指到对象：谁只在一边有，谁的哪一项不同。
//      触发器连启停一起比，外键连它名下内部触发器的启停一起比，函数比函数体：已部署的库上触发器被停用、被删掉、
//      函数被换成空函数，都在这一段报出来。分区子表不比（不在快照里），它们由 pnpm db:partitions:assert 断言。
//   2. 数量：库里的（只数逻辑表）= 快照“计数”一节 = 06 第 1 节“规模”一条写的数。数量不写在本脚本里：
//      加表、加索引的包重出快照、行内改 06 的那几个数，这里跟着走。含分区子表的那一组只在快照与文档之间比
//     （已经部署的库上分区会越建越多）。
// 与 pnpm db:snapshot:check 的分工：那一条证明“快照 = 迁移在空库上建出来的”；这一条证明“这个库 = 快照”。
// 差异多于 40 处时只列前 40 处。退出码：0 通过；1 有差异；2 用法或环境错误。本脚本不引依赖。

import {
  SECTIONS,
  countProblems,
  diffStructure,
  readDocCounts,
  readSnapshot,
  readStructure,
} from "./db-structure-lib.mjs";

const MAX_SHOWN = 40;

function usage(message) {
  console.error(`约束清单比对：${message}`);
  process.exit(2);
}

const argv = process.argv.slice(2);
let db = "lyx_migrate_check";
if (argv.length === 2 && argv[0] === "--db") db = argv[1];
else if (argv.length !== 0) usage("用法 node infra/ci/db-constraints.mjs [--db <库>]");

let snapshot, structure, documented;
try {
  snapshot = readSnapshot();
  documented = readDocCounts();
  structure = readStructure(db);
} catch (error) {
  usage(`没比成。${error.message}`);
}
if (!structure.version.startsWith("17.")) {
  usage(`快照只认 PostgreSQL 17 的输出，库 ${db} 是 ${structure.version}`);
}

const differences = diffStructure(snapshot.sections, structure.sections, ["快照", "库里"]);
const counts = [
  ...countProblems(snapshot.counts, structure.counts, ["快照", "库里"], [0]),
  ...countProblems(documented, snapshot.counts, ["06 第 1 节", "快照"]),
];

console.log(`约束清单比对：库 ${db}（PostgreSQL ${structure.version}）对结构快照`);
console.log("| 节 | 快照 | 库里 | 差异 |");
console.log("| --- | --- | --- | --- |");
for (const [id, label] of SECTIONS) {
  const found = differences.filter((line) => line.startsWith(`【${label}】`)).length;
  console.log(
    `| ${label} | ${snapshot.sections[id].length} | ${structure.sections[id].length} | ${found} |`,
  );
}
console.log(
  `数量（只数逻辑表）：${Object.entries(structure.counts)
    .map(([item, [logical]]) => `${item} ${logical}`)
    .join("、")}`,
);

const problems = [...differences, ...counts];
if (problems.length === 0) {
  console.log("结论：通过。六节逐条一致，数量与快照、06 第 1 节对得上。");
  process.exit(0);
}
for (const problem of problems.slice(0, MAX_SHOWN)) console.error(`- ${problem}`);
if (problems.length > MAX_SHOWN)
  console.error(`- ……共 ${problems.length} 处，只列前 ${MAX_SHOWN} 处`);
console.error(`约束清单比对未通过：结构 ${differences.length} 处，数量 ${counts.length} 处。`);
process.exit(1);
