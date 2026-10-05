#!/usr/bin/env node
// 角色与授权的核对（W0-06a 任务书 第 7 节第 10 条、第 10 节第 5 步）：对一个跑完全部迁移的库，核对两个角色在不在、
// 授权有没有生效、分区表能不能写入与查询。托管库验证（db-verify-managed.mjs）跑通之后接着跑它：
// 根脚本 postdb:verify-managed 是 pnpm 的后置钩子，pnpm db:verify-managed 成功后自动执行，报告末尾多出“角色与授权”一段。
//
// 用法：DATABASE_URL=<一个 lyx_ 开头、跑完全部迁移的库> node infra/ci/db-verify-grants.mjs
//   根脚本是 pnpm db:verify-grants（单独跑）。
// 只读系统目录，不切换角色：托管库上的管理账号往往不是超级用户，切不到别的角色（见本包的 ADR）。
// 唯一的写入是往埋点事件表插一行再回滚，库里不留数据。期望的权限只写了文档点名的那几条（16 张只增表与它们的例外列、
// file_object 不给删除）；166 张表逐张的清单在 packages/db/src/grants.test.ts。
// 连接串只取环境变量 DATABASE_URL，不打印：输出里只有库名；数据库的报错先抹掉主机、端口、账号、口令。
// 退出码：0 通过；1 有一项没过；2 用法或环境错误。本脚本不引依赖，要本机有 psql。

import { pgEnv, psql } from "./db-lib.mjs";

/** 只增表（06 第 4 节“只增”为“是”的 16 张）→ 另授列级 UPDATE 的列 */
const APPEND_ONLY = {
  outbox_event: ["published_at"],
  status_transition: [],
  assignment_history: [
    ...["contact_due_at", "sla_snapshot", "contacted_at"],
    ...["contacted_by_staff_id", "contact_voided_at", "updated_at"],
  ],
  audit_log: [],
  auth_event: [],
  drama_copyright_revision: [],
  price_tier_revision: [],
  subscription_event: [],
  ledger_operation: [],
  point_ledger_entry: [],
  finance_config_revision: ["effective_at"],
  delivery_download_log: ["client_ack", "client_ack_at"],
  manual_reminder_log: [],
  agreement_consent: [],
  param_value: ["cancelled_at"],
  analytics_event: [],
};
const ROLES = ["lyx_app", "lyx_readonly"];
const WRITES = ["INSERT", "UPDATE", "DELETE", "TRUNCATE"];

function stop(code, message) {
  console.error(`角色与授权核对：${message}`);
  process.exit(code);
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

const privilegesOf = (role, kind, list) =>
  `(select coalesce(string_agg(p, ',' order by p), '') from unnest(array['${list.join("','")}']) p
     where has_${kind}_privilege('${role}', c.oid, p))`;
const TABLE_PRIVILEGES = ["SELECT", ...WRITES, "REFERENCES", "TRIGGER"];
// 有效权限（含经 PUBLIC 得到的）。列级 UPDATE 只在没有表级 UPDATE 的表上才有意义
const CATALOG_SQL = `
select json_build_object(
  'me', (select json_build_object('super', r.rolsuper, 'createrole', r.rolcreaterole,
           'set_app', pg_has_role('lyx_app', 'SET'),
           'owner', (select bool_and(c.relowner = r.oid) from pg_class c
                      where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')))
           from pg_roles r where r.rolname = current_user),
  'tables', (select json_agg(json_build_object('name', c.relname,
      'logical', not c.relispartition and c.relname <> '_prisma_migrations',
      'app', ${privilegesOf("lyx_app", "table", TABLE_PRIVILEGES)},
      'readonly', ${privilegesOf("lyx_readonly", "table", TABLE_PRIVILEGES)},
      'public', ${privilegesOf("public", "table", TABLE_PRIVILEGES)},
      'app_columns', (select coalesce(json_agg(a.attname order by a.attname), '[]') from pg_attribute a
                       where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
                         and has_column_privilege('lyx_app', c.oid, a.attnum, 'UPDATE'))) order by c.relname)
    from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')),
  'sequences', (select json_agg(json_build_object('name', c.relname,
      'app', ${privilegesOf("lyx_app", "sequence", ["USAGE", "UPDATE"])},
      'readonly', ${privilegesOf("lyx_readonly", "sequence", ["SELECT", "USAGE", "UPDATE"])}) order by c.relname)
    from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'S'),
  'definers', (select coalesce(json_agg(json_build_object('name', c.proname,
      'who', (select coalesce(string_agg(g, ',' order by g), '') from unnest(array['lyx_app', 'lyx_readonly', 'public']) g
               where has_function_privilege(g, c.oid, 'EXECUTE'))) order by c.proname), '[]')
    from pg_proc c where c.pronamespace = 'public'::regnamespace and c.prosecdef),
  'defaults', (select count(*) from pg_default_acl d, aclexplode(d.defaclacl) x
                where x.grantee = 'lyx_readonly'::regrole and x.privilege_type = 'SELECT'))`;

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
const yes = (flag) => (flag ? "是" : "否");
const { me } = catalog;
note(
  `当前账号：超级用户 ${yes(me.super)}，可建角色 ${yes(me.createrole)}，是全部表的属主 ${yes(me.owner)}，可切换到 lyx_app ${yes(me.set_app)}`,
);

// 库里一张表都没有时聚合出来的是 null
const tables = catalog.tables ?? [];
const logical = tables.filter((table) => table.logical);
const others = tables.filter((table) => !table.logical);
const bySet = new Map();
for (const table of logical) bySet.set(table.app, (bySet.get(table.app) ?? 0) + 1);
note(
  `lyx_app 的表级权限（${logical.length} 张逻辑表）：${[...bySet]
    .sort((a, b) => b[1] - a[1])
    .map(([set, count]) => `${set || "无"} ${count} 张`)
    .join("；")}`,
);
/** 一组表里不满足条件的，记成一条问题 */
function expectAll(tables, ok, what) {
  const bad = tables.filter((table) => !ok(table)).map((table) => table.name);
  if (bad.length > 0)
    problems.push(`${what}：${bad.slice(0, 8).join("、")}${bad.length > 8 ? " 等" : ""}`);
  return bad.length === 0;
}
const has = (set, privilege) => set.split(",").includes(privilege);
expectAll(
  logical,
  (t) => has(t.app, "SELECT") && has(t.app, "INSERT"),
  "lyx_app 少了 SELECT 或 INSERT 的表",
);
expectAll(
  tables,
  (t) => !["TRUNCATE", "REFERENCES", "TRIGGER"].some((p) => has(t.app, p)),
  "lyx_app 多出 TRUNCATE、REFERENCES 或 TRIGGER 的表",
);
expectAll(tables, (t) => t.public === "", "PUBLIC 有权限的表");
if (expectAll(others, (t) => t.app === "", "lyx_app 能直接碰的分区子表或 _prisma_migrations"))
  note(`分区子表与 _prisma_migrations（${others.length} 张）：lyx_app 没有任何权限`);

const appendOnly = Object.keys(APPEND_ONLY).map(
  (name) =>
    logical.find((table) => table.name === name) ?? {
      name,
      app: "（库里没有这张表）",
      app_columns: [],
    },
);
const tableOk = expectAll(
  appendOnly,
  (t) => t.app === "INSERT,SELECT",
  "只增表上 lyx_app 的表级权限不是恰好 INSERT、SELECT",
);
const columnOk = expectAll(
  appendOnly,
  (t) =>
    has(t.app, "UPDATE") || t.app_columns.join(",") === [...APPEND_ONLY[t.name]].sort().join(","),
  "只增表上 lyx_app 的列级 UPDATE 与清单不符",
);
if (tableOk && columnOk) {
  const columns = Object.entries(APPEND_ONLY).flatMap(([t, list]) =>
    list.map((column) => `${t}.${column}`),
  );
  note(
    `只增表 ${appendOnly.length} 张：改、删、清空都没有权限；列级 UPDATE 只有 ${columns.length} 列（${columns.join("、")}）`,
  );
}
const fileObject = logical.find((table) => table.name === "file_object");
if (fileObject && !has(fileObject.app, "DELETE"))
  note(`file_object：${fileObject.app}，没有 DELETE`);
else problems.push("file_object 上 lyx_app 有 DELETE，或库里没有这张表");

const sequences = catalog.sequences ?? [];
if (expectAll(sequences, (s) => s.app === "USAGE", "lyx_app 的权限不是恰好 USAGE 的序列"))
  note(`序列 ${sequences.length} 个：lyx_app 都有 USAGE（取号），没有 UPDATE（改当前值）`);

const purge = catalog.definers.find((fn) => fn.name === "lyx_03_purge_auth_event");
const definersOk = expectAll(
  catalog.definers,
  (fn) => !/lyx_readonly|public/.test(fn.who),
  "PUBLIC 或 lyx_readonly 可执行的属主身份函数",
);
if (purge?.who !== "lyx_app") problems.push("lyx_03_purge_auth_event 不是只有 lyx_app 可执行");
else if (definersOk)
  note(
    `以属主身份执行的函数 ${catalog.definers.length} 个（${catalog.definers.map((fn) => fn.name).join("、")}）：只有 lyx_app 可执行`,
  );

const readable = expectAll(
  tables,
  (t) => t.readonly === "SELECT",
  "lyx_readonly 的权限不是恰好 SELECT 的表",
);
const seqReadable = expectAll(
  sequences,
  (s) => s.readonly === "SELECT",
  "lyx_readonly 的权限不是恰好 SELECT 的序列",
);
if (catalog.defaults < 2)
  problems.push("没有给 lyx_readonly 的缺省授权（表与序列各一条）：以后新建的分区它读不到");
if (readable && seqReadable && catalog.defaults >= 2)
  note(
    `lyx_readonly：${tables.length} 张表（含分区子表与 _prisma_migrations）、${sequences.length} 个序列都只读；缺省授权 ${catalog.defaults} 条`,
  );

// 分区表：以当前账号插一行、读回来、回滚
const probe = run(`
begin;
insert into analytics_event (occurred_at, id, event_id, name, source, actor_type)
  values (now(), gen_random_uuid(), 'verify-' || gen_random_uuid(), 'verify_grants', 'direct', 'system')
  returning tableoid::regclass::text;
select count(*) from analytics_event where name = 'verify_grants';
rollback;`);
const [partition, count] = probe.lines;
if (!probe.ok) problems.push(`分区表写入或查询没成：${probe.error}`);
else if (!/^analytics_event_y\d{4}m\d{2}$/.test(partition ?? "") || count !== "1")
  problems.push(`分区表：写入的行落在 ${partition}（应是当月的分区），读回 ${count} 行`);
else note(`分区表：写入一行落在 ${partition}，经父表读得回；已回滚，库里不留数据`);

if (problems.length > 0) {
  console.log(`\n结论：不通过。${problems.join("；")}`);
  process.exit(1);
}
console.log("\n结论：通过。角色在，授权生效，分区表可写可查");
