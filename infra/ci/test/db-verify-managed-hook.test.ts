import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { afterAll, describe, expect, it, vi } from "vitest";

import { repoRoot } from "./helpers.js";

// 托管库验证的后置钩子（W0-06a 任务书 第 7 节第 10 条）。“角色与授权”一段不在 db-verify-managed.mjs 里：
// 根脚本 postdb:verify-managed 把 db-verify-grants.mjs 接在它后面，靠的是 pnpm 缺省会执行前后置脚本。
// 这里经 pnpm 把 pnpm db:verify-managed 整条跑一遍，把“报告末尾多出这一段”钉住：
// 钩子被删、被改名，或 pnpm 不再缺省执行前后置脚本，这里就红。钩子的失败传不出来（比如命令后面接了“|| true”）也红。
// 直接 node infra/ci/db-verify-managed.mjs、或关掉前后置脚本时没有这一段（packages/db/README.md 第 7 节）。
// 先 pnpm infra:up 并给出 DATABASE_URL（CLAUDE.md 第 9 节）；连不上即失败。只建、删自己的库 lyx_test_infra_hook_<进程号>。

interface DbLib {
  recreateDb(name: string): void;
  dropDb(name: string): void;
  sqlOrThrow(db: string, sql: string): string;
}
const lib = (await import(pathToFileURL(join(repoRoot, "infra/ci/db-lib.mjs")).href)) as DbLib;

// 一遍要跑完全部迁移再核对；全仓用例并行跑时库很忙
vi.setConfig({ testTimeout: 180_000, hookTimeout: 120_000 });

const base = process.env.DATABASE_URL;
if (!base)
  throw new Error("DATABASE_URL 未设置：这份用例要连本地的 PostgreSQL（CLAUDE.md 第 9 节）");
const DB = `lyx_test_infra_hook_${process.pid}`;
const urlOf = (db: string) => Object.assign(new URL(base), { pathname: `/${db}` }).toString();
const { password } = new URL(base);
if (password.length < 3)
  throw new Error(
    "DATABASE_URL 要带口令（不少于 3 个字符）：这份用例靠它核对输出里没有口令。本地的取值见 CLAUDE.md 第 9 节",
  );

const MANAGED_PASSED = "结论：通过。两个扩展可建，迁移跑通，数量对得上";
const GRANTS_HEADING = "## 角色与授权";

/** 照业主的用法跑：仓库根目录下 DATABASE_URL=<库> pnpm db:verify-managed */
function pnpmVerifyManaged(databaseUrl: string) {
  const result = spawnSync("pnpm", ["db:verify-managed"], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
  if (result.error) throw result.error;
  return { status: result.status, stdout: result.stdout, output: result.stdout + result.stderr };
}

afterAll(() => lib.dropDb(DB));

describe("pnpm db:verify-managed 的后置钩子 postdb:verify-managed", () => {
  it("空库：托管库验证通过之后，报告末尾接着出“角色与授权”一段，两段的结论都是通过", () => {
    lib.recreateDb(DB);
    const result = pnpmVerifyManaged(urlOf(DB));
    expect(result.status).toBe(0);
    const managed = result.stdout.indexOf(MANAGED_PASSED);
    const grants = result.stdout.indexOf(GRANTS_HEADING);
    expect(managed).toBeGreaterThan(-1);
    expect(grants).toBeGreaterThan(managed);
    const section = result.stdout.slice(grants);
    expect(section).toContain(`- 库：\`${DB}\``);
    expect(section).toContain("逐张与期望相同");
    expect(section).toContain("结论：通过。角色在，授权生效，分区表可写可查");
    // 整条命令的输出里没有连接信息（pnpm 自己只回显脚本的命令行）
    expect(result.output).not.toContain(password);
    expect(result.output).not.toMatch(/postgres(?:ql)?:\/\//);
  });

  it("授权多出一处：前一步照样通过，“角色与授权”一段不通过，经 pnpm 跑的整条命令退出码非 0", () => {
    lib.recreateDb(DB);
    // 在空库里先埋一条缺省授权：之后迁移建的每张表都自动把 DELETE 给应用角色。库里仍然一张表都没有，前一步照常跑。
    // 两个角色是上一例跑迁移时在实例上建出来的（已有就不建）
    lib.sqlOrThrow(
      DB,
      "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT DELETE ON TABLES TO lyx_app",
    );
    const result = pnpmVerifyManaged(urlOf(DB));
    expect(result.stdout).toContain(MANAGED_PASSED);
    const grants = result.stdout.indexOf(GRANTS_HEADING);
    expect(grants).toBeGreaterThan(result.stdout.indexOf(MANAGED_PASSED));
    const section = result.stdout.slice(grants);
    expect(section).toContain("结论：不通过。");
    expect(section).toContain("只增表上 lyx_app 的表级权限不是恰好 INSERT、SELECT：");
    expect(section).not.toContain("结论：通过");
    // 钩子的退出码要传得出来：把根脚本写成“… || true”，上面几句照样成立，只有这一句红
    expect(result.status).not.toBe(0);
  });

  it("前一步不通过（库里已经有表）：退出码非 0，钩子不跑，没有“角色与授权”一段", () => {
    lib.recreateDb(DB);
    lib.sqlOrThrow(DB, "CREATE TABLE lyx_occupied (id integer PRIMARY KEY)");
    const result = pnpmVerifyManaged(urlOf(DB));
    expect(result.status).not.toBe(0);
    expect(result.output).toContain(`库 ${DB} 里已经有 1 张表`);
    expect(result.output).not.toContain(MANAGED_PASSED);
    expect(result.output).not.toContain(GRANTS_HEADING);
  });
});
