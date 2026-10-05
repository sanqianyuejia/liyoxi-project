// W0-09b 的门禁：接口侧注册表对账（pnpm api-registries:check）。契约里删掉一个权限点登记，对账必须失败，
// 并指出少的是哪一个、哪一节的数量对不上。
// 做法同 api-registries-check-wrong-error-code：在仓库外造一份最小副本，照 CI 里那一步实际的命令跑。
// 删哪个权限点不写死：取“短剧库管理”那个文件里登记的第一个。
// CI 的 verify 里没有了 api-registries:check 那一步、或对账不再比权限点的键集合时，这一例会红。
// 要 pnpm 在 PATH 上、本仓库的依赖已安装。不连库。
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { ciStep, contractCopy } from "./api-registries-check-wrong-error-code.mjs";

const SOURCE = "packages/contract/src/authz/permissions/drama.ts";

export default {
  gate: "接口侧注册表对账（api-registries:check）",
  mutation: "契约里删掉一个权限点登记（短剧库管理一节的第一个）",
  reason:
    /接口侧注册表对账未通过[\s\S]*权限点：登记文档有而契约没有：[a-z][a-z0-9_.]*[\s\S]*数量：权限点“短剧库管理”一节对不上/,
  run(ctx) {
    const [tool, ...args] = ciStep(ctx);
    const dir = contractCopy(ctx);

    const source = readFileSync(join(dir, SOURCE), "utf8");
    // 第一个登记：从“permission(”起，到下一个“permission(”或数组收尾之前（写成一行或拆成几行都可以）
    const first = source.match(
      /\n\s*permission\("[^"]+",[\s\S]*?(?=\n\s*permission\(|\n\]\);)/,
    )?.[0];
    if (!first) throw new Error(`${SOURCE} 里找不到权限点登记`);
    writeFileSync(join(dir, SOURCE), source.replace(first, ""));
    return ctx.run(tool, args, { cwd: dir });
  },
};
