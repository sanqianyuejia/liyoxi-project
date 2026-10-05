// W0-09b 的门禁：接口侧注册表对账（pnpm api-registries:check）。契约里把一个领域错误码的数值改掉，对账必须失败，
// 并指出是哪个码、契约与文档各是多少。
// 不动本仓库的文件：在仓库外造一份最小副本——根 package.json、pnpm-workspace.yaml、packages/contract
//（不带 node_modules，依赖用符号链接指回本仓库装好的那份）、packages/config/tsconfig，以及对账要读的文档
//（清单取自对账脚本自己导出的 SOURCE_PATHS 与 FRAG_DIR，脚本以后多读一份文档，这里跟着多拷一份）。
// 副本里把一个码的数值改成同一取号区间里没人用的数，照 CI 里那一步实际的命令跑。
// 改哪个码不写死：取 m06-ad 那个文件里登记的第一个码，新数值取它所在区间里没被占用的最大的一个。
// CI 的 verify 里没有了 api-registries:check 那一步、根脚本不再对账、或对账不再比数值时，这一例会红。
// 要 pnpm 在 PATH 上、本仓库的依赖已安装（CI 里排在冻结安装之后）。不连库。
import { cpSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CONTRACT = "packages/contract";
const SOURCE = `${CONTRACT}/src/errors/domain/m06-ad.ts`;
const CHECK_SCRIPT = `${CONTRACT}/scripts/api-registries-check.ts`;

/** 对账脚本里 SOURCE_PATHS 列的文档，加 FRAG_DIR 下的全部清单 */
export function copiedDocs(repoRoot) {
  const script = readFileSync(join(repoRoot, CHECK_SCRIPT), "utf8");
  const block = script.match(/export const SOURCE_PATHS = \{([\s\S]*?)\} as const;/)?.[1];
  const fragDir = script.match(/export const FRAG_DIR = "([^"]+)";/)?.[1];
  if (!block || !fragDir) throw new Error(`${CHECK_SCRIPT} 里找不到 SOURCE_PATHS 或 FRAG_DIR`);
  const docs = [...block.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  if (docs.length === 0) throw new Error(`${CHECK_SCRIPT} 的 SOURCE_PATHS 是空的`);
  const frags = readdirSync(join(repoRoot, fragDir))
    .filter((name) => name.endsWith(".json"))
    .map((name) => `${fragDir}/${name}`);
  return [...new Set([...docs, ...frags])];
}

/** 在仓库外造一份能跑根脚本的最小副本，返回它的目录 */
export function contractCopy(ctx) {
  const read = (path) => readFileSync(join(ctx.repoRoot, path), "utf8");
  const dir = ctx.tempDir();
  ctx.writeFiles(dir, {
    "package.json": read("package.json"),
    "pnpm-workspace.yaml": read("pnpm-workspace.yaml"),
    ...Object.fromEntries(copiedDocs(ctx.repoRoot).map((path) => [path, read(path)])),
  });
  cpSync(join(ctx.repoRoot, "packages/config/tsconfig"), join(dir, "packages/config/tsconfig"), {
    recursive: true,
  });
  cpSync(join(ctx.repoRoot, CONTRACT), join(dir, CONTRACT), {
    recursive: true,
    filter: (source) => !source.endsWith("/node_modules"),
  });
  symlinkSync(
    join(ctx.repoRoot, CONTRACT, "node_modules"),
    join(dir, CONTRACT, "node_modules"),
    "dir",
  );
  return dir;
}

/** CI 的 verify 里那一步实际跑的命令，拆成 [命令, ...参数] */
export function ciStep(ctx) {
  const step = readFileSync(join(ctx.repoRoot, ".github/workflows/ci.yml"), "utf8").match(
    /^ {6}- name: .+\n {8}run: (pnpm api-registries:check)$/m,
  );
  if (!step) throw new Error("ci.yml 的 verify 里找不到“run: pnpm api-registries:check”那一步");
  return step[1].split(" ");
}

export default {
  gate: "接口侧注册表对账（api-registries:check）",
  mutation: "契约里把一个领域错误码的数值改成同一取号区间里没人用的数",
  reason:
    /接口侧注册表对账未通过[\s\S]*领域错误码 [A-Z][A-Z0-9_]* 的数值：契约是 \d{5}，frag是 \d{5}/,
  run(ctx) {
    const [tool, ...args] = ciStep(ctx);
    const dir = contractCopy(ctx);

    // 按内容认，不按排版认：一个码写成一行还是拆成几行、缩进几格都可以
    const source = readFileSync(join(dir, SOURCE), "utf8");
    const first = source.match(/([A-Z][A-Z0-9_]*): def\(\s*(\d{5}),/);
    const range = source.match(/\[\s*\[\s*(\d{5}),\s*(\d{5})\s*\]/);
    if (!first || !range) throw new Error(`${SOURCE} 里找不到第一个错误码的登记或它的取号区间`);
    const used = new Set([...source.matchAll(/: def\(\s*(\d{5}),/g)].map((match) => match[1]));
    let free = Number(range[2]);
    while (used.has(String(free)) && free > Number(range[1])) free -= 1;
    if (used.has(String(free))) throw new Error(`${SOURCE} 的第一个取号区间里没有空号可用`);
    writeFileSync(join(dir, SOURCE), source.replace(first[0], first[0].replace(first[2], free)));
    return ctx.run(tool, args, { cwd: dir });
  },
};
