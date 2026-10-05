// W0-10 的门禁：路由元数据对账（pnpm contract:docs-check）。契约里把一条后台路由的权限点拿掉，对账必须失败，
// 并指出是哪一条、契约与路线图各是什么。
// 不动本仓库的文件：在仓库外造一份最小副本（做法同 api-registries-check-wrong-error-code，引它的 contractCopy），
// 另带上对账要读的文档（清单取自对账脚本自己导出的 SOURCE_PATHS）。照 CI 里那一步实际的命令跑。
// 改哪一条不写死：取 a04 短剧库那个目录里第一个资源文件中第一条写了权限点的路由。
// CI 的 verify 里没有了 contract:docs-check 那一步、或对账不再比权限点时，这一例会红。
// 要 pnpm 在 PATH 上、本仓库的依赖已安装。不连库。
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { contractCopy } from "./api-registries-check-wrong-error-code.mjs";

const CHECK_SCRIPT = "packages/contract/scripts/docs-check.ts";
const DOC_DIR = "packages/contract/src/routes/a04-content";

/** CI 里以 command 开头的那一步（不论在哪个任务）实际跑的命令，拆成 [命令, ...参数]；找不到即抛错 */
export function ciCommand(ctx, command) {
  const escaped = command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const step = readFileSync(join(ctx.repoRoot, ".github/workflows/ci.yml"), "utf8").match(
    new RegExp(`^ {6}- name: .+\\n {8}run: (${escaped}(?: .+)?)$`, "m"),
  );
  if (!step) throw new Error(`ci.yml 里找不到“run: ${command}”那一步`);
  return step[1].split(" ");
}

/** 契约的副本，带上路由元数据对账要读的文档 */
export function docsCheckCopy(ctx) {
  const script = readFileSync(join(ctx.repoRoot, CHECK_SCRIPT), "utf8");
  const block = script.match(/export const SOURCE_PATHS = \{([\s\S]*?)\} as const;/)?.[1];
  const docs = [...(block ?? "").matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  if (docs.length === 0) throw new Error(`${CHECK_SCRIPT} 里找不到 SOURCE_PATHS`);
  const dir = contractCopy(ctx);
  ctx.writeFiles(
    dir,
    Object.fromEntries(docs.map((path) => [path, readFileSync(join(ctx.repoRoot, path), "utf8")])),
  );
  return dir;
}

export default {
  gate: "路由元数据对账（contract:docs-check）",
  mutation: "契约里把一条后台路由的权限点改成 null（a04 短剧库里第一条写了权限点的）",
  reason:
    /路由元数据对账未通过[\s\S]*admin\.[A-Za-z.]+ 的权限点：契约是 null，路线图是 "[a-z0-9_.]+"/,
  run(ctx) {
    const [tool, ...args] = ciCommand(ctx, "pnpm contract:docs-check");
    const dir = docsCheckCopy(ctx);
    const pattern = /"x-permission": "(?!assert-in-handler")[a-z0-9_.]+"/;
    const file = readdirSync(join(dir, DOC_DIR))
      .filter((name) => name.endsWith(".ts") && name !== "index.ts")
      .sort()
      .find((name) => pattern.test(readFileSync(join(dir, DOC_DIR, name), "utf8")));
    if (!file) throw new Error(`${DOC_DIR} 里找不到写了权限点的路由`);
    const source = readFileSync(join(dir, DOC_DIR, file), "utf8");
    writeFileSync(join(dir, DOC_DIR, file), source.replace(pattern, '"x-permission": null'));
    return ctx.run(tool, args, { cwd: dir });
  },
};
