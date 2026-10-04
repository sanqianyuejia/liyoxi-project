// W0-03 的门禁：CI 里的格式检查，忽略项只认 .prettierignore。
// Prettier 缺省把 .gitignore 也当忽略文件读：往 .gitignore 加一行，已入库的文件就不查格式了，
// 而 .gitignore 不是门禁文件，门禁改动分类看不到这一行。CI 的“格式”那一步带 --ignore-path .prettierignore 把它关掉。
// 这一例照 CI 那一步实际跑的命令（根脚本 format:check 的内容，加上那一步在它后面带的参数）跑一遍：
// 那一步去掉 --ignore-path 时这里会红。
import { readFileSync } from "node:fs";
import { join } from "node:path";

export default {
  gate: "格式检查（忽略项只认 .prettierignore）",
  mutation: "格式不对的文件被写进 .gitignore",
  reason: /\[warn\] src\/ugly\.ts[\s\S]*Code style issues found/,
  run(ctx) {
    const read = (path) => readFileSync(join(ctx.repoRoot, path), "utf8");
    const step = read(".github/workflows/ci.yml").match(
      /^ {6}- name: 格式\n {8}run: pnpm format:check(.*)$/m,
    );
    if (!step) throw new Error("ci.yml 里找不到“格式”那一步（run: pnpm format:check …）");
    const script = JSON.parse(read("package.json")).scripts["format:check"];
    const [tool, ...args] = `${script}${step[1]}`.trim().split(/\s+/);
    if (tool !== "prettier") throw new Error(`根脚本 format:check 不是 prettier 开头：${script}`);
    const dir = ctx.tempDir();
    ctx.writeFiles(dir, {
      ".gitignore": "src/ugly.ts\n",
      ".prettierignore": read(".prettierignore"),
      "src/ugly.ts": "export   const a = {x:1}\n",
    });
    return ctx.node("node_modules/prettier/bin/prettier.cjs", args, { cwd: dir });
  },
};
