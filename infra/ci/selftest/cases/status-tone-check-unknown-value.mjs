// W0-30a 的门禁：状态字典键与契约枚举同名（pnpm status-tone:check）。字典里一个条目的取值改成契约枚举里没有的，
// 检查必须失败，并指出是哪个取值、哪个枚举。
// 不动本仓库的文件：在仓库外造一份最小副本——根 package.json、pnpm-workspace.yaml、packages/shared
//（不带 node_modules，依赖用符号链接指回本仓库装好的那份；契约经它走到本仓库的 packages/contract）、
// packages/config/tsconfig。副本里改一个取值，照 CI 里那一步实际的命令跑。
// 改哪一条不写死（字典会随各域的包改动）：按文件名排序，取第一份里第一条写了“表.列”与取值的条目的第一个取值。
// CI 的 verify 里没有了 status-tone:check 那一步、根脚本不再核对、或核对不再比取值时，这一例会红。
// 要 pnpm 在 PATH 上、本仓库的依赖已安装（CI 里排在冻结安装之后）。不连库。
import { cpSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SHARED = "packages/shared";
const DICT = `${SHARED}/src/design/status-tone`;
/** 有枚举对应的条目：entry("状态名", 列, ["取值", …；取到第一个取值为止 */
const ENTRY = /(entry\(\s*"[^"]+",\s*[A-Za-z_"'.]+,\s*\[\s*")([a-z_]+)(")/;
const EXTRA = "lyx_selftest_only";
const COPIED = ["package.json", "pnpm-workspace.yaml"];

/** 在副本里挑一个条目，把它的第一个取值换掉；返回原来的取值与所在文件 */
function breakOneValue(dir) {
  const files = readdirSync(join(dir, DICT))
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .sort();
  for (const name of files) {
    const path = join(dir, DICT, name);
    const source = readFileSync(path, "utf8");
    // 契约还没有绑定枚举的列，检查只列出、不比取值：这样的文件不挑
    if (source.includes("UNBOUND_ENUM_NOTE")) continue;
    const match = ENTRY.exec(source);
    if (!match) continue;
    writeFileSync(path, source.replace(ENTRY, `$1${EXTRA}$3`));
    return { value: match[2], file: `${DICT}/${name}` };
  }
  throw new Error(`${DICT} 下找不到写了“表.列”与取值的条目`);
}

export default {
  gate: "状态字典键与契约枚举同名（status-tone:check）",
  mutation: `字典里一个条目的取值改成契约枚举里没有的（${EXTRA}）`,
  reason: new RegExp(
    `状态字典键与契约枚举同名未通过[\\s\\S]*：取值 '${EXTRA}' 不在契约枚举 [a-z0-9_]+（[a-z_]+\\.[a-z_]+）的取值之内`,
  ),
  run(ctx) {
    const read = (path) => readFileSync(join(ctx.repoRoot, path), "utf8");
    const step = read(".github/workflows/ci.yml").match(
      /^ {6}- name: .+\n {8}run: (pnpm status-tone:check)$/m,
    );
    if (!step) throw new Error("ci.yml 的 verify 里找不到“run: pnpm status-tone:check”那一步");
    const [tool, ...args] = step[1].split(" ");

    const dir = ctx.tempDir();
    ctx.writeFiles(dir, Object.fromEntries(COPIED.map((path) => [path, read(path)])));
    cpSync(join(ctx.repoRoot, "packages/config/tsconfig"), join(dir, "packages/config/tsconfig"), {
      recursive: true,
    });
    cpSync(join(ctx.repoRoot, SHARED), join(dir, SHARED), {
      recursive: true,
      filter: (source) => !source.endsWith("/node_modules") && !source.endsWith("/dist"),
    });
    symlinkSync(
      join(ctx.repoRoot, SHARED, "node_modules"),
      join(dir, SHARED, "node_modules"),
      "dir",
    );

    // 没改之前副本里的检查得是通过的：不然下面的失败说明不了问题
    const before = ctx.run(tool, args, { cwd: dir });
    if (before.status !== 0)
      throw new Error(
        `副本里没改取值时检查就没过：${before.output.trim().split("\n").slice(-4).join(" ")}`,
      );

    const broken = breakOneValue(dir);
    const result = ctx.run(tool, args, { cwd: dir });
    // 差异只该有这一处：多出别的差异，说明改坏的不止一个取值
    if (result.status > 0 && !/未通过：差异 1\n/.test(result.output))
      throw new Error(
        `改的是 ${broken.file} 里的 ${broken.value}，检查报的不止这一处：${result.output.trim().split("\n").slice(-4).join(" ")}`,
      );
    return result;
  },
};
