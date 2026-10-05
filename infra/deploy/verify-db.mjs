#!/usr/bin/env node
// 狸有戏 · 预发节点步骤 verify-db 在一次性容器里跑的核对（W2-25 任务书 第 7 节第 3 条）。
// 不在宿主机上跑：由 infra/compose/node.yml 的 verify-db 服务只读挂进 server 镜像（/app/infra/deploy/），
// 用镜像里的 psql 与 /app/infra/ci/ 下的角色与授权核对脚本。
//
// 查什么：
//   1. 迁移账号连得上，连的库名是预发的库名（LYX_DB_NAME）；btree_gist、pg_trgm 两个扩展已装
//   2. 应用用的连接串（DATABASE_URL_FILE）连上去是登录账号：是 lyx_app 的成员；不是超级用户，不能建库、建角色；
//      不是库的属主，名下一张表都没有（表的属主是迁移账号）
//   3. 角色与授权：node infra/ci/db-verify-grants.mjs --database <库名>（与 pnpm db:verify-grants 是同一份核对）
// 两份连接串从 /run/secrets 下的文件读，只进子进程的环境变量：不进命令行参数，不打印。
// 只读，另有 db-verify-grants 那一处插完即回滚的写入。退出码：0 通过；1 有一项没过；2 环境不对。
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { pgEnv, psql } from "../ci/db-lib.mjs";

const EXTENSIONS = ["btree_gist", "pg_trgm"];
const MIGRATOR_URL_FILE = "/run/secrets/migrator-database-url";

function stop(code, message) {
  console.error(`库的核对：${message}`);
  process.exit(code);
}

/** 读一份连接串文件；只报是哪一份，不报内容 */
function readUrl(file, what) {
  try {
    const text = readFileSync(file, "utf8").trim();
    if (text === "") throw new Error("空的");
    return text;
  } catch {
    return stop(2, `读不了${what}的连接串文件`);
  }
}

const dbName = process.env.LYX_DB_NAME?.trim();
if (!dbName) stop(2, "没给 LYX_DB_NAME");
const appUrlFile = process.env.DATABASE_URL_FILE?.trim();
if (!appUrlFile) stop(2, "没给 DATABASE_URL_FILE");
const migratorUrl = readUrl(MIGRATOR_URL_FILE, "迁移账号");
const appUrl = readUrl(appUrlFile, "应用");

/** 在一个连接上跑一句查询，返回按 | 分开的一行；连不上或出错即停（报错不带连接参数） */
function query(url, what, sql) {
  let env;
  try {
    env = pgEnv({ DATABASE_URL: url }, { database: true });
  } catch {
    return stop(2, `${what}的连接串不是合法的写法`);
  }
  const result = psql(env.PGDATABASE, sql, env);
  if (result.status !== 0) {
    const secrets = [url, env.PGPASSWORD, env.PGHOST, env.PGUSER].filter(
      (value) => value && value.length >= 3,
    );
    let detail = result.stderr.trim();
    for (const secret of secrets) detail = detail.split(secret).join("…");
    return stop(1, `用${what}的连接串连库或查询没成：${detail}`);
  }
  return result.stdout.trim().split("|");
}

let failed = 0;
function check(what, pass, seen) {
  console.log(`${pass ? "  通过  " : "  不通过"} ${what}${pass ? "" : `（看到的是：${seen}）`}`);
  if (!pass) failed += 1;
}

console.log("## 库与账号");
const [database, extensions] = query(
  migratorUrl,
  "迁移账号",
  `SELECT current_database(), (SELECT string_agg(extname, ',' ORDER BY extname) FROM pg_extension WHERE extname IN (${EXTENSIONS.map((name) => `'${name}'`).join(", ")}))`,
);
check(`库名是 ${dbName}`, database === dbName, database);
check(`扩展 ${EXTENSIONS.join("、")} 已装`, extensions === EXTENSIONS.join(","), extensions);

const [appDatabase, member, privileged, ownsDatabase, ownedTables] = query(
  appUrl,
  "应用",
  `SELECT current_database(),
     pg_has_role(current_user, 'lyx_app', 'USAGE') AND current_user <> 'lyx_app',
     (SELECT rolsuper OR rolcreatedb OR rolcreaterole FROM pg_roles WHERE rolname = current_user),
     (SELECT datdba = (SELECT oid FROM pg_roles WHERE rolname = current_user) FROM pg_database WHERE datname = current_database()),
     (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND pg_get_userbyid(c.relowner) = current_user)`,
);
check("应用连的是同一个库", appDatabase === dbName, appDatabase);
check("应用连库用的是登录账号：lyx_app 的成员，不是 lyx_app 自己", member === "t", member);
check("应用的登录账号不是超级用户，不能建库、建角色", privileged === "f", privileged);
check(
  "应用的登录账号不是库的属主，名下没有表",
  ownsDatabase === "f" && ownedTables === "0",
  `库的属主=${ownsDatabase}，名下的表=${ownedTables}`,
);

console.log("\n## 角色与授权（infra/ci/db-verify-grants.mjs）");
const grants = spawnSync(
  process.execPath,
  [new URL("../ci/db-verify-grants.mjs", import.meta.url).pathname, "--database", dbName],
  { stdio: "inherit", env: { ...process.env, DATABASE_URL: migratorUrl } },
);
if (grants.status !== 0) {
  console.log(`  不通过 角色与授权核对（退出码 ${grants.status}）`);
  failed += 1;
}

if (failed > 0) stop(1, `有 ${failed} 项没过`);
console.log("\n库的核对：通过");
