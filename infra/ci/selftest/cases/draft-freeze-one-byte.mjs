// W0-06b 的门禁：草稿冻结守卫（pnpm db:draft-freeze:check）。表结构由迁移接管之后，docs/data-model/ 下的
// schema.prisma 与 constraints/ 冻结；改草稿一个字节，守卫必须失败，并指到被改的文件。
// 不动本仓库的文件：把登记表与草稿拷到临时目录，在副本里给 constraints/ 的头一个文件末尾加一个空格。
// 守卫不再算哈希、或只核对文件在不在时，这一例会红。
import { appendFileSync, cpSync, readdirSync } from "node:fs";
import { join } from "node:path";

const CONSTRAINTS = "docs/data-model/constraints";

export default {
  gate: "草稿冻结守卫（db:draft-freeze:check）",
  mutation: "改草稿一个字节（constraints/ 的头一个文件末尾加一个空格）",
  reason:
    /- (docs\/data-model\/constraints\/\S+)：草稿被改过，sha256 与登记值不同[\s\S]*草稿冻结守卫未通过：1 处[\s\S]*反例动的是：\1\n/,
  run(ctx) {
    const dir = ctx.tempDir();
    for (const path of [
      "infra/ci/draft-freeze.sha256",
      "docs/data-model/schema.prisma",
      CONSTRAINTS,
    ]) {
      cpSync(join(ctx.repoRoot, path), join(dir, path), { recursive: true });
    }
    const target = `${CONSTRAINTS}/${readdirSync(join(dir, CONSTRAINTS)).sort()[0]}`;
    appendFileSync(join(dir, target), " ");
    const result = ctx.node("infra/ci/draft-freeze.mjs", ["--root", dir]);
    return { status: result.status, output: `${result.output}\n反例动的是：${target}\n` };
  },
};
