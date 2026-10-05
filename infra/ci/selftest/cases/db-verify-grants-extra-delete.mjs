// W0-06a 的检查：角色与授权的核对（pnpm db:verify-grants）。跑完全部迁移的库上，把审计日志的 DELETE 授给应用角色之后，
// 核对必须失败，并指出是哪张表。自己建一个 lyx_selftest_ 开头的库，用完删掉，不碰共享的库。
// 核对脚本不再查只增表、或只数张数不看权限时，这一例会红。
// 要本地那套 PostgreSQL 在运行（pnpm infra:up），并给出 DATABASE_URL 或 PG* 环境变量（CLAUDE.md 第 9 节）；
// 连不上时这一例会红，不会被悄悄跳过。
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { dropDb, pgEnv, recreateDb, sqlOrThrow } from "../../db-lib.mjs";

const MIGRATIONS = "packages/db/prisma/migrations";

/** 核对脚本只认 DATABASE_URL：由现有的连接参数拼一个指向这个库的 */
function urlOf(db) {
  const env = { ...process.env, ...pgEnv() };
  const url = new URL("postgresql://localhost");
  url.hostname = env.PGHOST;
  url.port = env.PGPORT ?? "5432";
  url.username = env.PGUSER ?? "";
  url.password = env.PGPASSWORD ?? "";
  url.pathname = `/${db}`;
  return url.toString();
}

export default {
  gate: "角色与授权的核对（db:verify-grants）",
  mutation: "跑完全部迁移的库上，把 audit_log 的 DELETE 授给 lyx_app",
  reason: /结论：不通过。.*只增表上 lyx_app 的表级权限不是恰好 INSERT、SELECT：audit_log/,
  run(ctx) {
    const db = `lyx_selftest_grants_${process.pid}`;
    try {
      recreateDb(db);
      const dirs = readdirSync(join(ctx.repoRoot, MIGRATIONS), { withFileTypes: true })
        .flatMap((entry) => (entry.isDirectory() ? [entry.name] : []))
        .sort();
      for (const dir of dirs) {
        const sql = readFileSync(join(ctx.repoRoot, MIGRATIONS, dir, "migration.sql"), "utf8");
        sqlOrThrow(db, `begin;\n${sql}\ncommit;`);
      }
      const env = { DATABASE_URL: urlOf(db) };
      const clean = ctx.node("infra/ci/db-verify-grants.mjs", [], { env });
      // 没动手脚之前要先是通过的：否则下面的失败说明不了什么（退出码 2 是连不上库）
      if (clean.status !== 0) throw new Error(clean.output.trim().split("\n").slice(-2).join(" "));
      sqlOrThrow(db, "GRANT DELETE ON audit_log TO lyx_app");
      return ctx.node("infra/ci/db-verify-grants.mjs", [], { env });
    } finally {
      dropDb(db);
    }
  },
};
