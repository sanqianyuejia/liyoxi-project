// W0-09a 的门禁：登记表对账（pnpm registry:check）。契约里删掉一个订阅者登记，对账必须失败，并指出少的是哪一个。
// 不动本仓库的文件：在仓库外造一份最小副本——根 package.json、pnpm-workspace.yaml、packages/contract
//（不带 node_modules，依赖用符号链接指回本仓库装好的那份）、packages/config/tsconfig、x01 的正文与 frag、
// 归属表 docs/plan/x01-map.md、根脚本用到的 infra/ci/check-untracked.mjs。
// 副本里删掉 notify 模块的一个订阅者登记，照改后的登记重新生成归属表并加入暂存区：这样“归属表无差异”那一段
// 过得去，红的只能是与 x01 的对账。然后照 CI 里那一步实际的命令跑。
// CI 的 verify 里没有了 registry:check 那一步、根脚本不再对账、或对账不再比名称集合时，这一例会红。
// 要 pnpm 在 PATH 上、本仓库的依赖已安装（CI 里排在冻结安装之后）。
import { cpSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CONTRACT = "packages/contract";
const SOURCE = `${CONTRACT}/src/registry/notify.ts`;
const SUBSCRIBER = "notify.onMerchantUserDeleted";
/** 源码里登记它的那一行 */
const LINE = `    subscriber("${SUBSCRIBER}", "M2"),\n`;
const COPIED = [
  "package.json",
  "pnpm-workspace.yaml",
  "docs/api/x01-events-jobs.md",
  "docs/api/working/frag/x01-events-jobs.json",
  "docs/plan/x01-map.md",
  "infra/ci/check-untracked.mjs",
];

export default {
  gate: "登记表对账（registry:check）",
  mutation: `契约里删掉一个订阅者登记（${SUBSCRIBER}），归属表照改后的登记重新生成`,
  reason: new RegExp(
    `登记表对账未通过[\\s\\S]*订阅者：x01 正文有而契约没有：${SUBSCRIBER.replace(".", "\\.")}`,
  ),
  run(ctx) {
    const read = (path) => readFileSync(join(ctx.repoRoot, path), "utf8");
    const step = read(".github/workflows/ci.yml").match(
      /^ {6}- name: .+\n {8}run: (pnpm registry:check)$/m,
    );
    if (!step) throw new Error("ci.yml 的 verify 里找不到“run: pnpm registry:check”那一步");
    const [tool, ...args] = step[1].split(" ");

    const dir = ctx.tempDir();
    ctx.git(dir, "init", "-q", "-b", "main");
    ctx.writeFiles(dir, {
      ".gitignore": "node_modules\n",
      ...Object.fromEntries(COPIED.map((path) => [path, read(path)])),
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
    if (!source.includes(LINE)) throw new Error(`${SOURCE} 里找不到登记 ${SUBSCRIBER} 的那一行`);
    writeFileSync(join(dir, SOURCE), source.replace(LINE, ""));
    const regenerated = ctx.run("pnpm", ["registry:generate"], { cwd: dir });
    if (regenerated.status !== 0)
      throw new Error(`副本里的归属表没生成出来：${regenerated.output.trim()}`);
    ctx.git(dir, "add", "-A");
    return ctx.run(tool, args, { cwd: dir });
  },
};
