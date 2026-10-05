// W0-06a 的检查：授权下限清单（infra/ci/grants-floor.txt）。一个普通的改动把一张只增表（积分流水 point_ledger_entry）悄悄放开：
// 库里多授 UPDATE、DELETE（相当于新加一个迁移），期望数据同步改掉（那一行改成全套读写，并从只增清单里拿掉），
// 下限清单不动。期望与库里的授权互相对得上，逐表的核对查不出来；核对必须因为超过下限而失败，并指出是哪张表。
// 核对脚本不再读下限清单、或只拿它比期望不比库里的授权时，这一例会红。
// 放开哪张表是现挑的：清单里上限恰好是 INSERT、SELECT、不带例外列的只增表，有积分流水就用它，没有就取第一张。
// 这样以后用门禁 PR 把某一张表的上限改大时，这个反例不用跟着改。
// 期望数据的路径写死在核对脚本里：这里把脚本、它引的两份、下限清单原样拷到仓库外的临时目录，期望数据换成改过的，在副本里跑。
// 要本地那套 PostgreSQL 在运行（pnpm infra:up），并给出 DATABASE_URL 或 PG* 环境变量（CLAUDE.md 第 9 节）；
// 自己建一个 lyx_selftest_ 开头的库，用完删掉。连不上时这一例会红，不会被悄悄跳过。
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { FLOOR_FILE, parseFloor } from "../../db-grants-rules.mjs";
import { dropDb, pgEnv, recreateDb, sqlOrThrow } from "../../db-lib.mjs";

const MIGRATIONS = "packages/db/prisma/migrations";
const EXPECTED = "packages/db/src/grants.expected.json";
const COPIED = ["db-verify-grants.mjs", "db-grants-rules.mjs", "db-lib.mjs", "grants-floor.txt"];
const FULL = "DELETE,INSERT,SELECT,UPDATE";

const fromRepo = (path) => readFileSync(new URL(`../../../../${path}`, import.meta.url), "utf8");
const floor = parseFloor(fromRepo(FLOOR_FILE));
const committed = JSON.parse(fromRepo(EXPECTED));
const candidates = committed.appendOnly.filter(
  (table) =>
    floor.tables.get(table)?.max.join(",") === "INSERT,SELECT" &&
    !Object.hasOwn(committed.columnUpdate, table),
);
const TABLE = candidates.includes("point_ledger_entry") ? "point_ledger_entry" : candidates[0];
if (TABLE === undefined)
  throw new Error(`${FLOOR_FILE} 里没有上限是 INSERT、SELECT 的只增表：这个反例没有表可试`);

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
  gate: "授权下限清单（db:verify-grants 读 infra/ci/grants-floor.txt）",
  mutation: `库里把 ${TABLE} 的 UPDATE、DELETE 授给 lyx_app，期望数据同步改成全套读写并从只增清单里拿掉，下限清单不动`,
  reason: new RegExp(
    `结论：不通过。期望的授权超过下限清单（${FLOOR_FILE}）：${TABLE}（期望 ${FULL}，下限只许 INSERT,SELECT）；` +
      `库里的授权超过下限清单（${FLOOR_FILE}）：${TABLE}（实际 ${FULL}，下限只许 INSERT,SELECT）$`,
    "m",
  ),
  run(ctx) {
    const db = `lyx_selftest_floor_${process.pid}`;
    try {
      recreateDb(db);
      const dirs = readdirSync(join(ctx.repoRoot, MIGRATIONS), { withFileTypes: true })
        .flatMap((entry) => (entry.isDirectory() ? [entry.name] : []))
        .sort();
      for (const dir of dirs) {
        const sql = readFileSync(join(ctx.repoRoot, MIGRATIONS, dir, "migration.sql"), "utf8");
        sqlOrThrow(db, `begin;\n${sql}\ncommit;`);
      }
      const expected = committed;
      const copy = ctx.tempDir();
      const script = join(copy, "infra/ci/db-verify-grants.mjs");
      const files = Object.fromEntries(
        COPIED.map((file) => [
          `infra/ci/${file}`,
          readFileSync(join(ctx.repoRoot, "infra/ci", file), "utf8"),
        ]),
      );
      const env = { DATABASE_URL: urlOf(db) };
      // 没动手脚之前，副本里要先是通过的：否则下面的失败说明不了什么（退出码 2 是连不上库）
      ctx.writeFiles(copy, { ...files, [EXPECTED]: JSON.stringify(expected) });
      const clean = ctx.run("node", [script], { cwd: copy, env });
      if (clean.status !== 0) throw new Error(clean.output.trim().split("\n").slice(-2).join(" "));
      sqlOrThrow(db, `GRANT UPDATE, DELETE ON ${TABLE} TO lyx_app`);
      const opened = {
        ...expected,
        tables: { ...expected.tables, [TABLE]: FULL },
        appendOnly: expected.appendOnly.filter((table) => table !== TABLE),
      };
      ctx.writeFiles(copy, { [EXPECTED]: JSON.stringify(opened) });
      return ctx.run("node", [script], { cwd: copy, env });
    } finally {
      dropDb(db);
    }
  },
};
