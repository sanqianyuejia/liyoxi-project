import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { repoRoot } from "./helpers.js";

// M0 退出核对表（docs/plan/m0-exit.md，W0-30）自己的核对：计划 第 6.3 节的自动化九项每一项都点到了用例或命令，
// 表里点到的文件都在仓库里、根脚本都在 package.json 里。用例改名、挪位置时这里会红：同一个 PR 把核对表那一行改过来
//（核对表不是门禁文件）。点到的用例过不过由 pnpm test 自己管，这里只管“点得到”。

const DOC = "docs/plan/m0-exit.md";
const text = readFileSync(join(repoRoot, DOC), "utf8");
const scripts = (
  JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  }
).scripts;

/** 反引号括起的内容 */
const quoted = (source: string): string[] =>
  [...source.matchAll(/`([^`]+)`/g)].map((match) => match[1] as string);
/** 像仓库里的文件路径：带目录、以常见扩展名结尾、不带通配与空格 */
const isRepoPath = (token: string): boolean =>
  /^[\w.@-]+(?:\/[\w.@-]+)+\.(?:ts|mjs|cjs|md|yml|json|txt|py)$/.test(token);
/** “pnpm <根脚本>”里的脚本名；pnpm 自己的子命令与带选项的写法不算 */
const rootScriptOf = (token: string): string | undefined => {
  const name = token.match(/^pnpm ([a-z][\w:.-]*)/)?.[1];
  return name === undefined || ["install", "exec", "test"].includes(name) ? undefined : name;
};
/** “node <脚本>”里的脚本路径 */
const nodeScriptOf = (token: string): string | undefined => token.match(/^node (\S+\.mjs)/)?.[1];

const ITEMS = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨"];
const rows = new Map(
  text
    .split("\n")
    .map((line) => line.split("|").map((cell) => cell.trim()))
    .filter((cells) => ITEMS.includes(cells[1] ?? ""))
    .map((cells) => [cells[1] as string, cells.slice(2).join("|")]),
);

describe("M0 退出核对表", () => {
  it("自动化九项一项不缺", () => {
    expect([...rows.keys()]).toEqual(ITEMS);
  });

  it.each(ITEMS)("第 %s 项点到了用例或命令", (item) => {
    const tokens = quoted(rows.get(item) ?? "");
    const pointed = tokens.filter(
      (token) =>
        isRepoPath(token) || rootScriptOf(token) !== undefined || nodeScriptOf(token) !== undefined,
    );
    expect(pointed.length, `第 ${item} 项没有点到任何文件或命令`).toBeGreaterThan(0);
  });

  it("表里点到的文件都在仓库里，根脚本都在 package.json 里", () => {
    const tokens = quoted(text);
    const paths = [
      ...tokens.filter(isRepoPath),
      ...tokens.map(nodeScriptOf).filter((path) => path !== undefined),
    ];
    expect(paths.length).toBeGreaterThan(20);
    expect(paths.filter((path) => !existsSync(join(repoRoot, path)))).toEqual([]);
    const names = tokens.map(rootScriptOf).filter((name) => name !== undefined);
    expect(names.length).toBeGreaterThan(5);
    expect(names.filter((name) => scripts[name] === undefined)).toEqual([]);
  });

  it("演示项写了业主跑的命令，看样指到看样清单", () => {
    const demo = text.split("\n").find((line) => line.startsWith("| 样例用例重放 |")) ?? "";
    expect(demo).toContain("`pnpm demo:m0`");
    expect(text).toContain("](sample-review/W0-29.md)");
    expect(existsSync(join(repoRoot, "docs/plan/sample-review/W0-29.md"))).toBe(true);
  });
});
