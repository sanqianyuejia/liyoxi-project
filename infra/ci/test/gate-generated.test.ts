import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { git, makeTempRepo, repoRoot, writeFiles } from "./helpers.js";

// 门禁改动分类的 generated 口径（入库的生成物；计划 第 5.3 节“重新生成的生成物”属只增）。
// 分两部分：
//   一、清单里每个 generated 条目写的检查命令（check）确实在 CI 里跑，且是“重新生成后比对”的检查。
//       这个口径不逐行判生成物，它与源码一致不一致全靠那道检查；检查不在 CI 里，这个口径就是空的。
//   二、分类脚本照这个口径怎么判：内容有变、新增算只增并列出；删除、条目没写 check、判不出的算放松。

const script = join(repoRoot, "infra/ci/classify-gate-changes.mjs");
const read = (path: string) => readFileSync(join(repoRoot, path), "utf8");
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

const CONTRACT = "packages/contract/generated";
const DESIGN = "packages/shared/src/design/generated";

interface Entry {
  pattern: string;
  kind: string;
  check?: unknown;
  note?: string;
  except?: string[];
}

const registry = JSON.parse(read("infra/ci/gate-files.json")) as { files: Entry[] };
const ci = read(".github/workflows/ci.yml");
const rootScripts = (JSON.parse(read("package.json")) as { scripts: Record<string, string> })
  .scripts;

// ---------- 一、check 写的检查确实在 CI 里跑 ----------

const indentOf = (line: string) => line.length - line.trimStart().length;

/** 一个任务的正文：它的键下面的各行，不含空行与注释。按行读：工作流的写法由 workflows.test.ts 保证按行读得准 */
function jobLines(workflow: string, id: string): string[] {
  const lines = workflow.split("\n");
  const start = lines.indexOf(`  ${id}:`);
  if (start < 0) return [];
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    if (indentOf(line) < 4) break;
    body.push(line);
  }
  return body;
}

/** 一个任务的各个步骤（每个步骤是它的那几行） */
function jobSteps(workflow: string, id: string): string[][] {
  const steps: string[][] = [];
  let inSteps = false;
  for (const line of jobLines(workflow, id)) {
    if (indentOf(line) === 4) inSteps = line === "    steps:";
    else if (inSteps && line.startsWith("      - ")) steps.push([line]);
    else if (inSteps) steps.at(-1)?.push(line);
  }
  return steps;
}

/**
 * 必过任务：required 的 needs 里列的任务，去掉自己带 if 的（带条件的任务会被跳过，比如只在 PR 上跑的 gate-classify）。
 * 必过检查拆成并行任务之后，检查不都在 verify 里：要连库的在 test。不在 needs 里的任务没过，required 照样绿，不算。
 */
function requiredJobs(workflow: string): string[] {
  const needs: string[] = [];
  let inNeeds = false;
  for (const line of jobLines(workflow, "required")) {
    if (indentOf(line) === 4) inNeeds = line === "    needs:";
    else if (inNeeds && /^ {6}- [\w-]+$/.test(line)) needs.push(line.slice(8));
  }
  return needs.filter((id) => !jobLines(workflow, id).some((line) => /^ {4}if:/.test(line)));
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * generated 条目的问题：没写 check；check 不是某个必过任务里单独的一步（逐字的一行 run，不带条件）；
 * check 背后的根脚本不是“重新生成 → git diff --exit-code -- 条目的那个目录”。没有问题时返回空数组。
 */
function generatedEntryProblems(
  entries: Entry[],
  workflow: string,
  scripts: Record<string, string>,
): string[] {
  const problems: string[] = [];
  const conditional = (step: string[]) =>
    step.some((line) => /^(?: {6}- | {8})(?:if|continue-on-error):/.test(line));
  const steps = requiredJobs(workflow).flatMap((id) =>
    jobSteps(workflow, id).map((lines) => ({ id, lines })),
  );
  for (const entry of entries.filter((item) => item.kind === "generated")) {
    const where = `条目 ${entry.pattern}`;
    const check = typeof entry.check === "string" ? entry.check.trim() : "";
    if (check === "") {
      problems.push(`${where}：没写检查命令（check）`);
      continue;
    }
    const found = steps.filter((step) => step.lines.includes(`        run: ${check}`));
    if (found.length === 0) {
      problems.push(`${where}：检查命令 ${check} 不是 ci.yml 的必过任务里单独的一步`);
    } else if (found.every((step) => conditional(step.lines))) {
      problems.push(`${where}：${found[0]?.id} 里跑 ${check} 的那一步带了条件，不是每次都跑`);
    }
    const dir = entry.pattern.endsWith("/**") ? entry.pattern.slice(0, -3) : "";
    if (dir === "" || dir.includes("*")) {
      problems.push(`${where}：匹配式要写成“目录/**”，检查比对的才是整个目录`);
      continue;
    }
    const name = check.match(/^pnpm ([\w:-]+)$/)?.[1];
    const body = name === undefined ? undefined : scripts[name];
    if (name === undefined || body === undefined) {
      problems.push(`${where}：检查命令 ${check} 不是“pnpm <根脚本>”`);
      continue;
    }
    const shape = new RegExp(
      `^pnpm ([\\w:-]+) && git diff --exit-code -- ${escapeRegExp(dir)}(?: && [^|;&\\n]+)*$`,
    );
    const generate = body.match(shape)?.[1];
    if (generate === undefined || generate === name || scripts[generate] === undefined) {
      problems.push(
        `${where}：根脚本 ${name} 不是“重新生成 → git diff --exit-code -- ${dir}”：${body}`,
      );
    }
  }
  return problems;
}

describe("清单里的 generated 条目：写的检查确实在 CI 里跑", () => {
  const generated = registry.files.filter((entry) => entry.kind === "generated");

  it("两处生成物目录都按 generated 登记，各写了把关它的检查命令", () => {
    // 以后再登记别的生成物目录，不用改这一条；下一条对清单里全部 generated 条目逐个核对
    const pairs = generated.map((entry) => [entry.pattern, entry.check]);
    expect(pairs).toContainEqual([`${CONTRACT}/**`, "pnpm contract:check"]);
    expect(pairs).toContainEqual([`${DESIGN}/**`, "pnpm design:check"]);
  });

  it("每个条目的检查命令都是某个必过任务里单独的一步、不带条件；背后的根脚本先重新生成，再对该目录 git diff --exit-code", () => {
    expect(generated.length).toBeGreaterThan(0);
    expect(generatedEntryProblems(registry.files, ci, rootScripts)).toEqual([]);
  });

  describe("反例：上面那条断言要能把它们查出来", () => {
    const SNAPSHOT: Entry = {
      pattern: "packages/db/snapshot/**",
      kind: "generated",
      check: "pnpm db:snapshot-check",
    };
    const SNAPSHOT_SCRIPTS = {
      ...rootScripts,
      "db:snapshot": "pnpm --filter @liyoxi/db snapshot",
      "db:snapshot-check": "pnpm db:snapshot && git diff --exit-code -- packages/db/snapshot",
    };
    const CONTRACT_STEP = "      - name: contract:check\n        run: pnpm contract:check\n";
    const withCi = (from: string, to: string) => {
      if (!ci.includes(from)) throw new Error(`ci.yml 里没有：${from}`);
      return ci.replace(from, to);
    };
    const contractOnly = [`条目 ${CONTRACT}/**`];
    const NOT_A_STEP = "：检查命令 pnpm contract:check 不是 ci.yml 的必过任务里单独的一步";
    /** 把那一步从 verify 拿掉，接到另一个已有任务的末尾（那个任务的最后一步之后、下一个任务之前） */
    const movedTo = (id: string) => {
      const without = withCi(CONTRACT_STEP, "");
      const next = without.indexOf("\n\n", without.indexOf(`\n  ${id}:\n`));
      if (next < 0) throw new Error(`ci.yml 里找不到任务 ${id} 的末尾`);
      return `${without.slice(0, next + 1)}${CONTRACT_STEP}${without.slice(next + 1)}`;
    };

    it("夹具本身没有问题：把样例条目写的那一步加进 verify，就没有问题", () => {
      const withStep = withCi(
        CONTRACT_STEP,
        `${CONTRACT_STEP}      - name: 结构快照无差异\n        run: pnpm db:snapshot-check\n`,
      );
      expect(generatedEntryProblems([SNAPSHOT], withStep, SNAPSHOT_SCRIPTS)).toEqual([]);
    });

    it("登记了 generated，而它写的检查命令不在 CI 里：查得出", () => {
      expect(generatedEntryProblems([SNAPSHOT], ci, SNAPSHOT_SCRIPTS)).toEqual([
        "条目 packages/db/snapshot/**：检查命令 pnpm db:snapshot-check 不是 ci.yml 的必过任务里单独的一步",
      ]);
    });

    const workflows: Array<[string, string, string]> = [
      ["verify 里的那一步被拿掉", withCi(CONTRACT_STEP, ""), NOT_A_STEP],
      [
        "那一步挪到了不在 required 的 needs 里的任务",
        `${withCi(CONTRACT_STEP, "")}\n  extra:\n    name: extra\n    runs-on: *runner\n    steps:\n${CONTRACT_STEP}`,
        NOT_A_STEP,
      ],
      [
        "那一步挪到了在 needs 里、自己却带条件的任务（只在 PR 上跑）",
        movedTo("gate-classify"),
        NOT_A_STEP,
      ],
      [
        "那一步被注释掉",
        withCi(
          CONTRACT_STEP,
          "      # - name: contract:check\n      #   run: pnpm contract:check\n",
        ),
        NOT_A_STEP,
      ],
      [
        "命令后面接了别的（失败也算过）",
        withCi("        run: pnpm contract:check\n", "        run: pnpm contract:check || true\n"),
        NOT_A_STEP,
      ],
      [
        "命令只出现在多行脚本里，不是单独的一步",
        withCi(
          "        run: pnpm contract:check\n",
          "        run: |\n          echo 有差异也往下走\n          pnpm contract:check || true\n",
        ),
        NOT_A_STEP,
      ],
      [
        "那一步带了条件",
        withCi(CONTRACT_STEP, `${CONTRACT_STEP}        if: github.event_name == 'push'\n`),
        "：verify 里跑 pnpm contract:check 的那一步带了条件，不是每次都跑",
      ],
      [
        "那一步带了条件，条件写在步骤开头",
        withCi(
          CONTRACT_STEP,
          "      - if: github.event_name == 'push'\n        name: contract:check\n        run: pnpm contract:check\n",
        ),
        "：verify 里跑 pnpm contract:check 的那一步带了条件，不是每次都跑",
      ],
      [
        "那一步失败了也往下走，写在步骤开头",
        withCi(
          CONTRACT_STEP,
          "      - continue-on-error: true\n        name: contract:check\n        run: pnpm contract:check\n",
        ),
        "：verify 里跑 pnpm contract:check 的那一步带了条件，不是每次都跑",
      ],
    ];

    it("那一步挪到了另一个必过任务里：不算问题（要连库的检查在 test，不在 verify）", () => {
      const moved = movedTo("test");
      expect(jobSteps(moved, "verify").flat()).not.toContain("        run: pnpm contract:check");
      expect(jobSteps(moved, "test").flat()).toContain("        run: pnpm contract:check");
      expect(generatedEntryProblems(registry.files, moved, rootScripts)).toEqual([]);
    });

    it("必过任务认的是 required 的 needs：现在的工作流里有 verify 与 test，没有带条件的 gate-classify", () => {
      const jobs = requiredJobs(ci);
      expect(jobs).toContain("verify");
      expect(jobs).toContain("test");
      expect(jobs).not.toContain("gate-classify");
      expect(jobs).not.toContain("required");
      // 上面“挪到带条件的任务”那一例确实把那一步放进了 gate-classify
      expect(jobSteps(movedTo("gate-classify"), "gate-classify").flat()).toContain(
        "        run: pnpm contract:check",
      );
    });

    it.each(workflows)("工作流里%s：查得出", (_label, workflow, problem) => {
      expect(generatedEntryProblems(registry.files, workflow, rootScripts)).toEqual(
        contractOnly.map((where) => `${where}${problem}`),
      );
    });

    const entries: Array<[string, Entry, string]> = [
      ["没写 check", { pattern: SNAPSHOT.pattern, kind: "generated" }, "：没写检查命令（check）"],
      ["check 是空白", { ...SNAPSHOT, check: "  " }, "：没写检查命令（check）"],
      ["check 不是字符串", { ...SNAPSHOT, check: true }, "：没写检查命令（check）"],
      [
        "匹配式不是整个目录",
        { ...SNAPSHOT, pattern: "packages/db/snapshot/*.sql" },
        "：匹配式要写成“目录/**”，检查比对的才是整个目录",
      ],
    ];

    it.each(entries)("条目%s：查得出", (_label, entry, problem) => {
      const withStep = withCi(
        CONTRACT_STEP,
        `${CONTRACT_STEP}      - name: 结构快照无差异\n        run: pnpm db:snapshot-check\n`,
      );
      expect(generatedEntryProblems([entry], withStep, SNAPSHOT_SCRIPTS)).toEqual([
        `条目 ${entry.pattern}${problem}`,
      ]);
    });

    const scripts: Array<[string, string]> = [
      ["只重新生成、不比对", "pnpm contract:generate"],
      ["只比对、不重新生成", `git diff --exit-code -- ${CONTRACT}`],
      [
        "比对的是别的目录",
        "pnpm contract:generate && git diff --exit-code -- packages/contract/src",
      ],
      [
        "比对不带 --exit-code（有差异也不失败）",
        `pnpm contract:generate && git diff -- ${CONTRACT}`,
      ],
      [
        "后面接了失败也算过的写法",
        `pnpm contract:generate && git diff --exit-code -- ${CONTRACT} || true`,
      ],
      [
        "后面把比对的结果丢掉（接一条放到后台的命令，整条的退出码是 0）",
        `pnpm contract:generate && git diff --exit-code -- ${CONTRACT} && true & true`,
      ],
      [
        "后面换行再接一条命令",
        `pnpm contract:generate && git diff --exit-code -- ${CONTRACT}\ntrue`,
      ],
      ["“重新生成”那一步是它自己", `pnpm contract:check && git diff --exit-code -- ${CONTRACT}`],
      [
        "“重新生成”那一步不是根脚本",
        `pnpm contract:nothing && git diff --exit-code -- ${CONTRACT}`,
      ],
    ];

    it.each(scripts)("根脚本%s：查得出", (_label, body) => {
      const mutated = { ...rootScripts, "contract:check": body };
      expect(generatedEntryProblems(registry.files, ci, mutated)).toEqual([
        `条目 ${CONTRACT}/**：根脚本 contract:check 不是“重新生成 → git diff --exit-code -- ${CONTRACT}”：${body}`,
      ]);
    });

    it("检查命令不是根脚本（直接写了一条命令）：查得出", () => {
      const direct = { ...SNAPSHOT, check: "node scripts/snapshot-check.mjs" };
      const withStep = withCi(
        CONTRACT_STEP,
        `${CONTRACT_STEP}      - name: 结构快照无差异\n        run: node scripts/snapshot-check.mjs\n`,
      );
      expect(generatedEntryProblems([direct], withStep, SNAPSHOT_SCRIPTS)).toEqual([
        "条目 packages/db/snapshot/**：检查命令 node scripts/snapshot-check.mjs 不是“pnpm <根脚本>”",
      ]);
    });
  });
});

// ---------- 二、分类脚本照 generated 口径怎么判 ----------

const OPENAPI = {
  openapi: "3.1.0",
  info: { title: "狸有戏 · 商家端", version: "0.1.0" },
  paths: {},
  components: {
    schemas: { DictRef: { type: "object", properties: { code: { type: "string" } } } },
  },
};
const SCSS = "// 生成物，勿手改\n$lyx-radius-card: 14px;\n$lyx-space-page: 16px;\n";

const baseFiles: Record<string, string> = {
  [`${CONTRACT}/merchant.openapi.json`]: json(OPENAPI),
  [`${CONTRACT}/merchant.d.ts`]: "export interface paths {}\n",
  [`${DESIGN}/merchant.scss`]: SCSS,
  "src/app.ts": "export const a = 1;\n",
};

interface Item {
  file: string;
  what: string;
}
interface Outcome {
  status: number;
  output: string;
  verdict: string;
  touch: Item[];
  loosen: Item[];
}

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

/**
 * 基线之上做一批改动，跑分类脚本。changes 的值为 null 表示删除，函数表示直接在目录里动手（改属性、换成链接）。
 * 缺省用仓库里真实的清单；给了 registryFiles 就把它写成临时清单，经 --gate-files 交给脚本。
 */
function classify(
  changes: Record<string, string | null | ((file: string) => void)>,
  { registryFiles, args = [] }: { registryFiles?: Entry[]; args?: string[] } = {},
  base: Record<string, string> = baseFiles,
): Outcome {
  const temp = makeTempRepo("lyx-gate-generated-", base);
  cleanups.push(temp.cleanup);
  git(temp.dir, "commit", "-q", "-m", "base");
  for (const [path, change] of Object.entries(changes)) {
    if (change === null) rmSync(join(temp.dir, path));
    else if (typeof change === "function") change(join(temp.dir, path));
    else writeFiles(temp.dir, { [path]: change });
  }
  git(temp.dir, "add", "-A");
  git(temp.dir, "commit", "-q", "--allow-empty", "-m", "head");
  const out = join(temp.dir, ".result.json");
  const custom: string[] = [];
  if (registryFiles !== undefined) {
    // 临时清单放在 .git 里：不进提交，不算这次的改动
    writeFiles(temp.dir, { ".git/lyx-gate-files.json": json({ files: registryFiles }) });
    custom.push("--gate-files", join(temp.dir, ".git/lyx-gate-files.json"));
  }
  const result = spawnSync("node", [script, "--base", "HEAD~1", "--out", out, ...custom, ...args], {
    cwd: temp.dir,
    encoding: "utf8",
  });
  const parsed = existsSync(out)
    ? (JSON.parse(readFileSync(out, "utf8")) as Pick<Outcome, "verdict" | "touch" | "loosen">)
    : { verdict: "", touch: [], loosen: [] };
  return { status: result.status ?? -1, output: `${result.stdout}\n${result.stderr}`, ...parsed };
}

const whats = (items: Item[]) => items.map((item) => `${item.file}: ${item.what}`);
const byContract = "与源码一致由 `pnpm contract:check` 把关";
const byDesign = "与源码一致由 `pnpm design:check` 把关";

describe("门禁改动分类：generated 口径", () => {
  it("改一个已有设计变量的取值后重新生成：已有的行有变，判只增，列出并写明由哪道检查把关", () => {
    const result = classify({
      [`${DESIGN}/merchant.scss`]: SCSS.replace("14px", "12px"),
    });
    expect(result.status).toBe(0);
    expect(result.verdict).toBe("touch");
    expect(whats(result.touch)).toEqual([
      `${DESIGN}/merchant.scss: 重新生成的生成物，内容有变：加 1 行、删 1 行（${byDesign}）`,
    ]);
    expect(result.output).toContain("判定：只增（`gate-touch`）");
    expect(result.output).toContain(
      `- \`${DESIGN}/merchant.scss\`：重新生成的生成物，内容有变：加 1 行、删 1 行（${byDesign}）`,
    );
  });

  it("登记一条路由后重新生成契约：已有的行被改、加的行里有 minLength 与带 skip 的键，照样判只增并列出", () => {
    // 这类行按 append 判会命中“关掉、降级检查”的关键字（W0-08 状态文件偏差 10 的实测）；generated 不逐行判
    const next = {
      ...OPENAPI,
      paths: {
        "/v1/samples": {
          get: {
            operationId: "listSamples",
            parameters: [
              { name: "skipCount", in: "query", schema: { type: "integer", minimum: 0 } },
              { name: "keyword", in: "query", schema: { type: "string", minLength: 1 } },
            ],
          },
        },
      },
    };
    const result = classify({
      [`${CONTRACT}/merchant.openapi.json`]: json(next),
      [`${CONTRACT}/merchant.d.ts`]:
        'export interface paths {\n  "/v1/samples": { get: operations["listSamples"] };\n}\n',
    });
    expect(result.status).toBe(0);
    expect(whats(result.loosen)).toEqual([]);
    expect(result.touch.map((item) => item.file)).toEqual([
      `${CONTRACT}/merchant.d.ts`,
      `${CONTRACT}/merchant.openapi.json`,
    ]);
    for (const item of result.touch) {
      expect(item.what).toMatch(/^重新生成的生成物，内容有变：加 \d+ 行、删 \d+ 行（/);
      expect(item.what).toContain(byContract);
    }
  });

  it("新增一份生成物：只增并列出", () => {
    const result = classify({
      [`${CONTRACT}/portal.openapi.json`]: json(OPENAPI),
      [`${DESIGN}/admin.scss`]: SCSS,
    });
    expect(result.status).toBe(0);
    expect(whats(result.touch)).toEqual([
      `${CONTRACT}/portal.openapi.json: 新增生成物（${byContract}）`,
      `${DESIGN}/admin.scss: 新增生成物（${byDesign}）`,
    ]);
  });

  it.each([[`${CONTRACT}/merchant.d.ts`], [`${DESIGN}/merchant.scss`]])(
    "删掉一份已有的生成物（%s）：放松，没有 gate-change 标签即失败",
    (path) => {
      const result = classify({ [path]: null });
      expect(result.verdict).toBe("loosen");
      expect(whats(result.loosen)).toEqual([`${path}: 删除了门禁文件`]);
      expect(result.status).toBe(1);
      expect(result.output).toContain("没有 gate-change 标签");
    },
  );

  it("删掉一份、同时重新生成另一份：只增与放松并存，仍按放松判", () => {
    const result = classify({
      [`${CONTRACT}/merchant.d.ts`]: null,
      [`${DESIGN}/merchant.scss`]: SCSS.replace("14px", "12px"),
    });
    expect(result.verdict).toBe("loosen");
    expect(result.touch).toHaveLength(1);
    expect(result.status).toBe(1);
  });

  it("内容没变、只改了文件属性（加上可执行位）：判不出，按放松算", () => {
    const result = classify({
      [`${DESIGN}/merchant.scss`]: (file) => chmodSync(file, 0o755),
    });
    expect(whats(result.loosen)).toEqual([
      `${DESIGN}/merchant.scss: 生成物的内容没变而文件属性有变，判不出`,
    ]);
    expect(result.status).toBe(1);
  });

  it("生成物换成了符号链接：判不出，按放松算", () => {
    const result = classify({
      [`${DESIGN}/merchant.scss`]: (file) => {
        rmSync(file);
        symlinkSync("../../../../../src/app.ts", file);
      },
    });
    expect(whats(result.loosen)).toEqual([
      `${DESIGN}/merchant.scss: 生成物的文件类型有变（git 状态 T），判不出`,
    ]);
    expect(result.status).toBe(1);
  });

  describe("条目没写把关它的检查命令：判不出，按放松算", () => {
    const withoutCheck: Array<[string, Entry]> = [
      ["没有 check 字段", { pattern: `${DESIGN}/**`, kind: "generated" }],
      ["check 是空串", { pattern: `${DESIGN}/**`, kind: "generated", check: "" }],
      ["check 只有空白", { pattern: `${DESIGN}/**`, kind: "generated", check: "  " }],
      ["check 不是字符串", { pattern: `${DESIGN}/**`, kind: "generated", check: true }],
    ];
    const reason = `条目 \`${DESIGN}/**\` 没有写明把关它的检查命令（check），判不出这份生成物与源码是否一致`;

    it.each(withoutCheck)("%s：改已有的生成物", (_label, entry) => {
      const result = classify(
        { [`${DESIGN}/merchant.scss`]: SCSS.replace("14px", "12px") },
        { registryFiles: [entry] },
      );
      expect(result.verdict).toBe("loosen");
      expect(whats(result.loosen)).toEqual([`${DESIGN}/merchant.scss: ${reason}`]);
      expect(result.touch).toEqual([]);
      expect(result.status).toBe(1);
      expect(result.output).toContain("没有 gate-change 标签");
    });

    it("新增生成物也一样", () => {
      const result = classify(
        { [`${DESIGN}/admin.scss`]: SCSS },
        { registryFiles: [{ pattern: `${DESIGN}/**`, kind: "generated" }] },
      );
      expect(whats(result.loosen)).toEqual([`${DESIGN}/admin.scss: ${reason}`]);
      expect(result.status).toBe(1);
    });
  });

  it("同一个文件还命中别的条目：各判各的，别的条目判放松就是放松（generated 盖不住别的口径）", () => {
    const result = classify(
      { [`${DESIGN}/merchant.scss`]: SCSS.replace("14px", "12px") },
      {
        registryFiles: [
          { pattern: `${DESIGN}/**`, kind: "generated", check: "pnpm design:check" },
          { pattern: `${DESIGN}/merchant.scss`, kind: "frozen", note: "某个放行文件" },
        ],
      },
    );
    expect(whats(result.loosen)).toEqual([`${DESIGN}/merchant.scss: 改了某个放行文件`]);
    expect(result.touch).toHaveLength(1);
    expect(result.status).toBe(1);
  });

  it("生成物之外的源码照旧不算门禁改动；带 gate-change 的 PR 可以删生成物", () => {
    expect(classify({ "src/app.ts": "export const a = 2;\n" }).verdict).toBe("none");
    const result = classify(
      { [`${CONTRACT}/merchant.d.ts`]: null },
      { args: ["--labels", "gate-change"] },
    );
    expect(result.verdict).toBe("loosen");
    expect(result.status).toBe(0);
  });
});

describe("门禁文件清单里的 generated 条目本身", () => {
  const REGISTRY_BASE = {
    files: [
      { pattern: "infra/ci/**", kind: "append" },
      { pattern: `${DESIGN}/**`, kind: "generated", check: "pnpm design:check" },
    ],
  };
  const base = { ...baseFiles, "infra/ci/gate-files.json": json(REGISTRY_BASE) };
  const withFiles = (files: Entry[]) => ({ "infra/ci/gate-files.json": json({ files }) });

  it("新登记一个 generated 条目：只增，清单里带上它的检查命令给业主看", () => {
    const result = classify(
      withFiles([
        ...REGISTRY_BASE.files,
        { pattern: "packages/db/snapshot/**", kind: "generated", check: "pnpm db:snapshot-check" },
      ]),
      {},
      base,
    );
    expect(result.verdict).toBe("touch");
    expect(whats(result.touch)).toEqual([
      "infra/ci/gate-files.json: 新增门禁文件条目 `packages/db/snapshot/**`（generated，检查：pnpm db:snapshot-check）",
    ]);
  });

  it("新登记的 generated 条目没写检查命令：清单里写明“没写”", () => {
    const result = classify(
      withFiles([
        ...REGISTRY_BASE.files,
        { pattern: "packages/db/snapshot/**", kind: "generated" },
      ]),
      {},
      base,
    );
    expect(whats(result.touch)).toEqual([
      "infra/ci/gate-files.json: 新增门禁文件条目 `packages/db/snapshot/**`（generated，检查：没写）",
    ]);
  });

  it.each([
    ["换一条检查命令", { pattern: `${DESIGN}/**`, kind: "generated", check: "pnpm lint" }],
    ["拿掉检查命令", { pattern: `${DESIGN}/**`, kind: "generated" }],
    [
      "加 except 把一部分生成物划出去",
      {
        pattern: `${DESIGN}/**`,
        kind: "generated",
        check: "pnpm design:check",
        except: [`${DESIGN}/*.scss`],
      },
    ],
  ] as Array<[string, Entry]>)("已有的 generated 条目%s：放松", (_label, entry) => {
    const result = classify(withFiles([REGISTRY_BASE.files[0] as Entry, entry]), {}, base);
    expect(whats(result.loosen)).toEqual([
      `infra/ci/gate-files.json: 改了已有的门禁文件条目 \`${DESIGN}/**\``,
    ]);
    expect(result.status).toBe(1);
  });

  it("把别的口径的已有条目改成 generated：放松", () => {
    const result = classify(
      withFiles([
        { pattern: "infra/ci/**", kind: "generated", check: "pnpm design:check" },
        REGISTRY_BASE.files[1] as Entry,
      ]),
      {},
      base,
    );
    expect(whats(result.loosen)).toEqual([
      "infra/ci/gate-files.json: 改了已有的门禁文件条目 `infra/ci/**`",
    ]);
    expect(result.status).toBe(1);
  });
});
