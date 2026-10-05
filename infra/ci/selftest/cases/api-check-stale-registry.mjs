// W0-10 的门禁：api-check 进 CI 的后一半（node infra/ci/api-check.mjs）。登记文档（registry-routes.md 等三份）
// 由 tools/api-check 的两个生成脚本写；改了路线图却没有重新生成并提交登记文档，检查必须失败，并指出是哪一份。
// 不动本仓库的文件：在仓库外建一个临时 git 仓库，拷进校验工具、它读的两个文档目录与包装脚本，把三份登记文档
// 加进暂存区作基线；再把路线图第一条接口的摘要改掉，照 CI 里那一步跑副本里的包装脚本。
// CI 里没有了这一步（它在 test 任务里）、或包装脚本不再重新生成并比对登记文档时，这一例会红。
// 要 python3、psql、git 在 PATH 上；要本地那套 PostgreSQL 与 lyx_migrate_check（前一半的“表.列”要核对过才走到这里），
// 并给出 DATABASE_URL 或 PG* 环境变量。只读库。
import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { ciCommand } from "./docs-check-wrong-permission.mjs";

const ROUTEMAP = "docs/api/working/routemap.json";
const REGISTRY_DOCS = ["routes", "errors", "permissions"].map(
  (name) => `docs/api/registry-${name}.md`,
);

export default {
  gate: "api-check（登记文档重新生成后无差异）",
  mutation: "路线图里改第一条接口的摘要，不重新生成登记文档",
  reason: /api-check 未通过：登记文档重新生成后与入库的不一致[\s\S]*registry-routes\.md/,
  run(ctx) {
    const [, script, ...args] = ciCommand(ctx, "node infra/ci/api-check.mjs");
    const dir = ctx.tempDir();
    ctx.git(dir, "init", "-q", "-b", "main");
    for (const path of ["tools/api-check", "docs/api", "docs/data-model"]) {
      cpSync(join(ctx.repoRoot, path), join(dir, path), {
        recursive: true,
        filter: (source) => !source.endsWith("/out"),
      });
    }
    ctx.writeFiles(dir, {
      [script]: readFileSync(join(ctx.repoRoot, script), "utf8"),
      "infra/ci/db-lib.mjs": readFileSync(join(ctx.repoRoot, "infra/ci/db-lib.mjs"), "utf8"),
    });
    ctx.git(dir, "add", ...REGISTRY_DOCS);

    const routemap = JSON.parse(readFileSync(join(dir, ROUTEMAP), "utf8"));
    routemap[0].summary = `${routemap[0].summary}（lyx-selftest）`;
    writeFileSync(join(dir, ROUTEMAP), JSON.stringify(routemap, null, 1));
    const result = ctx.run(process.execPath, [join(dir, script), ...args], { cwd: dir });
    // 前一半没过（连不上库、“表.列”未核对）是环境问题，不算这一例要的“检查失败”
    if (/没跑成|未核对/.test(result.output))
      throw new Error(result.output.trim().split("\n").slice(-3).join(" "));
    return result;
  },
};
