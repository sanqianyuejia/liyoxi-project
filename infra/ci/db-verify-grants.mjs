#!/usr/bin/env node
// 角色与授权的核对（W0-06a 任务书 第 7 节第 10 条、第 10 节第 5 步）：对一个跑完全部迁移的库，核对两个角色在不在、
// 授权有没有生效、分区表能不能写入与查询。托管库验证（db-verify-managed.mjs）跑通之后接着跑它：
// 根脚本 postdb:verify-managed 是 pnpm 的后置钩子，pnpm db:verify-managed 成功后自动执行，报告末尾多出“角色与授权”一段。
//
// 用法：DATABASE_URL=<跑完全部迁移的库> node infra/ci/db-verify-grants.mjs [--database <库名>]
//   根脚本是 pnpm db:verify-grants（单独跑）。
//   不带参数   只认 lyx_ 开头的库名（演练与测试用的库）。
//   --database 核对别的库名（预发、生产上已经部署的库，名字不以 lyx_ 开头）时必须写出库名，
//              且与 DATABASE_URL 指的、实际连上的库名逐字相同才往下跑：防连错了库还照样出一份报告。
// 它在库里做什么：读系统目录（只读）；另有一处写入，在一个事务里往埋点事件表插一行、读回来、回滚，库里不留数据
// （不取序列的号）。不建、不改、不删任何对象，不改授权，不切换角色：托管库上的管理账号往往不是超级用户，
// 切不到别的角色（见本包的 ADR）。要用表的属主（跑迁移的账号）或超级用户跑；只读副本上那一处写入做不了，会报不通过。
// 要 PostgreSQL 16 及以上（判定用到 16 才有的系统目录列）；更早的版本开头就停，退出码 2。
// 期望的授权不写在本脚本里：读 packages/db/src/grants.expected.json，与权限测试 packages/db/src/grants.test.ts 共用一份。
// 判定规则在 db-grants-rules.mjs：逻辑表逐张拿 lyx_app 的表级权限与期望比；序列、分区子表、lyx_readonly、PUBLIC、
// 转授权、成员、属主、视图等按规则核对，库里有多少核多少。
// 以后加表、加例外列、加以属主身份执行的函数：往那份数据里加一行，本脚本与它的用例都不用改（packages/db/README.md 第 9 节）。
// 连接串只取环境变量 DATABASE_URL，不打印：输出里只有库名与服务器版本；数据库的报错先抹掉主机、端口、账号、口令。
// 退出码：0 通过（可能另有几项请人过目，结论行会写明）；1 有一项没过；2 用法或环境错误。本脚本不引依赖，要本机有 psql。

import { readFileSync } from "node:fs";

import { CATALOG_SQL, EXPECTED_FILE, ROLES, judge, versionProblem } from "./db-grants-rules.mjs";
import { pgEnv, psql } from "./db-lib.mjs";

function stop(code, message) {
  console.error(`角色与授权核对：${message}`);
  process.exit(code);
}

const args = process.argv.slice(2);
if (args.length !== 0 && (args.length !== 2 || args[0] !== "--database"))
  stop(2, "不认识的参数。用法：node infra/ci/db-verify-grants.mjs [--database <库名>]");
/** 写明要核对的库名；没写就只认 lyx_ 开头的 */
const named = args[1] ?? null;
if (named !== null && !/^[A-Za-z0-9_-]{1,63}$/.test(named))
  stop(2, "--database 后面的库名只认字母、数字、下划线、连字符");

/** 期望的授权：tables、appendOnly、columnUpdate、definerFunctions、views 五项，含义见那份文件开头的“说明” */
let expected;
try {
  expected = JSON.parse(readFileSync(new URL(`../../${EXPECTED_FILE}`, import.meta.url), "utf8"));
} catch (error) {
  stop(2, `读不了期望的授权 ${EXPECTED_FILE}：${error.message}`);
}

let env;
try {
  env = pgEnv(process.env, { database: true });
} catch (error) {
  stop(2, error.message);
}
const db = env.PGDATABASE;
if (named === null && !/^lyx_[a-z0-9_]{1,58}$/.test(db))
  stop(
    2,
    "DATABASE_URL 指的库名要以 lyx_ 开头：只在专门的库上验证。要核对别的库（预发、生产上已经部署的），写明库名：--database <库名>",
  );
if (named !== null && named !== db)
  stop(2, "--database 写的库名与 DATABASE_URL 指的不是同一个：核对一下连的是不是想核对的那个库");

/** 抹掉连接信息，办法同 db-verify-managed.mjs：连接串、“主机:端口”、主机、口令、账号，括号里的解析地址，“port <端口>” */
function redact(text) {
  const secrets = [process.env.DATABASE_URL, `${env.PGHOST}:${env.PGPORT}`, env.PGPASSWORD]
    .concat([env.PGHOST, env.PGUSER])
    .filter((value) => value && (value === env.PGPASSWORD || value.length >= 3))
    .sort((a, b) => b.length - a.length);
  return secrets
    .reduce((out, value) => out.replaceAll(value, "‹已隐去›"), text)
    .replace(/\((?=[^)]*[.:])[0-9a-fA-F:.]{3,}\)/g, "(‹已隐去›)")
    .replace(/\bport \d+/g, "port ‹已隐去›");
}

/** 跑一段 SQL，返回各行；失败时给出抹过的报错 */
function run(sql) {
  const result = psql(db, sql, env);
  const lines = result.stdout.trim() === "" ? [] : result.stdout.trim().split("\n");
  return { ok: result.status === 0, lines, error: redact(result.stderr.trim()) };
}
function query(sql) {
  const result = run(sql);
  if (!result.ok) stop(2, `连不上库，或语句没跑成：${result.error}`);
  return result.lines;
}

// 先核对版本与连上的库：判定用的语句在 16 以下跑不了，开头就说明白，不让它报一句看不懂的语法错
const [server = ""] = query(
  "select current_setting('server_version_num') || ' ' || current_database() || ' ' || split_part(current_setting('server_version'), ' ', 1)",
);
const [versionNum, connected, version] = server.split(" ");
const tooOld = versionProblem(versionNum, version);
if (tooOld) stop(2, tooOld);
if (connected !== db) stop(2, "连上的库不是 DATABASE_URL 写的那个（中间有连接代理改了去向？）");
console.log(`\n## 角色与授权\n\n- 库：\`${db}\`；PostgreSQL ${version}`);

const present = query(`select rolname from pg_roles where rolname in ('${ROLES.join("', '")}')`);
const missing = ROLES.filter((role) => !present.includes(role));
if (missing.length > 0) {
  // 角色都不在，后面的权限函数会直接报错：到此为止
  console.log(`- 角色：缺 ${missing.join("、")}\n\n结论：不通过。授权迁移没有跑，或没有建出角色`);
  process.exit(1);
}
const catalog = JSON.parse(query(CATALOG_SQL).join("\n"));
if (catalog.tables.length === 0) {
  console.log("- 表：库里一张表都没有\n\n结论：不通过。迁移还没有跑（先 pnpm db:deploy）");
  process.exit(1);
}
const { notes, problems, review } = judge(catalog, expected);
for (const line of notes) console.log(`- ${line}`);

// 分区表：以当前账号插一行、读回来、回滚
const probe = run(`
begin;
insert into analytics_event (occurred_at, id, event_id, name, source, actor_type)
  values (now(), gen_random_uuid(), 'verify-' || gen_random_uuid(), 'verify_grants', 'direct', 'system')
  returning tableoid::regclass::text;
select count(*) from analytics_event where name = 'verify_grants';
rollback;`);
const [partition, count] = probe.lines;
// 报错只留第一行：psql 后面跟的 LINE 1: 与指位置的那一行不进结论
if (!probe.ok) problems.push(`分区表写入或查询没成：${probe.error.split("\n")[0]}`);
else if (!/^analytics_event_y\d{4}m\d{2}$/.test(partition ?? "") || count !== "1")
  problems.push(`分区表：写入的行落在 ${partition}（应是当月的分区），读回 ${count} 行`);
else console.log(`- 分区表：写入一行落在 ${partition}，经父表读得回；已回滚，库里不留数据`);

// 不判不通过、但要人看一眼的：逐条写明哪个角色、哪个对象、什么权限
if (review.length > 0)
  console.log(
    `- 请人过目（不算不通过）${review.length} 项：\n${review.map((line) => `  - ${line}`).join("\n")}`,
  );

if (problems.length > 0) {
  console.log(`\n结论：不通过。${problems.join("；")}`);
  process.exit(1);
}
console.log(
  review.length > 0
    ? `\n结论：通过，另有 ${review.length} 项请人过目（见上面“请人过目”一行）。角色在，授权生效，分区表可写可查`
    : "\n结论：通过。角色在，授权生效，分区表可写可查",
);
