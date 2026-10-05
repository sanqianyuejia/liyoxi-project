// W0-06b 的门禁：结构快照无差异（pnpm db:snapshot:check）。入库的快照比迁移建出来的少一行（迁移加了索引而快照
// 没跟着重出，或快照被手改），检查必须失败，差异里指到那一行。
// 不动本仓库的文件：在仓库外的临时 git 仓库里照根脚本 db:snapshot:check 的三步走一遍——
//   1. 把入库的快照拷进去、删掉“索引”一节的第一行、加入暂存区（相当于“已提交的内容”）；
//   2. 第一步“重新生成”改用 db-snapshot.mjs 的 --out 写进临时仓库，读的是反例共用的基准库（空库上跑完全部迁移，
//      与根脚本自己建的临时库是一回事，省一遍迁移）；
//   3. 后两步照根脚本的原文，在临时仓库里跑。
// 根脚本少了哪一步、换了写法，这里抛错（“反例没造出来”）。两个库怎么来的、要什么环境，见 ../lib/db-structure.mjs 开头。
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { structureFixture } from "../lib/db-structure.mjs";

const DIR = "packages/db/snapshot";
const FILE = `${DIR}/structure.txt`;
const STEPS = [
  "pnpm db:snapshot",
  `git diff --exit-code -- ${DIR}`,
  `node infra/ci/check-untracked.mjs ${DIR}`,
];

export default {
  gate: "结构快照无差异（db:snapshot:check）",
  mutation: "入库的快照比迁移建出来的少一个索引（快照没跟着迁移重出）",
  reason: /\n\+(\w+)\t\{"table":[^\n]*\n[\s\S]*反例动的是：\1\n/,
  run(ctx) {
    const read = (path) => readFileSync(join(ctx.repoRoot, path), "utf8");
    const scripts = JSON.parse(read("package.json")).scripts ?? {};
    if (scripts["db:snapshot:check"] !== STEPS.join(" && ")) {
      throw new Error(
        `根脚本 db:snapshot:check 不是预期的三步（${STEPS.join(" && ")}），现在是：${scripts["db:snapshot:check"]}`,
      );
    }
    if (scripts["db:snapshot"] !== "node infra/ci/db-snapshot.mjs") {
      throw new Error(
        `根脚本 db:snapshot 不是 node infra/ci/db-snapshot.mjs：${scripts["db:snapshot"]}`,
      );
    }

    const lines = read(FILE).split("\n");
    const dropped = lines.indexOf("## 索引") + 1;
    const name = lines[dropped]?.split("\t")[0];
    if (dropped === 0 || !name) throw new Error(`${FILE} 里找不到“索引”一节`);
    const dir = ctx.gitRepo({ [FILE]: lines.toSpliced(dropped, 1).join("\n") });

    const { base } = structureFixture();
    const generate = ctx.node("infra/ci/db-snapshot.mjs", ["--db", base, "--out", join(dir, FILE)]);
    if (generate.status !== 0) {
      throw new Error(`重新生成没跑成：${generate.output.trim().split("\n").slice(-2).join(" ")}`);
    }
    for (const step of STEPS.slice(1)) {
      const [command, ...args] = step.split(" ");
      const result =
        command === "node"
          ? ctx.node(args[0], args.slice(1), { cwd: dir })
          : ctx.run(command, args, { cwd: dir });
      if (result.status !== 0) {
        return { status: result.status, output: `${result.output}\n反例动的是：${name}\n` };
      }
    }
    return { status: 0, output: "db:snapshot:check 的三步都通过了" };
  },
};
