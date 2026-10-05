// W0-06b 的门禁：schema-check（python3 tools/schema-check/check.py），比的是分组文档的字段表与跑完全部迁移的库。
// 分组文档副本里把一列的类型改掉（文档没跟上迁移，或写错了），检查必须失败，并指到那一列。
// 不动本仓库的文档：把 docs/data-model/ 下的分组文档拷到临时目录，改头一份文档里头一个 text 列，
// 经 --docs 交给检查；库用反例共用的基准库（空库上跑完全部迁移），经 --existing 只读地比。
// 检查不再逐列比类型、或 CI 里不再跑它时，这一例会红（照 ci.yml 里那一步实际的命令跑，只把库与文档目录换掉）。
// 要本机有 python3 与 psql；两个库怎么来的、要什么环境，见 ../lib/db-structure.mjs 开头。
import { cpSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { pgEnv } from "../../db-lib.mjs";
import { structureFixture } from "../lib/db-structure.mjs";

const DOCS = "docs/data-model";
const STEP = /^ {8}run: (python3 tools\/schema-check\/check\.py) --existing lyx_migrate_check$/m;

export default {
  gate: "schema-check（分组文档字段表 ↔ 迁移后的库）",
  mutation: "分组文档副本里把一列的类型由 text 改成 integer",
  reason:
    /\n {2}(\w+\.\w+)：文档 integer，库里 text（text）\n[\s\S]*差异 1 处[\s\S]*结论：有 1 处问题[\s\S]*反例动的是：\1\n/,
  run(ctx) {
    const step = readFileSync(join(ctx.repoRoot, ".github/workflows/ci.yml"), "utf8").match(STEP);
    if (!step)
      throw new Error(
        "ci.yml 的 verify 里找不到跑 schema-check 的那一步（--existing lyx_migrate_check）",
      );
    const [tool, script] = step[1].split(" ");

    const dir = ctx.tempDir();
    const docs = readdirSync(join(ctx.repoRoot, DOCS))
      .filter((name) => /^\d\d-.+\.md$/.test(name))
      .sort();
    for (const name of docs) cpSync(join(ctx.repoRoot, DOCS, name), join(dir, name));
    // 头一份文档里头一张表的头一个 text 列：记下它在哪张表（前面最近的一个“### … `表名`”标题）
    const lines = readFileSync(join(dir, docs[0]), "utf8").split("\n");
    const row = lines.findIndex((line) => /^\| `\w+` \| text \| /.test(line));
    const table = lines
      .slice(0, row)
      .findLast((line) => line.startsWith("### "))
      ?.match(/`(\w+)`/)?.[1];
    if (row < 0 || !table) throw new Error(`${docs[0]} 里找不到字段表的 text 列`);
    const column = lines[row].match(/^\| `(\w+)`/)[1];
    lines[row] = lines[row].replace(" | text | ", " | integer | ");
    writeFileSync(join(dir, docs[0]), lines.join("\n"));

    const { base } = structureFixture();
    const env = pgEnv();
    const args = [join(ctx.repoRoot, script), "--existing", base];
    // 没动手脚之前要先是通过的：否则下面的失败说明不了什么
    const clean = ctx.run(tool, [...args, "--docs", join(ctx.repoRoot, DOCS)], { env });
    if (clean.status !== 0) {
      throw new Error(
        `没改过的文档就不通过：${clean.output.trim().split("\n").slice(-2).join(" ")}`,
      );
    }
    const result = ctx.run(tool, [...args, "--docs", dir], { env });
    // 退出码 1 是没比成（连不上库），不算“检查失败”
    if (result.status === 1) throw new Error(result.output.trim().split("\n").slice(-2).join(" "));
    return { status: result.status, output: `${result.output}\n反例动的是：${table}.${column}\n` };
  },
};
