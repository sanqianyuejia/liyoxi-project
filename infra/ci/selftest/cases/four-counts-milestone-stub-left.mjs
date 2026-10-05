// W0-30 的门禁：四个计数（CI 里的 node infra/ci/four-counts.mjs --require M0）。
// 里程碑退出后它的四样（接口待落地、应回补的留桩、未实现页面、x01 条目未落地）要一直是 0。
// 反例：留桩清单里多出一项“应在已退出的那个里程碑回补”的留桩，检查必须失败，并点出是哪个文件。
// 不动本仓库的文件：留桩目录换成仓库外的一份（真的那几份原样拷过去，再加一份）；已挂载清单在全新检出里没有
//（它由 apps/api 的用例写出，不入库），这里按“要求的里程碑的接口都挂上了”另写一份。其余输入是仓库里真的。
// 要求哪个里程碑取自 CI 的那一步，不写死。CI 里没有了这一步、或 --require 不再看留桩时，这一例会红。不连库。
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { ciCommand } from "./docs-check-wrong-permission.mjs";

const STUBS = "docs/plan/stubs";

export default {
  gate: "四个计数（four-counts.mjs --require）",
  mutation: "留桩清单里多出一项应在已退出的里程碑回补、仍是“留桩中”的留桩",
  reason: /里程碑没有清零[\s\S]*应在本里程碑回补的留桩还有 1 项：m0-lyxselftest-left\.md/,
  run(ctx) {
    const [, script, ...args] = ciCommand(ctx, "node infra/ci/four-counts.mjs --require");
    const required = args[args.indexOf("--require") + 1].split(",");
    const milestone = required[0];
    const routes = JSON.parse(
      readFileSync(join(ctx.repoRoot, "packages/contract/generated/routes.json"), "utf8"),
    );
    const mounted = routes
      .filter((route) => route.version === "V1.0" && required.includes(route.milestone))
      .map((route) => route.operationId);
    const dir = ctx.tempDir();
    const real = Object.fromEntries(
      readdirSync(join(ctx.repoRoot, STUBS))
        .filter((name) => name.endsWith(".md"))
        .map((name) => [`stubs/${name}`, readFileSync(join(ctx.repoRoot, STUBS, name), "utf8")]),
    );
    ctx.writeFiles(dir, { ...real, "mounted.json": JSON.stringify(mounted) });
    const inputs = ["--mounted", join(dir, "mounted.json"), "--stubs", join(dir, "stubs")];
    const baseline = ctx.node(script, [...args, ...inputs]);
    if (baseline.status !== 0) throw new Error(`没加反例时就没通过：${baseline.output.trim()}`);
    ctx.writeFiles(dir, {
      "stubs/m0-lyxselftest-left.md": [
        "# 样例留桩",
        "",
        "| 项 | 内容 |",
        "| --- | --- |",
        "| 状态 | 留桩中 |",
        "| 留桩内容 | 样例 |",
        "| 骨架里的做法 | 返回空 |",
        "| 登记的工作包 | W9-01 |",
        `| 回补里程碑 | ${milestone} |`,
        "| 回补的工作包 | 待拆包后填 |",
        "| 依据 | 样例 |",
        "",
      ].join("\n"),
    });
    return ctx.node(script, [...args, ...inputs]);
  },
};
