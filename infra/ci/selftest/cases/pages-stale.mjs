// W0-28 的门禁：页面清单无差异（node infra/ci/pages/generate.mjs --check）。
// 手改生成物：把入库的 pages.md 里一页的“已实现”由否改成是，登记表没动，核对必须失败。
// 脚本的 --check 不再比对内容时这一例会红。
import { readFileSync } from "node:fs";
import { join } from "node:path";

export default {
  gate: "页面清单无差异（pages/generate.mjs --check）",
  mutation: "手改 docs/plan/pages.md：把“资质审核”一行的已实现由否改成是",
  reason:
    /pages\.md 与页面登记不一致[\s\S]*入库的：.*资质审核.*\| 是 \|[\s\S]*应该是：.*资质审核.*\| 否 \|/,
  run(ctx) {
    const lines = readFileSync(join(ctx.repoRoot, "docs/plan/pages.md"), "utf8").split("\n");
    const index = lines.findIndex(
      (line) => line.includes("| 资质审核 |") && line.endsWith("| 否 |"),
    );
    if (index < 0) throw new Error("pages.md 里找不到“资质审核”那一行（还没实现的）");
    lines[index] = lines[index].replace(/\| 否 \|$/, "| 是 |");
    const dir = ctx.tempDir();
    ctx.writeFiles(dir, { "pages.md": lines.join("\n") });
    return ctx.node("infra/ci/pages/generate.mjs", ["--check", "--out", join(dir, "pages.md")]);
  },
};
