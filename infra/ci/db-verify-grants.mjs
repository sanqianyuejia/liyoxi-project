#!/usr/bin/env node
// 角色与授权的核对（W0-06a 任务书 第 7 节第 10 条、第 10 节第 5 步）：对一个跑完全部迁移的库，核对两个角色在不在、
// 授权有没有生效、分区表能不能写入与查询。托管库验证（db-verify-managed.mjs）跑通之后接着跑它：
// 根脚本 postdb:verify-managed 是 pnpm 的后置钩子，pnpm db:verify-managed 成功后自动执行，报告末尾多出“角色与授权”一段。
//
// 用法：DATABASE_URL=<一个 lyx_ 开头、跑完全部迁移的库> node infra/ci/db-verify-grants.mjs
//   根脚本是 pnpm db:verify-grants（单独跑）。
// 只读系统目录，不切换角色：托管库上的管理账号往往不是超级用户，切不到别的角色（见本包的 ADR）。
// 唯一的写入是往埋点事件表插一行再回滚，库里不留数据。
// 期望的授权不写在本脚本里：读 packages/db/src/grants.expected.json，与权限测试 packages/db/src/grants.test.ts 共用一份。
// 逻辑表逐张拿 lyx_app 的表级权限与期望比；序列、分区子表、lyx_readonly、PUBLIC、转授权按规则核对，库里有多少核多少。
// 以后加表、加例外列、加以属主身份执行的函数：往那份数据里加一行，本脚本与它的用例都不用改（packages/db/README.md 第 9 节）。
// 连接串只取环境变量 DATABASE_URL，不打印：输出里只有库名；数据库的报错先抹掉主机、端口、账号、口令。
// 退出码：0 通过；1 有一项没过；2 用法或环境错误。本脚本不引依赖，要本机有 psql。

import { readFileSync } from "node:fs";

import { pgEnv, psql } from "./db-lib.mjs";

const EXPECTED_FILE = "packages/db/src/grants.expected.json";
const ROLES = ["lyx_app", "lyx_readonly"];
const [APP, READONLY] = ROLES;
/** 常规读写的表上 lyx_app 的权限；期望里不是它的表算“受限的表”（只增、不给删除、不给改） */
const FULL = "DELETE,INSERT,SELECT,UPDATE";
const KIND = {
  table: "表",
  column: "列",
  sequence: "序列",
  function: "函数",
  schema: "模式",
  database: "库",
};

function stop(code, message) {
  console.error(`角色与授权核对：${message}`);
  process.exit(code);
}

/** 期望的授权：tables、appendOnly、columnUpdate、definerFunctions 四项，含义见那份文件开头的“说明” */
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
if (!/^lyx_[a-z0-9_]{1,58}$/.test(db))
  stop(2, "DATABASE_URL 指的库名要以 lyx_ 开头：只在专门的库上验证");

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

/** 一类对象的访问控制列表逐条展开：种类、对象名、被授权者（owned 表示就是属主自己）、权限、是否带转授权 */
const aclOf = (kind, name, owner, acl, from) =>
  `select ${kind} as kind, ${name} as name, x.grantee = ${owner} as owned,
          case when x.grantee = 0 then 'PUBLIC' else x.grantee::regrole::text end as grantee,
          x.privilege_type as privilege, x.is_grantable as grantable
     from ${from}, aclexplode(${acl}) x`;
const IN_PUBLIC = "= 'public'::regnamespace";
// 一条语句把授权读成一个 JSON 文档。acl 里是写明了的授权（不按“有效权限”问）：这样 MAINTAIN 这类新权限、转授权、
// 授给别的角色的都看得见。两个角色不是别的角色的成员（前面核对过），所以它们的有效权限就是自己名下的加 PUBLIC 的。
// 以属主身份执行的函数、模式、库没有写明授权时按缺省的算（函数缺省所有人可执行）。schema 里问的是有效权限。
const CATALOG_SQL = `
select json_build_object(
  'me', (select json_build_object('super', r.rolsuper, 'createrole', r.rolcreaterole,
           'set_app', pg_has_role('${APP}', 'SET'),
           'owner', (select bool_and(c.relowner = r.oid) from pg_class c
                      where c.relnamespace ${IN_PUBLIC} and c.relkind in ('r', 'p')))
           from pg_roles r where r.rolname = current_user),
  'tables', (select coalesce(json_agg(json_build_object('name', c.relname, 'owner', c.relowner::regrole::text,
      'logical', not c.relispartition and c.relname <> '_prisma_migrations') order by c.relname), '[]')
    from pg_class c where c.relnamespace ${IN_PUBLIC} and c.relkind in ('r', 'p')),
  'sequences', (select coalesce(json_agg(c.relname order by c.relname), '[]')
    from pg_class c where c.relnamespace ${IN_PUBLIC} and c.relkind = 'S'),
  'definers', (select coalesce(json_agg(p.proname order by p.proname), '[]')
    from pg_proc p where p.pronamespace ${IN_PUBLIC} and p.prosecdef),
  'schema', (select json_object_agg(r, json_build_object('usage', has_schema_privilege(r, 'public', 'USAGE'),
      'create', has_schema_privilege(r, 'public', 'CREATE'),
      'db_create', has_database_privilege(r, current_database(), 'CREATE')))
    from unnest(array['${ROLES.join("', '")}']) r),
  'acl', (select coalesce(json_agg(e), '[]') from (
    ${aclOf("case c.relkind when 'S' then 'sequence' else 'table' end", "c.relname::text", "c.relowner", "c.relacl", "pg_class c")}
     where c.relnamespace ${IN_PUBLIC} and c.relkind in ('r', 'p', 'S')
    union all
    ${aclOf("'column'", "c.relname || '.' || a.attname", "c.relowner", "a.attacl", "pg_class c join pg_attribute a on a.attrelid = c.oid")}
     where c.relnamespace ${IN_PUBLIC} and c.relkind in ('r', 'p')
    union all
    ${aclOf("'function'", "p.proname::text", "p.proowner", "case when p.prosecdef then coalesce(p.proacl, acldefault('f', p.proowner)) else p.proacl end", "pg_proc p")}
     where p.pronamespace ${IN_PUBLIC}
    union all
    ${aclOf("'schema'", "n.nspname::text", "n.nspowner", "coalesce(n.nspacl, acldefault('n', n.nspowner))", "pg_namespace n")}
     where n.nspname = 'public'
    union all
    ${aclOf("'database'", "d.datname::text", "d.datdba", "coalesce(d.datacl, acldefault('d', d.datdba))", "pg_database d")}
     where d.datname = current_database()) e),
  'defaults', (select count(*) from pg_default_acl d, aclexplode(d.defaclacl) x
                where x.grantee = '${READONLY}'::regrole and x.privilege_type = 'SELECT'))`;

const problems = [];
const note = (line) => console.log(`- ${line}`);
console.log(`\n## 角色与授权\n\n- 库：\`${db}\``);

const roles = query(
  `select rolname || ' ' || concat_ws(',', rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls)
       || ' ' || (select count(*) from pg_auth_members m where m.member = r.oid)
     from pg_roles r where rolname in ('${ROLES.join("', '")}') order by 1`,
);
const missing = ROLES.filter((role) => !roles.some((line) => line.startsWith(`${role} `)));
if (missing.length > 0) {
  // 角色都不在，后面的权限函数会直接报错：到此为止
  console.log(`- 角色：缺 ${missing.join("、")}\n\n结论：不通过。授权迁移没有跑，或没有建出角色`);
  process.exit(1);
}
const odd = roles.filter((line) => !line.endsWith(" f,f,f,f,f,f 0"));
if (odd.length > 0)
  problems.push(`角色的属性不对（可登录、有特权属性，或是别的角色的成员）：${odd.join("；")}`);
else note(`角色：${ROLES.join("、")} 都在，不可登录，没有特权属性，不是别的角色的成员`);

const catalog = JSON.parse(query(CATALOG_SQL).join("\n"));
const { me, tables, sequences } = catalog;
if (tables.length === 0) {
  console.log("- 表：库里一张表都没有\n\n结论：不通过。迁移还没有跑（先 pnpm db:deploy）");
  process.exit(1);
}
const yes = (flag) => (flag ? "是" : "否");
note(
  `当前账号：超级用户 ${yes(me.super)}，可建角色 ${yes(me.createrole)}，是全部表的属主 ${yes(me.owner)}，可切换到 lyx_app ${yes(me.set_app)}`,
);

/** 有不合的就记成一条问题（最多列 8 个）；返回是否全合 */
function check(what, bad) {
  const list = [...new Set(bad)];
  if (list.length > 0)
    problems.push(
      `${what}：${list.slice(0, 8).join("、")}${list.length > 8 ? ` 等 ${list.length} 个` : ""}`,
    );
  return list.length === 0;
}
/** 属主以外的授权，按“种类、对象、被授权者”归拢 */
const grants = new Map();
for (const { kind, name, grantee, privilege } of catalog.acl.filter((entry) => !entry.owned)) {
  const key = JSON.stringify([kind, name, grantee]);
  const grant = grants.get(key) ?? { kind, name, grantee, privileges: [] };
  grants.set(key, { ...grant, privileges: [...grant.privileges, privilege].sort() });
}
/** 某个对象上某个被授权者的权限集合：按字母序、逗号连接，与期望数据同一种写法 */
const held = (kind, name, grantee) =>
  (grants.get(JSON.stringify([kind, name, grantee]))?.privileges ?? []).join(",");

// 模式与库：进得了 public，建不了对象
const noUsage = check(
  "进不了模式 public（没有 USAGE）的角色",
  ROLES.filter((role) => !catalog.schema[role].usage),
);
const noCreate = check(
  "能在模式 public 或库里建对象（有 CREATE）的角色",
  ROLES.filter((role) => catalog.schema[role].create || catalog.schema[role].db_create),
);
if (noUsage && noCreate) note("模式 public：两个角色都有 USAGE，没有 CREATE；库上也没有 CREATE");

// lyx_app：逻辑表逐张与期望比
const want = expected.tables;
const logical = tables.filter((table) => table.logical).map((table) => table.name);
const others = tables.filter((table) => !table.logical).map((table) => table.name);
const known = logical.filter((name) => Object.hasOwn(want, name));
const tablesOk = [
  check(
    `库里有而期望清单（${EXPECTED_FILE}）里没有的表`,
    logical.filter((name) => !Object.hasOwn(want, name)),
  ),
  check(
    "期望清单里有而库里没有的表",
    Object.keys(want).filter((name) => !logical.includes(name)),
  ),
  check(
    "lyx_app 的表级权限与期望不符",
    known
      .filter((name) => held("table", name, APP) !== want[name])
      .map((name) => `${name}（实际 ${held("table", name, APP) || "无"}，期望 ${want[name]}）`),
  ),
].every(Boolean);
const bySet = new Map();
for (const name of logical) {
  const set = held("table", name, APP) || "无";
  bySet.set(set, (bySet.get(set) ?? 0) + 1);
}
note(
  `lyx_app 的表级权限（${logical.length} 张逻辑表${tablesOk ? "，逐张与期望相同" : ""}）：${[
    ...bySet,
  ]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([set, count]) => `${set} ${count} 张`)
    .join("；")}`,
);
check(
  "属主是 lyx_app 或 lyx_readonly 的表",
  tables.filter((table) => ROLES.includes(table.owner)).map((table) => table.name),
);
if (
  check(
    "lyx_app 能直接碰的分区子表或 _prisma_migrations",
    others.filter((name) => held("table", name, APP) !== ""),
  )
)
  note(`分区子表与 _prisma_migrations（${others.length} 张）：lyx_app 没有任何权限`);

// 列级授权：lyx_app 只有期望里写的那几列 UPDATE；lyx_readonly 与 PUBLIC 一列也没有
const wantColumns = Object.entries(expected.columnUpdate).flatMap(([table, columns]) =>
  columns.map((column) => `${table}.${column}`),
);
const columnsOk = [
  check(
    "lyx_app 少了列级 UPDATE 的列",
    wantColumns.filter((name) => held("column", name, APP) !== "UPDATE"),
  ),
  check(
    "期望之外的列级授权",
    [...grants.values()]
      .filter(({ kind, grantee }) => kind === "column" && [...ROLES, "PUBLIC"].includes(grantee))
      .filter(({ name, grantee }) => grantee !== APP || !wantColumns.includes(name))
      .map(({ name, grantee, privileges }) => `${name}（${grantee} ${privileges.join(",")}）`),
  ),
].every(Boolean);
// 只增表：不管期望清单怎么写，表级权限必须恰好是 INSERT、SELECT
const appendOk = check(
  "只增表上 lyx_app 的表级权限不是恰好 INSERT、SELECT",
  expected.appendOnly.filter((name) => held("table", name, APP) !== "INSERT,SELECT"),
);
if (appendOk && columnsOk)
  note(
    `只增表 ${expected.appendOnly.length} 张：改、删、清空都没有权限；列级 UPDATE 只有 ${wantColumns.length} 列（${wantColumns.join("、")}）`,
  );
const fileObject = held("table", "file_object", APP);
if (logical.includes("file_object") && !fileObject.split(",").includes("DELETE"))
  note(`file_object：${fileObject}，没有 DELETE`);
else problems.push("file_object 上 lyx_app 有 DELETE，或库里没有这张表");
check(
  "PUBLIC 有权限的表、列或序列",
  [...grants.values()]
    .filter(({ kind, grantee }) => grantee === "PUBLIC" && /table|column|sequence/.test(kind))
    .map(({ name }) => name),
);

if (
  check(
    "lyx_app 的权限不是恰好 USAGE 的序列",
    sequences.filter((name) => held("sequence", name, APP) !== "USAGE"),
  )
)
  note(`序列 ${sequences.length} 个：lyx_app 都有 USAGE（取号），没有 UPDATE（改当前值）`);

// 以属主身份执行的函数：库里有哪些、各由谁执行，都要与期望相同；PUBLIC 可执行也算不符
const wantFunctions = expected.definerFunctions;
const executors = (name) =>
  [...grants.values()]
    .filter((grant) => grant.kind === "function" && grant.name === name)
    .map((grant) => grant.grantee)
    .sort()
    .join(",");
const functionNames = [...new Set([...catalog.definers, ...Object.keys(wantFunctions)])];
if (
  check(
    "以属主身份执行的函数，库里的与期望清单不符",
    functionNames
      .map((name) => [name, executors(name), [...(wantFunctions[name] ?? [])].sort().join(",")])
      .filter(
        ([name, actual, wanted]) =>
          !catalog.definers.includes(name) ||
          actual !== wanted ||
          !Object.hasOwn(wantFunctions, name),
      )
      .map(
        ([name, actual, wanted]) =>
          `${name}（${catalog.definers.includes(name) ? `可执行的是 ${actual || "无"}` : "库里没有"}，期望 ${wanted || "清单里没有它"}）`,
      ),
  )
)
  note(
    `以属主身份执行的函数 ${catalog.definers.length} 个（${catalog.definers.join("、")}）：PUBLIC 不能执行，可执行的角色与期望相同`,
  );

const readable = check(
  "lyx_readonly 的权限不是恰好 SELECT 的表",
  tables.map((table) => table.name).filter((name) => held("table", name, READONLY) !== "SELECT"),
);
const seqReadable = check(
  "lyx_readonly 的权限不是恰好 SELECT 的序列",
  sequences.filter((name) => held("sequence", name, READONLY) !== "SELECT"),
);
if (catalog.defaults < 2)
  problems.push("没有给 lyx_readonly 的缺省授权（表与序列各一条）：以后新建的分区它读不到");
if (readable && seqReadable && catalog.defaults >= 2)
  note(
    `lyx_readonly：${tables.length} 张表（含分区子表与 _prisma_migrations）、${sequences.length} 个序列都只读；缺省授权 ${catalog.defaults} 条`,
  );

// 转授权：属主以外谁也不该带（带了就能把权限再授给别人）
const label = ({ kind, name, grantee, privileges }) =>
  `${KIND[kind]} ${name}（${grantee} ${privileges.join(",")}）`;
const noGrantOption = check(
  "带转授权（WITH GRANT OPTION）的授权",
  catalog.acl
    .filter((entry) => !entry.owned && entry.grantable)
    .map((entry) => label({ ...entry, privileges: [entry.privilege] })),
);
// 别的角色：受限的表上不该有查询以外的权限；其余的只列出来
const restricted = Object.keys(want).filter((name) => want[name] !== FULL);
const strangers = [...grants.values()].filter(
  ({ kind, grantee }) =>
    /table|column|sequence/.test(kind) && ![...ROLES, "PUBLIC"].includes(grantee),
);
const noWriters = check(
  "只增表或不给改、删的表上，别的角色有查询以外的权限",
  strangers
    .filter(({ kind, name }) => kind !== "sequence" && restricted.includes(name.split(".")[0]))
    .filter(({ privileges }) => privileges.some((privilege) => privilege !== "SELECT"))
    .map(label),
);
if (noGrantOption && noWriters) {
  const who = [...new Set(strangers.map((grant) => grant.grantee))];
  note(
    `转授权：没有。属主以外在表、列、序列上有授权的角色：${
      who.length === 0
        ? "只有 lyx_app 与 lyx_readonly"
        : `除这两个之外还有 ${who.join("、")}（不在受限的表上，或只有查询；请人工过目）`
    }`,
  );
}

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
else note(`分区表：写入一行落在 ${partition}，经父表读得回；已回滚，库里不留数据`);

if (problems.length > 0) {
  console.log(`\n结论：不通过。${problems.join("；")}`);
  process.exit(1);
}
console.log("\n结论：通过。角色在，授权生效，分区表可写可查");
