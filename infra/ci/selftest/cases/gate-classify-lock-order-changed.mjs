// W0-07 的门禁：加锁顺序常量是门禁文件（CLAUDE.md 第 6 节规则 22）。
// 把“改一张表的次序号”的差异喂给分类脚本，没有 gate-change 标签必须失败。
// 常量文件从仓库里现读，改的是表里的第一行：这里不抄表名与次序号。
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PATH = "packages/services/src/kernel/lock-order.ts";

export default {
  gate: "门禁改动分类（加锁顺序常量）",
  mutation: "工作包 PR 里改掉加锁顺序表里一张表的次序号，没有 gate-change 标签",
  reason: /kernel\/lock-order\.ts[\s\S]*删改了已有行[\s\S]*没有 gate-change 标签/,
  run(ctx) {
    const base = readFileSync(join(ctx.repoRoot, PATH), "utf8");
    const changed = base.replace(/^( {2}[a-z_]+: )\d+,/m, "$1999,");
    if (changed === base) throw new Error(`${PATH} 里找不到“表名: 次序,”这样的行`);
    const dir = ctx.gitRepo({ [PATH]: base });
    ctx.git(dir, "commit", "-q", "-m", "base");
    ctx.writeFiles(dir, { [PATH]: changed });
    ctx.git(dir, "add", "-A");
    ctx.git(dir, "commit", "-q", "-m", "head");
    return ctx.node("infra/ci/classify-gate-changes.mjs", ["--base", "HEAD~1"], { cwd: dir });
  },
};
