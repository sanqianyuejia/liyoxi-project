// W0-10 的门禁：计划 第 8.2 节的表由路由清单生成（node infra/ci/plan-routes.mjs --check）。
// 表里的数与路由清单对不上（改了归属却没重写这张表，或手改了表），核对必须失败，并给出应当是哪一行。
// 不动本仓库的文件：把计划文档拷到仓库外，把表里第一份接口文档那一行的 V1.0 条数加一，让脚本读这份副本。
// CI 里没有了这一步（它在 test 任务里）、或核对不再拿表与清单比时，这一例会红。不连库。
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ciCommand } from "./docs-check-wrong-permission.mjs";

const PLAN = "docs/08-development-plan.md";

export default {
  gate: "计划 第 8.2 节的表与路由清单一致（plan-routes.mjs --check）",
  mutation: "计划文档的表里，第一份接口文档那一行的 V1.0 条数加一",
  reason: /里程碑归属核对未通过[\s\S]*计划 第 8\.2 节的表与路由清单不一致[\s\S]*应当是：\| \[/,
  run(ctx) {
    const [, script] = ciCommand(ctx, "node infra/ci/plan-routes.mjs --check");
    const plan = readFileSync(join(ctx.repoRoot, PLAN), "utf8");
    const row = plan.match(/^\| \[[^\]]+\]\(api\/[a-z0-9-]+\.md\) \| (\d+) \|.*$/m);
    if (!row) throw new Error(`${PLAN} 里找不到接口文档的表格行`);
    const stale = row[0].replace(`| ${row[1]} |`, `| ${Number(row[1]) + 1} |`);
    const dir = ctx.tempDir();
    ctx.writeFiles(dir, { "plan.md": plan.replace(row[0], stale) });
    return ctx.node(script, ["--check", "--plan", join(dir, "plan.md")]);
  },
};
