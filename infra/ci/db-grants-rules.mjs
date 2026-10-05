// 角色与授权的判定规则（W0-06a）：核对脚本 db-verify-grants.mjs 里不连库的那一半。
// CATALOG_SQL 一条语句把系统目录读成一个 JSON 文档；judge() 拿它与期望的授权逐项比，
// 返回报告行（notes）、不通过的原因（problems）、只列出请人过目的条目（review）。
// 拆成单独的文件，是为了用例能不动实例就验到规则：成员关系与角色属性是整个实例共用的，在共用的实例上
// 动手脚会让同时在跑的别的核对误报，那几条规则的用例拿改过的目录文档来验（infra/ci/test/db-verify-grants.test.ts）。
// 本文件不引依赖，不连库，自己不是命令。

export const EXPECTED_FILE = "packages/db/src/grants.expected.json";
export const ROLES = ["lyx_app", "lyx_readonly"];
/** 最低的服务器版本：成员关系上的“继承、可切换”两列与 pg_has_role 的 SET 都是 PostgreSQL 16 才有的 */
export const MIN_VERSION_NUM = 160000;

const [APP, READONLY] = ROLES;
const ROLE_LIST = `'${ROLES.join("', '")}'`;
/** 常规读写的表上 lyx_app 的权限；期望里不是它的表算“受限的表”（只增、不给删除、不给改） */
const FULL = "DELETE,INSERT,SELECT,UPDATE";
const KIND = {
  table: "表",
  column: "列",
  sequence: "序列",
  relation: "视图等",
  function: "函数",
  schema: "模式",
  database: "库",
};
/** 缺省授权管的对象种类（pg_default_acl.defaclobjtype） */
const FUTURE = { r: "表", S: "序列", f: "函数", T: "类型", n: "模式", L: "大对象" };

/** 服务器版本够不够；不够时返回一句说明，够则返回 null */
export function versionProblem(versionNum, versionText) {
  if (Number(versionNum) >= MIN_VERSION_NUM) return null;
  return `服务器是 PostgreSQL ${versionText}，本脚本要 16 及以上（用到 16 才有的系统目录列；托管库定的是 17）。在 16 以下的实例上跑不了，不是授权有问题`;
}

/** 一类对象的访问控制列表逐条展开：种类、对象名、被授权者（owned 表示就是属主自己）、权限、是否带转授权 */
const aclOf = (kind, name, owner, acl, from, extra = "") =>
  `select ${kind} as kind, ${name} as name, x.grantee = ${owner} as owned,
          case when x.grantee = 0 then 'PUBLIC' else x.grantee::regrole::text end as grantee,
          x.privilege_type as privilege, x.is_grantable as grantable${extra}
     from ${from}, aclexplode(${acl}) x`;
const IN_PUBLIC = "= 'public'::regnamespace";
/** 表与序列之外的关系：public 里的视图、物化视图、外部表，以及别的模式里的任何关系。扩展带进来的不算 */
const OTHER_FROM = "pg_class c join pg_namespace n on n.oid = c.relnamespace";
const OTHER_WHERE = `n.nspname !~ '^pg_' and n.nspname <> 'information_schema'
       and (c.relkind in ('v', 'm', 'f') or (n.nspname <> 'public' and c.relkind in ('r', 'p', 'S')))
       and not exists (select 1 from pg_depend e
                        where e.classid = 'pg_class'::regclass and e.objid = c.oid and e.deptype = 'e')`;

// 一条语句把授权读成一个 JSON 文档。acl 里是写明了的授权（不按“有效权限”问）：这样 MAINTAIN 这类新权限、转授权、
// 授给别的角色的都看得见。两个角色不是别的角色的成员（roles 里核对），所以它们的有效权限就是自己名下的加 PUBLIC 的。
// 以属主身份执行的函数、模式、库没有写明授权时按缺省的算（函数缺省所有人可执行）。schema 里问的是有效权限。
// members：两个角色的成员，连同成员的成员。uses 表示这条成员关系真的带来权限（继承，或可以切换过去）；
// others 是它另外加入的角色（同样只算带来权限的）；connect、create 问的是这个成员的有效权限。
export const CATALOG_SQL = `
with recursive chain(role, member, admin, uses) as (
  select a.roleid::regrole::text, a.member, a.admin_option, a.inherit_option or a.set_option
    from pg_auth_members a where a.roleid::regrole::text in (${ROLE_LIST})
  union
  select k.role, a.member, a.admin_option, k.uses and (a.inherit_option or a.set_option)
    from chain k join pg_auth_members a on a.roleid = k.member
)
select json_build_object(
  'me', (select json_build_object('name', r.rolname, 'super', r.rolsuper, 'createrole', r.rolcreaterole,
           'set_app', pg_has_role('${APP}', 'SET'),
           'owner', (select bool_and(c.relowner = r.oid) from pg_class c
                      where c.relnamespace ${IN_PUBLIC} and c.relkind in ('r', 'p')))
           from pg_roles r where r.rolname = current_user),
  'roles', (select json_agg(r.rolname || ' ' || concat_ws(',', r.rolcanlogin, r.rolsuper, r.rolcreatedb,
        r.rolcreaterole, r.rolreplication, r.rolbypassrls)
        || ' ' || (select count(*) from pg_auth_members m where m.member = r.oid) order by r.rolname)
    from pg_roles r where r.rolname in (${ROLE_LIST})),
  'members', (select coalesce(json_agg(json_build_object('role', k.role, 'name', r.rolname, 'super', r.rolsuper,
        'admin', k.admin, 'uses', k.uses,
        'connect', has_database_privilege(r.oid, current_database(), 'CONNECT'),
        'create', has_schema_privilege(r.oid, 'public', 'CREATE')
                  or has_database_privilege(r.oid, current_database(), 'CREATE'),
        'others', (select coalesce(json_agg(o.roleid::regrole::text order by o.roleid::regrole::text), '[]')
                     from pg_auth_members o
                    where o.member = r.oid and (o.inherit_option or o.set_option)
                      and o.roleid::regrole::text not in (${ROLE_LIST})
                      and o.roleid not in (select member from chain))) order by k.role, r.rolname), '[]')
    from (select role, member, bool_or(admin) as admin, bool_or(uses) as uses from chain group by 1, 2) k
    join pg_roles r on r.oid = k.member),
  'tables', (select coalesce(json_agg(json_build_object('name', c.relname, 'owner', c.relowner::regrole::text,
      'logical', not c.relispartition and c.relname <> '_prisma_migrations') order by c.relname), '[]')
    from pg_class c where c.relnamespace ${IN_PUBLIC} and c.relkind in ('r', 'p')),
  'sequences', (select coalesce(json_agg(json_build_object('name', c.relname, 'owner', c.relowner::regrole::text)
      order by c.relname), '[]')
    from pg_class c where c.relnamespace ${IN_PUBLIC} and c.relkind = 'S'),
  'relations', (select coalesce(json_agg(c.oid::regclass::text order by c.oid::regclass::text), '[]')
    from ${OTHER_FROM} where ${OTHER_WHERE}),
  'definers', (select coalesce(json_agg(p.proname order by p.proname), '[]')
    from pg_proc p where p.pronamespace ${IN_PUBLIC} and p.prosecdef),
  'schema', (select json_object_agg(r, json_build_object('usage', has_schema_privilege(r, 'public', 'USAGE'),
      'create', has_schema_privilege(r, 'public', 'CREATE'),
      'db_create', has_database_privilege(r, current_database(), 'CREATE'),
      'connect', has_database_privilege(r, current_database(), 'CONNECT')))
    from unnest(array[${ROLE_LIST}]) r),
  'acl', (select coalesce(json_agg(e), '[]') from (
    ${aclOf("case c.relkind when 'S' then 'sequence' else 'table' end", "c.relname::text", "c.relowner", "c.relacl", "pg_class c")}
     where c.relnamespace ${IN_PUBLIC} and c.relkind in ('r', 'p', 'S')
    union all
    ${aclOf("'relation'", "c.oid::regclass::text", "c.relowner", "c.relacl", OTHER_FROM)}
     where ${OTHER_WHERE}
    union all
    ${aclOf("'column'", "c.relname || '.' || a.attname", "c.relowner", "a.attacl", "pg_class c join pg_attribute a on a.attrelid = c.oid")}
     where c.relnamespace ${IN_PUBLIC} and c.relkind in ('r', 'p', 'v', 'm', 'f')
    union all
    ${aclOf("'function'", "p.proname::text", "p.proowner", "case when p.prosecdef then coalesce(p.proacl, acldefault('f', p.proowner)) else p.proacl end", "pg_proc p")}
     where p.pronamespace ${IN_PUBLIC}
    union all
    ${aclOf("'schema'", "n.nspname::text", "n.nspowner", "coalesce(n.nspacl, acldefault('n', n.nspowner))", "pg_namespace n")}
     where n.nspname = 'public'
    union all
    ${aclOf("'database'", "d.datname::text", "d.datdba", "coalesce(d.datacl, acldefault('d', d.datdba))", "pg_database d")}
     where d.datname = current_database()) e),
  'defaults', (select coalesce(json_agg(e), '[]') from (
    ${aclOf("d.defaclobjtype", "case when d.defaclnamespace = 0 then '' else d.defaclnamespace::regnamespace::text end", "d.defaclrole", "d.defaclacl", "pg_default_acl d", ", d.defaclrole::regrole::text as role")}) e))`;

/**
 * 拿目录文档与期望的授权逐项比。
 * catalog 是 CATALOG_SQL 的结果；expected 是 packages/db/src/grants.expected.json 的内容。
 * 返回 { notes, problems, review }：notes 是逐项的报告行；problems 不空即不通过；
 * review 是不判不通过、但要人看一眼的条目（写明哪个角色、哪个对象、什么权限）。
 */
export function judge(catalog, expected) {
  const notes = [];
  const problems = [];
  const review = [];
  const note = (line) => notes.push(line);
  const { me, tables } = catalog;
  const sequences = catalog.sequences.map((sequence) => sequence.name);
  /** 账号名：连库用的那个账号不写名字（输出里不带连接信息） */
  const who = (name) => (name === me.name ? "当前账号" : name);
  const yes = (flag) => (flag ? "是" : "否");

  /** 有不合的就记成一条问题（最多列 8 个）；返回是否全合 */
  function check(what, bad) {
    const list = [...new Set(bad)];
    if (list.length > 0)
      problems.push(
        `${what}：${list.slice(0, 8).join("、")}${list.length > 8 ? ` 等 ${list.length} 个` : ""}`,
      );
    return list.length === 0;
  }

  const odd = catalog.roles.filter((line) => !line.endsWith(" f,f,f,f,f,f 0"));
  if (odd.length > 0)
    problems.push(`角色的属性不对（可登录、有特权属性，或是别的角色的成员）：${odd.join("；")}`);
  else note(`角色：${ROLES.join("、")} 都在，不可登录，没有特权属性，不是别的角色的成员`);
  note(
    `当前账号：超级用户 ${yes(me.super)}，可建角色 ${yes(me.createrole)}，是全部表的属主 ${yes(me.owner)}，可切换到 lyx_app ${yes(me.set_app)}`,
  );

  // 属主：表都该属于跑迁移的那个账号（多数表的属主）。属主能停掉触发器、能再授权，不受下面这些授权限制
  const owned = new Map();
  for (const table of tables) owned.set(table.owner, (owned.get(table.owner) ?? 0) + 1);
  const [migrator] = [...owned].sort((a, b) => b[1] - a[1])[0];
  check(
    "属主与多数表不同的表或序列（都该属于跑迁移的那个账号）",
    [...tables, ...catalog.sequences]
      .filter((object) => object.owner !== migrator)
      .map((object) => `${object.name}（属主 ${who(object.owner)}）`),
  );
  check(
    "属主是 lyx_app 或 lyx_readonly 的表",
    tables.filter((table) => ROLES.includes(table.owner)).map((table) => table.name),
  );

  // 成员：实际连库的是成员（两个角色不可登录）。跑迁移的账号是表的属主，本来就不受授权限制，不在这里判
  const members = catalog.members.filter((member) => member.name !== migrator);
  const users = members.filter((member) => member.uses);
  const tag = (member) => `${member.role} 的成员 ${who(member.name)}`;
  const membersOk = [
    check("成员是超级用户（不受任何授权限制）", users.filter((member) => member.super).map(tag)),
    check(
      "成员带 ADMIN OPTION（能把别的账号加进这个角色）",
      users.filter((member) => member.admin).map(tag),
    ),
    check(
      "成员另是别的角色的成员（带来这两个角色之外的权限）",
      users
        .filter((member) => member.others.length > 0)
        .map((member) => `${tag(member)}（另属 ${member.others.join("、")}）`),
    ),
    check(
      "成员能在模式 public 或库里建对象（有 CREATE）",
      users.filter((member) => member.create && !member.super).map(tag),
    ),
    // 库的 CONNECT：有成员就看成员连不连得上；还没有成员时看角色自己（以后的成员靠它继承）
    check(
      "连不上这个库（没有 CONNECT）",
      ROLES.flatMap((role) => {
        const mine = users.filter((member) => member.role === role);
        if (mine.length > 0) return mine.filter((member) => !member.connect).map(tag);
        return catalog.schema[role].connect ? [] : [`${role}（还没有成员，角色自己也没有）`];
      }),
    ),
  ].every(Boolean);
  if (membersOk)
    note(
      users.length === 0
        ? "成员：两个角色都还没有成员（应用与备份的登录账号由环境初始化加进来）；库的 CONNECT 没有被收回"
        : `成员：${ROLES.map((role) => `${role} ← ${users.flatMap((member) => (member.role === role ? [who(member.name)] : [])).join("、") || "还没有"}`).join("；")}。都连得上这个库，不是超级用户，不带 ADMIN OPTION，不另属别的角色`,
    );
  for (const member of members.filter((member) => !member.uses))
    review.push(
      member.admin
        ? `${who(member.name)} 能管理 ${member.role} 的成员关系（带 ADMIN OPTION；自己不继承、不能切换过去。PostgreSQL 16 起，不是超级用户的账号建了角色就自动带上）`
        : `${who(member.name)} 是 ${member.role} 的成员，但不继承、不能切换过去（这条成员关系不带来权限）`,
    );

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
  const label = ({ kind, name, grantee, privileges }) =>
    `${KIND[kind]} ${name}（${grantee} ${privileges.join(",")}）`;

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
  if (
    check(
      "lyx_app 能直接碰的分区子表或 _prisma_migrations",
      others.filter((name) => held("table", name, APP) !== ""),
    )
  )
    note(`分区子表与 _prisma_migrations（${others.length} 张）：lyx_app 没有任何权限`);

  // 列级授权：lyx_app 只有期望里写的那几列 UPDATE；lyx_readonly 与 PUBLIC 一列也没有（视图等上面的列也算）
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

  // 表与序列之外的关系（视图、物化视图、外部表，别的模式里的对象）：属主建一张视图套在表上再授出去，
  // 就能绕开表上的授权。期望之外的一律不通过：lyx_app 只许对期望里 views 列出的有 SELECT；lyx_readonly 最多 SELECT
  const views = expected.views ?? [];
  if (
    [
      check(
        "期望清单的 views 里有而库里没有的视图",
        views.filter((name) => !catalog.relations.includes(name)),
      ),
      check(
        "表与序列之外的关系（视图、物化视图、外部表，或别的模式里的对象）上，期望之外的授权",
        [...grants.values()]
          .filter(
            ({ kind, grantee }) => kind === "relation" && [...ROLES, "PUBLIC"].includes(grantee),
          )
          .filter(({ name, grantee, privileges }) =>
            privileges.join(",") === "SELECT"
              ? grantee !== READONLY && !(grantee === APP && views.includes(name))
              : true,
          )
          .map(label),
      ),
    ].every(Boolean)
  )
    note(
      `表与序列之外的关系（视图、物化视图、外部表，别的模式里的对象）${catalog.relations.length} 个：两个角色与 PUBLIC 没有期望之外的授权`,
    );

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
  // 缺省授权（以后新建的对象自动带上的）：只该有两条，都挂在跑迁移的账号名下、限在模式 public 里，
  // 给 lyx_readonly 的 SELECT，表（r）与序列（S）各一条。别的种类（函数、类型、模式）也读出来，多一条都不行
  const defaults = catalog.defaults.filter((entry) => !entry.owned);
  const isKept = (entry) =>
    entry.grantee === READONLY &&
    entry.privilege === "SELECT" &&
    entry.role === migrator &&
    entry.name === "public" &&
    ["r", "S"].includes(entry.kind);
  const kept = defaults.filter(isKept);
  const future = (entry) =>
    `${entry.grantee} ${entry.privilege}（以后新建的${FUTURE[entry.kind] ?? entry.kind}；${entry.name === "" ? "不限模式" : `模式 ${entry.name}`}，挂在 ${who(entry.role)} 名下）`;
  const defaultsOk = ["r", "S"].every((type) => kept.some((entry) => entry.kind === type));
  if (!defaultsOk)
    problems.push(
      "没有给 lyx_readonly 的缺省授权（表与序列各一条，挂在跑迁移的账号名下）：以后新建的分区它读不到",
    );
  const noExtraDefaults = check(
    "期望之外的缺省授权（以后新建的表、序列会自动带上）",
    defaults
      .filter((entry) => !isKept(entry))
      .filter(
        (entry) => [...ROLES, "PUBLIC"].includes(entry.grantee) || entry.privilege !== "SELECT",
      )
      .map(future),
  );
  if (readable && seqReadable && defaultsOk && noExtraDefaults)
    note(
      `lyx_readonly：${tables.length} 张表（含分区子表与 _prisma_migrations）、${sequences.length} 个序列都只读；缺省授权 ${kept.length} 条`,
    );

  // 转授权：属主以外谁也不该带（带了就能把权限再授给别人）。缺省授权里的也算
  const noGrantOption = check("带转授权（WITH GRANT OPTION）的授权", [
    ...catalog.acl
      .filter((entry) => !entry.owned && entry.grantable)
      .map((entry) => label({ ...entry, privileges: [entry.privilege] })),
    ...defaults.filter((entry) => entry.grantable).map((entry) => `缺省授权 ${future(entry)}`),
  ]);
  // 别的角色（这两个角色与 PUBLIC 之外的）。不通过的：受限的表（连同分区子表与 _prisma_migrations）、序列、
  // 视图等上面有查询以外的权限。序列也按受限的算：15 个里 14 个给只增表排号（另一个是员工编号），
  // 能改当前值（UPDATE，即 setval）就能让编号回退、撞号；备份只要 SELECT。
  // 其余的不判不通过，逐条列出请人过目：受限对象上只有查询；常规读写的表上的任何授权；缺省授权里只给查询的
  const restricted = Object.keys(want)
    .filter((name) => want[name] !== FULL)
    .concat(others);
  const strangers = [...grants.values()].filter(
    ({ kind, grantee }) =>
      /table|column|sequence|relation/.test(kind) && ![...ROLES, "PUBLIC"].includes(grantee),
  );
  const isRestricted = ({ kind, name }) =>
    /sequence|relation/.test(kind) || restricted.includes(name.split(".")[0]);
  const writes = (grant) =>
    isRestricted(grant) && grant.privileges.some((privilege) => privilege !== "SELECT");
  const noWriters = check(
    "只增表或不给改、删的表上，别的角色有查询以外的权限",
    strangers.filter((grant) => writes(grant) && !/sequence|relation/.test(grant.kind)).map(label),
  );
  const noSequenceWriters = check(
    "序列、视图等上面，别的角色有查询以外的权限",
    strangers.filter((grant) => writes(grant) && /sequence|relation/.test(grant.kind)).map(label),
  );
  for (const grant of strangers.filter((entry) => !writes(entry)))
    review.push(
      `${who(grant.grantee)} 在${KIND[grant.kind]} ${grant.name} 上有 ${grant.privileges.join(",")}`,
    );
  for (const entry of defaults.filter(
    (item) => ![...ROLES, "PUBLIC"].includes(item.grantee) && item.privilege === "SELECT",
  ))
    review.push(`缺省授权：${future(entry)}`);
  if (noGrantOption && noWriters && noSequenceWriters)
    note(
      "转授权：没有。别的角色在受限的表（只增、不给改删、分区子表、_prisma_migrations）、序列、视图等上面没有查询以外的权限",
    );

  return { notes, problems, review };
}
