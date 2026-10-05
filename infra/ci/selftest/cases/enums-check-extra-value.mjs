// W0-09a 的门禁：枚举与库 CHECK 一致（pnpm enums:check）。契约给一个枚举多加一个取值，对账必须失败，
// 并指出是哪一列、多了哪个取值。
// 不动本仓库的文件，也不写库：在仓库外造一份最小副本——根 package.json、pnpm-workspace.yaml、packages/contract
//（不带 node_modules，依赖用符号链接指回本仓库装好的那份）、packages/config/tsconfig。副本里给操作人类型
// actor_type 多加一个取值，照 CI 里那一步实际的命令跑；对的是跑过迁移的 lyx_migrate_check，只读。
// CI 的 verify 里没有了 enums:check 那一步、或对账不再比取值集合时，这一例会红。
// 要 pnpm 在 PATH 上、本仓库的依赖已安装；要本地那套 PostgreSQL 在运行、lyx_migrate_check 已跑过迁移
//（packages/db/README.md 第 3 节），并给出 DATABASE_URL 或 PG* 环境变量。连不上时这一例会红，不会被悄悄跳过。
import { cpSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CONTRACT = "packages/contract";
const SOURCE = `${CONTRACT}/src/enums/shared.ts`;
/** 源码里 actor_type 的取值那一行 */
const VALUES = '["merchant", "staff", "system", "partner"],';
const EXTRA = "lyx_selftest_only";

export default {
  gate: "枚举与库 CHECK 一致（enums:check）",
  mutation: `契约给枚举 actor_type 多加一个取值（${EXTRA}）`,
  reason: new RegExp(
    `枚举与库 CHECK 对账未通过[\\s\\S]*outbox_event\\.actor_type：契约枚举 actor_type 有、库的 CHECK（ck_outbox_event_actor_type）没有的取值：'${EXTRA}'`,
  ),
  run(ctx) {
    const read = (path) => readFileSync(join(ctx.repoRoot, path), "utf8");
    const step = read(".github/workflows/ci.yml").match(
      /^ {6}- name: .+\n {8}run: (pnpm enums:check)$/m,
    );
    if (!step) throw new Error("ci.yml 的 verify 里找不到“run: pnpm enums:check”那一步");
    const [tool, ...args] = step[1].split(" ");

    const dir = ctx.tempDir();
    ctx.writeFiles(dir, {
      "package.json": read("package.json"),
      "pnpm-workspace.yaml": read("pnpm-workspace.yaml"),
    });
    cpSync(join(ctx.repoRoot, "packages/config/tsconfig"), join(dir, "packages/config/tsconfig"), {
      recursive: true,
    });
    cpSync(join(ctx.repoRoot, CONTRACT), join(dir, CONTRACT), {
      recursive: true,
      filter: (source) => !source.endsWith("/node_modules"),
    });
    symlinkSync(
      join(ctx.repoRoot, CONTRACT, "node_modules"),
      join(dir, CONTRACT, "node_modules"),
      "dir",
    );

    const source = readFileSync(join(dir, SOURCE), "utf8");
    if (source.split(VALUES).length !== 2)
      throw new Error(`${SOURCE} 里 actor_type 的取值那一行应恰好出现一次：${VALUES}`);
    writeFileSync(
      join(dir, SOURCE),
      source.replace(VALUES, `${VALUES.slice(0, -2)}, "${EXTRA}"],`),
    );
    const result = ctx.run(tool, args, { cwd: dir });
    // 连不上库、库没跑过迁移是环境问题，不算“检查失败”
    if (result.output.includes("对账：没跑成"))
      throw new Error(result.output.trim().split("\n").slice(-4).join(" "));
    return result;
  },
};
