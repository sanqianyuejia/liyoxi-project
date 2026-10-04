import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { repoRoot } from "./helpers.js";

// 工作流与本地 Compose 的写法约束（W0-03 任务书 第 10 节第 1、3、6 步，第 11 节第 4、6、10 项）。
// 不引 YAML 解析器：这两类文件的缩进由 Prettier 固定，按行读即可。

const workflowsDir = join(repoRoot, ".github/workflows");
const read = (path: string) => readFileSync(join(repoRoot, path), "utf8");
const ci = read(".github/workflows/ci.yml");
const nightly = read(".github/workflows/nightly.yml");
const compose = read("infra/compose/local.yml");

interface Job {
  id: string;
  /** 任务键下面的行（四格及更深的缩进，不含空行） */
  lines: string[];
}

const TOP_KEY = /^[a-z][\w-]*:(?: \S.*)?$/;
const JOB_KEY = /^ {2}([\w-]+):$/;
const JOB_FIELD = /^ {4}([a-z][\w-]*):(?: \S.*)?$/;
const indentOf = (line: string) => line.length - line.trimStart().length;
const isComment = (line: string) => line.trimStart().startsWith("#");

/**
 * 按行读一个工作流，并核对它的写法：认不出就算问题。
 * 下面的断言（检查名、任务清单、needs、runs-on）都按行读，所以先要保证按行读到的就是平台解析出来的。
 *   顶格的行：只能是注释，或不带引号的键。“jobs:” 要逐字一行、恰好一次，冒号后面不带任何东西
 *   jobs 段里缩进不到四格的行：只能是注释，或两格缩进的任务编号（“  <编号>:”，不带引号，冒号后面不带任何东西）
 *   任务下面四格缩进的行：只能是注释，或不带引号的键；其中 name 恰好一行，且逐字是 “    name: <任务编号>”
 * 带引号的键、行尾注释、行内写法、锚点与别名、合并键、换一种缩进，都算认不出：这些写法 Prettier 原样保留，
 * 平台照常解析，按行读却读不到。
 */
function shapeOf(workflow: string): { jobs: Job[]; problems: string[] } {
  const jobs: Job[] = [];
  const problems: string[] = [];
  let jobsLines = 0;
  let inJobs = false;
  let current: Job | null = null;
  let keyed = false;
  for (const line of workflow.split("\n")) {
    if (line.trim() === "") continue;
    const indent = indentOf(line);
    if (/\t/.test(line.slice(0, indent))) problems.push(`缩进里有制表符：${line.trim()}`);
    if (indent === 0) {
      if (isComment(line)) continue;
      inJobs = line === "jobs:";
      current = null;
      if (inJobs) jobsLines += 1;
      else if (!TOP_KEY.test(line)) problems.push(`顶格的行认不出：${line}`);
    } else if (!inJobs) {
      continue;
    } else if (indent < 4) {
      if (isComment(line)) continue;
      const id = line.match(JOB_KEY)?.[1];
      current = id === undefined ? null : { id, lines: [] };
      keyed = true;
      if (current) jobs.push(current);
      else problems.push(`jobs 段里缩进不到四格的行认不出：${line}`);
    } else if (current) {
      current.lines.push(line);
    } else if (!keyed && !isComment(line)) {
      // 任务编号写在四格或更深的缩进上：一个任务都读不到
      keyed = true;
      problems.push(`jobs 段里任务编号之前就有内容，认不出：${line.trim()}`);
    }
  }
  if (jobsLines !== 1) {
    problems.push(`逐字的 “jobs:” 一行要恰好出现一次，现在是 ${jobsLines} 次`);
  }
  for (const job of jobs) {
    const fields = job.lines.filter((line) => indentOf(line) === 4 && !isComment(line));
    for (const line of fields) {
      if (!JOB_FIELD.test(line)) problems.push(`任务 ${job.id} 下面四格缩进的行认不出：${line}`);
    }
    const names = fields.filter((line) => line.match(JOB_FIELD)?.[1] === "name");
    if (names.length !== 1 || names[0] !== `    name: ${job.id}`) {
      problems.push(
        `任务 ${job.id} 下面要恰好有一行 “name: ${job.id}”（检查名与任务编号相同），现在是：${names.length === 0 ? "没有" : names.map((line) => line.trim()).join("；")}`,
      );
    }
  }
  return { jobs, problems };
}

/** jobs: 下一级的键，即各任务的编号。写法合规时（shapeOf 没有问题）它也就是各任务在平台上的检查名 */
function jobIds(workflow: string): string[] {
  return shapeOf(workflow).jobs.map((job) => job.id);
}

/** 一个任务的全文：它的键下面的行，到下一个任务的键为止 */
function jobBody(workflow: string, id: string): string {
  return (shapeOf(workflow).jobs.find((job) => job.id === id)?.lines ?? []).join("\n");
}

/**
 * 检查名的问题：工作流的写法认不出；任务的检查名与任务编号不同；同一个工作流里任务编号重复；
 * 必过的那个名字在全部工作流里不是恰好一个。
 * 重名时平台按哪一个算必过检查说不准：再加一个同名且恒成功的任务，就可能顶掉真的那个。
 */
function checkNameProblems(workflows: Record<string, string>, requiredName: string): string[] {
  const problems: string[] = [];
  const holders: string[] = [];
  for (const [file, text] of Object.entries(workflows)) {
    const shape = shapeOf(text);
    for (const problem of shape.problems) problems.push(`${file}：${problem}`);
    const ids = shape.jobs.map((job) => job.id);
    const repeated = [...new Set(ids.filter((id, at) => ids.indexOf(id) !== at))];
    for (const id of repeated) problems.push(`${file}：任务编号 ${id} 出现了不止一次`);
    for (const id of ids) if (id === requiredName) holders.push(file);
  }
  if (holders.length !== 1) {
    problems.push(
      `检查名 ${requiredName} 在全部工作流里要恰好出现一次，现在是 ${holders.length} 次${holders.length > 0 ? `（${holders.join("、")}）` : ""}`,
    );
  }
  return problems;
}

describe("全部工作流", () => {
  const files = readdirSync(workflowsDir).filter((name) => /\.ya?ml$/.test(name));
  const workflows = Object.fromEntries(
    files.map((name) => [name, read(`.github/workflows/${name}`)]),
  );

  it("必过检查名 required 在全部工作流里只出现一次；写法都认得出，每个任务的检查名就是任务编号", () => {
    expect(checkNameProblems(workflows, "required")).toEqual([]);
    expect(jobIds(ci)).toContain("required");
  });

  describe("重名的反例：上面那条断言要能把它们查出来", () => {
    const TAIL = ["    runs-on: ubuntu-24.04", "    steps:", '      - run: "true"', ""];
    const shadowJob = (id: string, name: string | null) =>
      [`  ${id}:`, ...(name === null ? [] : [`    name: ${name}`]), ...TAIL].join("\n");
    const HEAD = "name: extra\non:\n  pull_request:\npermissions:\n  contents: read\n";
    const extra = (job: string) => `${HEAD}jobs:\n${job}`;
    const TWICE = "检查名 required 在全部工作流里要恰好出现一次，现在是 2 次（ci.yml、extra.yml）";
    const nameOf = (id: string, now: string) =>
      `任务 ${id} 下面要恰好有一行 “name: ${id}”（检查名与任务编号相同），现在是：${now}`;

    // 另一个工作流里造一个也叫 required 的检查。前四种是写了能认出来的 name；后面几种是换一种
    // Prettier 原样保留、平台照常解析的写法，按行读不到：认不出就算问题
    const shadows: Array<[string, string, string[]]> = [
      [
        "任务的 name 是 required",
        extra(shadowJob("shadow", "required")),
        [`extra.yml：${nameOf("shadow", "name: required")}`],
      ],
      [
        "name 带引号",
        extra(shadowJob("shadow", '"required"')),
        [`extra.yml：${nameOf("shadow", 'name: "required"')}`],
      ],
      [
        "name 后面带注释",
        extra(shadowJob("shadow", "required # 恒成功")),
        [`extra.yml：${nameOf("shadow", "name: required # 恒成功")}`],
      ],
      [
        "没写 name，任务编号就是 required",
        extra(shadowJob("required", null)),
        [`extra.yml：${nameOf("required", "没有")}`, TWICE],
      ],
      ["任务编号是 required，name 也照规矩写", extra(shadowJob("required", "required")), [TWICE]],
      [
        "任务键带行尾注释",
        extra(["  shadow: # 说明", "    name: required", ...TAIL].join("\n")),
        ["extra.yml：jobs 段里缩进不到四格的行认不出：  shadow: # 说明"],
      ],
      [
        "任务键带引号，不写 name",
        extra(['  "required":', ...TAIL].join("\n")),
        ['extra.yml：jobs 段里缩进不到四格的行认不出：  "required":'],
      ],
      [
        "jobs 一行带行尾注释",
        `${HEAD}jobs: # 说明\n${shadowJob("required", null)}`,
        ["extra.yml：逐字的 “jobs:” 一行要恰好出现一次，现在是 0 次"],
      ],
      [
        "jobs 的键带引号",
        `${HEAD}"jobs":\n${shadowJob("required", null)}`,
        [
          'extra.yml：顶格的行认不出："jobs":',
          "extra.yml：逐字的 “jobs:” 一行要恰好出现一次，现在是 0 次",
        ],
      ],
      [
        "name 的键带引号",
        extra(["  shadow:", '    "name": required', ...TAIL].join("\n")),
        [
          'extra.yml：任务 shadow 下面四格缩进的行认不出：    "name": required',
          `extra.yml：${nameOf("shadow", "没有")}`,
        ],
      ],
      [
        "任务写成行内的一整段",
        extra('  shadow: { name: required, runs-on: ubuntu-24.04, steps: [{ run: "true" }] }\n'),
        [
          'extra.yml：jobs 段里缩进不到四格的行认不出：  shadow: { name: required, runs-on: ubuntu-24.04, steps: [{ run: "true" }] }',
        ],
      ],
      [
        "任务编号缩进三格",
        extra(["   required:", "     runs-on: ubuntu-24.04", "     steps:", ""].join("\n")),
        ["extra.yml：jobs 段里缩进不到四格的行认不出：   required:"],
      ],
      [
        "任务编号缩进四格",
        extra(["    required:", "        runs-on: ubuntu-24.04", ""].join("\n")),
        ["extra.yml：jobs 段里任务编号之前就有内容，认不出：required:"],
      ],
      [
        "任务的内容缩进五格，name 是 required",
        extra(["  shadow:", "     name: required", "     runs-on: ubuntu-24.04", ""].join("\n")),
        [`extra.yml：${nameOf("shadow", "没有")}`],
      ],
      [
        "任务整个引用一个锚点",
        extra(["  shadow: *job", ""].join("\n")),
        ["extra.yml：jobs 段里缩进不到四格的行认不出：  shadow: *job"],
      ],
      [
        "name 经合并键带进来",
        extra(["  shadow:", "    <<: *named", "    name: shadow", ...TAIL].join("\n")),
        ["extra.yml：任务 shadow 下面四格缩进的行认不出：    <<: *named"],
      ],
      [
        "name 写了两行，后一行是 required",
        extra(
          ["  shadow:", "    name: shadow", ...TAIL.slice(0, 3), "    name: required", ""].join(
            "\n",
          ),
        ),
        [`extra.yml：${nameOf("shadow", "name: shadow；name: required")}`],
      ],
    ];

    it.each(shadows)("另一个工作流里%s：查得出", (_label, text, expected) => {
      expect(checkNameProblems({ ...workflows, "extra.yml": text }, "required")).toEqual(expected);
    });

    it("ci.yml 末尾追加一个任务键带行尾注释、runs-on 的键带引号的任务：查得出", () => {
      const job = ["  shadow: # 说明", "    name: required", '    "runs-on": ubuntu-24.04', ""];
      const mutated = { ...workflows, "ci.yml": `${ci}\n${job.join("\n")}` };
      expect(checkNameProblems(mutated, "required")).toEqual([
        "ci.yml：jobs 段里缩进不到四格的行认不出：  shadow: # 说明",
      ]);
    });

    it("ci.yml 里再加一个 name 是 required 的任务：查得出", () => {
      const mutated = { ...workflows, "ci.yml": `${ci}\n${shadowJob("shadow", "required")}` };
      expect(checkNameProblems(mutated, "required")).toEqual([
        `ci.yml：${nameOf("shadow", "name: required")}`,
      ]);
    });

    it("同一个工作流里两个任务的检查名相同（不是 required 也算）", () => {
      const mutated = { ...workflows, "ci.yml": `${ci}\n${shadowJob("lint-again", "verify")}` };
      expect(checkNameProblems(mutated, "required")).toEqual([
        `ci.yml：${nameOf("lint-again", "name: verify")}`,
      ]);
    });

    it("任务编号重复（后写的顶掉前面的）", () => {
      const mutated = { ...workflows, "ci.yml": `${ci}\n${shadowJob("required", "required")}` };
      expect(checkNameProblems(mutated, "required")).toEqual([
        "ci.yml：任务编号 required 出现了不止一次",
        "检查名 required 在全部工作流里要恰好出现一次，现在是 2 次（ci.yml、ci.yml）",
      ]);
    });

    it("把 required 改了名：查出一次都没有", () => {
      const renamed = ci.replace("  required:\n    name: required\n", "  all:\n    name: all\n");
      expect(renamed).not.toBe(ci);
      expect(checkNameProblems({ ...workflows, "ci.yml": renamed }, "required")).toEqual([
        "检查名 required 在全部工作流里要恰好出现一次，现在是 0 次",
      ]);
    });

    it("只改 required 的 name、不改任务编号：查得出", () => {
      const renamed = ci.replace("    name: required\n", "    name: all\n");
      expect(checkNameProblems({ ...workflows, "ci.yml": renamed }, "required")).toEqual([
        `ci.yml：${nameOf("required", "name: all")}`,
      ]);
    });

    it("顶格多出一行认不出的内容（第二个文档、合并键之类）：查得出", () => {
      const text = `${extra(shadowJob("shadow", "shadow"))}---\n`;
      expect(checkNameProblems({ ...workflows, "extra.yml": text }, "required")).toEqual([
        "extra.yml：顶格的行认不出：---",
      ]);
    });
  });

  it.each(files)("%s：第三方 Action 固定到提交 SHA，行尾注明版本", (name) => {
    const uses = [...read(`.github/workflows/${name}`).matchAll(/^\s*(?:- )?uses: (.+)$/gm)].map(
      (match) => match[1] ?? "",
    );
    expect(uses.length).toBeGreaterThan(0);
    for (const use of uses) expect(use).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/);
  });

  it.each(files)("%s：不放密钥，不给步骤开免死牌，默认权限只读", (name) => {
    const text = read(`.github/workflows/${name}`);
    expect(text).not.toMatch(/\bsecrets\./);
    expect(text).not.toContain("continue-on-error");
    expect(text).not.toContain("pull_request_target");
    expect(text).toMatch(/^permissions:\n {2}contents: read\n/m);
    // 令牌有 checks、statuses 的写权限时，能经接口造出任意名字的检查（包括 required）：哪个工作流都不给
    expect(text).not.toMatch(/\bchecks\b|\bstatuses\b|write-all/);
  });
});

describe("ci.yml", () => {
  it("PR 与推到 main 时触发；PR 按分支分组，新提交取消在途的运行；推到 main 一个提交一组，互不顶替", () => {
    expect(ci).toMatch(/^on:\n {2}pull_request:\n {2}push:\n {4}branches: \[main\]\n/m);
    expect(ci).toContain("group: ci-${{ github.head_ref || github.sha }}");
    expect(ci).toContain("cancel-in-progress: ${{ github.event_name == 'pull_request' }}");
  });

  it("汇总任务 required 依赖其余全部任务，且无论前面成败都要跑", () => {
    const ids = jobIds(ci);
    expect(ids).toContain("required");
    const required = jobBody(ci, "required");
    const needs = [...(required.split(/^ {4}needs:\s*$/m)[1] ?? "").matchAll(/^ {6}- ([\w-]+)$/gm)]
      .map((match) => match[1])
      .sort();
    expect(needs).toEqual(ids.filter((id) => id !== "required").sort());
    expect(required).toMatch(/^ {4}if: always\(\)$/m);
    expect(required).toContain("node infra/ci/ci-required.mjs");
  });

  it("执行机只写在一处：一个锚点，其余任务引用它", () => {
    const runsOn = [...ci.matchAll(/^ {4}runs-on: (.+)$/gm)].map((match) => match[1]);
    expect(runsOn).toHaveLength(jobIds(ci).length);
    expect(runsOn.filter((value) => value !== "*runner")).toEqual(["&runner ubuntu-24.04"]);
  });

  it("verify 的步骤齐全，顺序照计划 第 5.5 节", () => {
    const commands = [...jobBody(ci, "verify").matchAll(/^ {8}run: (.+)$/gm)].map((m) => m[1]);
    expect(commands).toEqual([
      "pnpm install --frozen-lockfile",
      "pnpm lint",
      // 只认 .prettierignore：不让 .gitignore（不是门禁文件）决定哪些文件不查格式
      "pnpm format:check --ignore-path .prettierignore",
      "pnpm check:rename",
      "pnpm typecheck",
      "pnpm depcheck",
      "pnpm test",
      "pnpm -r --if-present build",
      "node infra/ci/check-env-example.mjs",
      "node infra/ci/secret-scan.mjs",
      "pnpm audit --prod --audit-level high --registry https://registry.npmjs.org/",
      'node infra/ci/check-release-age.mjs --since "$SINCE" --registry https://registry.npmjs.org/',
      "pnpm gates:selftest",
      "node infra/ci/status-summary.mjs --check",
    ]);
  });

  it("只有分类任务能写 PR；它只在 PR 上跑，用 main 上的脚本与清单", () => {
    const writers = jobIds(ci).filter((id) => /: write$/m.test(jobBody(ci, id)));
    expect(writers).toEqual(["gate-classify"]);
    const classify = jobBody(ci, "gate-classify");
    expect(classify).toMatch(/^ {4}if: github\.event_name == 'pull_request'$/m);
    expect(classify).toContain('git show "origin/$BASE_REF:infra/ci/classify-gate-changes.mjs"');
    expect(classify).toContain('node "$RUNNER_TEMP/gate/classify-gate-changes.mjs"');
  });

  it("Node 版本读 .nvmrc", () => {
    const versions = [...ci.matchAll(/^\s*node-version(?:-file)?: (.+)$/gm)].map((m) => m[1]);
    expect(new Set(versions)).toEqual(new Set([".nvmrc"]));
  });
});

describe("nightly.yml", () => {
  it("定时、手动、改到它自己的 PR 三种触发", () => {
    expect(nightly).toMatch(/^ {2}schedule:\n(?: {4}#.*\n)* {4}- cron: "/m);
    expect(nightly).toMatch(/^ {2}workflow_dispatch:$/m);
    expect(nightly).toMatch(
      /^ {2}pull_request:\n {4}paths:\n {6}- \.github\/workflows\/nightly\.yml$/m,
    );
  });

  it("在 Node 26 上装依赖、查类型、跑测试；关掉 engine-strict", () => {
    expect(nightly).toMatch(/^ {10}node-version: 26$/m);
    expect(nightly).toContain('NPM_CONFIG_ENGINE_STRICT: "false"');
    const commands = [...nightly.matchAll(/^ {8}run: (.+)$/gm)].map((match) => match[1]);
    expect(commands).toEqual(["pnpm install --frozen-lockfile", "pnpm typecheck", "pnpm test"]);
  });

  it("不在必过检查里：ci.yml 的任务清单里没有它", () => {
    expect(jobIds(nightly)).toEqual(["node26"]);
    expect(jobIds(ci)).not.toContain("node26");
  });
});

describe("本地 Compose 与 CI 的服务容器", () => {
  const imageOf = (text: string, service: string) =>
    text.match(new RegExp(`^ +${service}:\\n +image: (\\S+)$`, "m"))?.[1];

  it("项目名写死为 liyoxi，三个服务都有健康检查、固定的容器名与命名卷", () => {
    expect(compose).toMatch(/^name: liyoxi$/m);
    for (const service of ["postgres", "redis", "minio"]) {
      expect(compose).toMatch(
        new RegExp(`^ {2}${service}:\\n(?: {4}.*\\n)*? {4}container_name: lyx-${service}$`, "m"),
      );
    }
    expect(compose.match(/^ {4}healthcheck:$/gm)).toHaveLength(3);
    expect(compose.match(/^ {4}name: lyx-\w+$/gm)).toHaveLength(3);
  });

  it("端口只绑回环地址：PostgreSQL 5442、Redis 6389、MinIO 9100 与 9101；PostgreSQL 与 Redis 的镜像不用 latest，MinIO 用业主定的那一个，不设 TZ", () => {
    const ports = [...compose.matchAll(/^ {6}- "127\.0\.0\.1:(\d+:\d+)"$/gm)].map(
      (match) => match[1],
    );
    expect(ports).toEqual(["5442:5432", "6389:6379", "9100:9000", "9101:9001"]);
    const images = [...compose.matchAll(/^ {4}image: (\S+)$/gm)].map((match) => match[1] ?? "");
    expect(images).toHaveLength(3);
    for (const image of images.slice(0, 2)) expect(image).toMatch(/:(?!latest$)[\w.-]+$/);
    expect(images[0]).toMatch(/^postgres:17-/);
    expect(images[1]).toBe("redis:7.4-alpine");
    // MinIO 的来源与“只写 latest”是业主定的（状态文件偏差 1）；换来源或换标签要改这里。
    expect(images[2]).toBe("ghcr.io/byfire-dev/minio:latest");
    expect(compose).not.toMatch(/^\s*TZ:/m);
  });

  it("CI 的服务容器与本地用同一组镜像、端口与开发口令", () => {
    for (const service of ["postgres", "redis"]) {
      expect(imageOf(ci, service)).toBe(imageOf(compose, service));
    }
    expect(ci).toContain('ports: ["5442:5432"]');
    expect(ci).toContain('ports: ["6389:6379"]');
    const password = compose.match(/POSTGRES_PASSWORD: (\S+)/)?.[1];
    expect(ci).toContain(`POSTGRES_PASSWORD: ${password}`);
    expect(ci).toContain(`DATABASE_URL: postgresql://liyoxi:${password}@localhost:5442/liyoxi`);
  });
});
