// W0-10 的门禁：natural 幂等的约束名核对（node infra/ci/natural-constraints.mjs；约定 C47）。
// 一条 natural 路由写的约束名在库里不存在（约束改了名或被删），核对必须失败，并指出是哪条路由的哪个名字。
// 不动本仓库的文件，也不写库：拿提交的路由清单，把第一条 natural 路由的第一个约束名改掉，另存一份给脚本读；
// 对的是跑过迁移的 lyx_migrate_check，只读。
// CI 里没有了这一步（它在 test 任务里）、或核对不再到库里找名字时，这一例会红。
// 要本地那套 PostgreSQL 在运行、lyx_migrate_check 已跑过迁移（packages/db/README.md 第 3 节），并给出
// DATABASE_URL 或 PG* 环境变量。连不上时这一例会红，不会被悄悄跳过。
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ciCommand } from "./docs-check-wrong-permission.mjs";

const ROUTES = "packages/contract/generated/routes.json";
const SUFFIX = "_lyx_selftest";

export default {
  gate: "natural 幂等的约束名核对（natural-constraints.mjs）",
  mutation: "路由清单里把第一条 natural 路由的第一个约束名改成库里没有的名字",
  reason: new RegExp(
    `约束名核对未通过[\\s\\S]*写的约束 \\S+${SUFFIX} 在库 lyx_migrate_check 里找不到`,
  ),
  run(ctx) {
    const [, script, ...args] = ciCommand(ctx, "node infra/ci/natural-constraints.mjs");
    const routes = JSON.parse(readFileSync(join(ctx.repoRoot, ROUTES), "utf8"));
    const target = routes.find(
      (route) => route.xIdempotent === "natural" && Array.isArray(route.idempotentBy),
    );
    if (!target) throw new Error(`${ROUTES} 里没有 natural 路由`);
    target.idempotentBy = [`${target.idempotentBy[0]}${SUFFIX}`, ...target.idempotentBy.slice(1)];
    const dir = ctx.tempDir();
    ctx.writeFiles(dir, { "routes.json": JSON.stringify(routes) });
    const result = ctx.node(script, [...args, "--routes", join(dir, "routes.json")]);
    // 连不上库、库没跑过迁移是环境问题，不算“检查失败”
    if (result.output.includes("没跑成"))
      throw new Error(result.output.trim().split("\n").slice(-3).join(" "));
    return result;
  },
};
