#!/usr/bin/env node
// 分区断言（W0-06b；计划 第 5.7 节“表结构与约束”行、第 6.3 节退出 ②）：分区子表不进结构快照，在这里单独断言。
//
// 用法：node infra/ci/db-partition-assert.mjs [--db <库>] [--today <YYYY-MM-DD>]
//   根脚本是 pnpm db:partitions:assert。连库的办法见 db-lib.mjs 开头
//   --db     要核对的库，默认 lyx_migrate_check。只读，所以不限库名（已经部署的库照样能核对）
//   --today  “当月”按哪一天算，默认取库的时钟（北京时间）。只给用例用；跨月的行为由建分区的周期任务的测试覆盖（G2-C）
// 断言什么写在 db-structure-lib.mjs“分区断言”一段：兜底分区在且为空；当月与未来 3 个月的分区在、上下界对；
// 每个子表上父表的行级触发器与拦 TRUNCATE 的触发器都在且启用。
// 本地那个长期留着的 lyx_migrate_check 过了月初会少一个月的分区（迁移只在建库那天预建）：删掉重建，
// 见 packages/db/README.md 第 3 节。已经部署的库上少了，是建分区的周期任务没跑。
// 退出码：0 成立；1 不成立；2 用法或环境错误。本脚本不引依赖。

import { expectedMonths, partitionProblems, readPartitions } from "./db-structure-lib.mjs";

function usage(message) {
  console.error(`分区断言：${message}`);
  process.exit(2);
}

const options = { db: "lyx_migrate_check", today: null };
const argv = process.argv.slice(2);
for (let index = 0; index < argv.length; index += 2) {
  const name = argv[index].startsWith("--") ? argv[index].slice(2) : "";
  if (!Object.hasOwn(options, name)) usage(`不认识的参数 ${argv[index]}。用法见脚本开头`);
  if (argv[index + 1] === undefined) usage(`${argv[index]} 后面要跟一个值`);
  options[name] = argv[index + 1];
}
if (options.today !== null && !/^\d{4}-(0[1-9]|1[0-2])-\d{2}$/.test(options.today)) {
  usage("--today 要写成 YYYY-MM-DD");
}

let info;
try {
  info = readPartitions(options.db);
} catch (error) {
  usage(`读不到分区情况。${error.message}`);
}
const today = options.today ?? info.today;
const problems = partitionProblems(info, today);

console.log(`分区断言：库 ${options.db}，按 ${today}（北京时间）算当月`);
for (const parent of info.parents) {
  const names = parent.children.map((child) => child.name.slice(parent.name.length + 1));
  console.log(`- ${parent.name}：子表 ${names.length} 个（${names.join("、") || "无"}）`);
}
console.log(
  `应有的月份：${expectedMonths(today)
    .map((month) => month.suffix)
    .join("、")}`,
);
if (problems.length === 0) {
  console.log("结论：成立。兜底分区在且为空，当月与未来 3 个月的分区都在，子表上的触发器齐全。");
  process.exit(0);
}
for (const problem of problems) console.error(`- ${problem}`);
console.error(`分区断言不成立：${problems.length} 处。`);
process.exit(1);
