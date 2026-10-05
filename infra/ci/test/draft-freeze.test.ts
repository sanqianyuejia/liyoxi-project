import { appendFileSync, cpSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { makeTempDir, repoRoot, run, writeFiles } from "./helpers.js";

// 草稿冻结守卫的用例（W0-06b）。不连库：把登记表与草稿拷到仓库外的临时目录，动一处，跑脚本本身。

const SCRIPT = join(repoRoot, "infra/ci/draft-freeze.mjs");
const REGISTRY = "infra/ci/draft-freeze.sha256";
const SCHEMA = "docs/data-model/schema.prisma";
const CONSTRAINTS = "docs/data-model/constraints";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

/** 拷一份登记表与草稿，照 mutate 动一处，跑守卫 */
function check(mutate: (dir: string) => void = () => {}) {
  const temp = makeTempDir("lyx-draft-freeze-");
  cleanups.push(temp.cleanup);
  for (const path of [REGISTRY, SCHEMA, CONSTRAINTS]) {
    cpSync(join(repoRoot, path), join(temp.dir, path), { recursive: true });
  }
  mutate(temp.dir);
  return run("node", [SCRIPT, "--root", temp.dir], repoRoot);
}

/** constraints/ 下的头一个文件：现挑，不点名 */
const someConstraintFile = () =>
  `${CONSTRAINTS}/${readdirSync(join(repoRoot, CONSTRAINTS)).sort()[0]}`;
const FAILED = "草稿冻结守卫未通过";

describe("草稿冻结守卫", () => {
  it("本仓库的草稿与登记值一致；登记的就是 schema.prisma 与 constraints/ 下的全部文件", () => {
    const result = run("node", [SCRIPT], repoRoot);
    expect(result.status).toBe(0);
    const registered = readFileSync(join(repoRoot, REGISTRY), "utf8")
      .split("\n")
      .filter((line) => /^[0-9a-f]{64} {2}/.test(line))
      .map((line) => line.slice(66))
      .sort();
    const files = readdirSync(join(repoRoot, CONSTRAINTS)).map((name) => `${CONSTRAINTS}/${name}`);
    expect(registered).toEqual([...files, SCHEMA].sort());
    expect(result.stdout).toContain(`${registered.length} 个草稿文件的 sha256 都等于登记值`);
    expect(check().status).toBe(0);
  });

  it.each([[SCHEMA], [someConstraintFile()]])("%s 末尾多一个字节：不通过，指到这个文件", (path) => {
    const result = check((dir) => appendFileSync(join(dir, path), " "));
    expect(result.stderr).toContain(`- ${path}：草稿被改过，sha256 与登记值不同`);
    expect(result.stderr).toContain(`${FAILED}：1 处。`);
    expect(result.status).toBe(1);
  });

  it("删掉一个草稿、多放一个没登记的文件：不通过", () => {
    const gone = check((dir) => rmSync(join(dir, someConstraintFile())));
    expect(gone.stderr).toContain(`- ${someConstraintFile()}：登记了的草稿不在了`);
    expect(gone.status).toBe(1);
    const extra = check((dir) =>
      writeFiles(dir, { [`${CONSTRAINTS}/99-extra.sql`]: "select 1;\n" }),
    );
    expect(extra.stderr).toContain(`- ${CONSTRAINTS}/99-extra.sql：草稿目录下多出一个没登记的文件`);
    expect(extra.status).toBe(1);
  });

  it("登记表被动过：少一行、重复、认不出的行、登记了范围之外的文件、清空，都不通过", () => {
    const edit = (change: (lines: string[]) => string[]) => (dir: string) => {
      const file = join(dir, REGISTRY);
      writeFileSync(file, change(readFileSync(file, "utf8").split("\n")).join("\n"));
    };
    const entry = (lines: string[]) =>
      lines.findIndex((line) => line.endsWith(someConstraintFile()));
    const cases: Array<[(lines: string[]) => string[], string]> = [
      [(lines) => lines.toSpliced(entry(lines), 1), "草稿目录下多出一个没登记的文件"],
      [(lines) => [...lines, lines[entry(lines)] ?? ""], "登记了两次"],
      [(lines) => [...lines, "不是一行登记"], "写法认不出"],
      [(lines) => [...lines, `${"0".repeat(64)}  package.json`], "package.json 不在冻结的范围里"],
      [(lines) => lines.filter((line) => line.startsWith("#")), "一个文件都没登记"],
    ];
    for (const [change, problem] of cases) {
      const result = check(edit(change));
      expect(result.stderr).toContain(problem);
      expect(result.stderr).toContain(FAILED);
      expect(result.status).toBe(1);
    }
  });

  it("找不到登记表、参数写错：退出码 2", () => {
    expect(check((dir) => rmSync(join(dir, REGISTRY))).status).toBe(2);
    expect(run("node", [SCRIPT, "--nope"], repoRoot).status).toBe(2);
  });
});
