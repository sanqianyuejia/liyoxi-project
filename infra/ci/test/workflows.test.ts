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

// 仅默认关闭的可信发布与回滚任务可引用明确的加密凭据；构建与其余工作流仍禁止。
const CREDENTIAL_JOBS: Record<string, { id: string; condition: string; keys: string[] }[]> = {
  "images.yml": [
    {
      id: "publish-images",
      condition:
        "vars.STG_IMAGES_PUBLISH_ENABLED == 'true' && github.ref == 'refs/heads/main' && (github.event_name == 'push' || github.event_name == 'workflow_dispatch')",
      keys: ["STG_REGISTRY_USERNAME", "STG_REGISTRY_PASSWORD", "GITHUB_TOKEN"],
    },
    {
      id: "publish-artifacts",
      condition:
        "vars.STG_IMAGES_PUBLISH_ENABLED == 'true' && vars.STG_ARTIFACT_UPLOAD_ENABLED == 'true' && github.ref == 'refs/heads/main' && (github.event_name == 'push' || github.event_name == 'workflow_dispatch')",
      keys: ["STG_COS_SECRET_ID", "STG_COS_SECRET_KEY"],
    },
    {
      id: "mirror-base",
      condition:
        "github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main' && vars.STG_IMAGES_PUBLISH_ENABLED == 'true' && inputs.mirror_base == true",
      keys: ["STG_REGISTRY_USERNAME", "STG_REGISTRY_PASSWORD", "GITHUB_TOKEN"],
    },
  ],
  "deploy-stg.yml": [
    {
      id: "deploy-stg",
      condition:
        "vars.STG_DEPLOY_ENABLED == 'true' && github.event.workflow_run.conclusion == 'success' && github.event.workflow_run.head_branch == 'main' && github.event.workflow_run.event == 'push' && github.event.workflow_run.head_repository.full_name == github.repository",
      keys: ["STG_SSH_PRIVATE_KEY", "STG_SSH_KNOWN_HOSTS"],
    },
  ],
  "rollback-stg.yml": [
    {
      id: "rollback-stg",
      condition:
        "github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main' && vars.STG_DEPLOY_ENABLED == 'true' && inputs.execute == true",
      keys: ["STG_SSH_PRIVATE_KEY", "STG_SSH_KNOWN_HOSTS"],
    },
  ],
};
function unapprovedCredentials(workflow: string, name: string): string {
  const approved = new Map<string, string[]>();
  for (const job of CREDENTIAL_JOBS[name] ?? []) {
    const body = jobBody(workflow, job.id);
    const conditions = body.split("\n").filter((line) => /^ {4}if:/.test(line));
    if (conditions.length !== 1 || conditions[0] !== `    if: ${job.condition}`) continue;
    // 凭据节点不能经锚点/别名带出任务。无凭据工作流的原有 runner 锚点仍由原检查处理。
    if (/(?:^|[\s[{,])[&*][\w-]+(?=\s|[,\]}]|$)/m.test(body)) continue;
    approved.set(job.id, job.keys);
  }
  let inJobs = false;
  let keys: string[] | undefined;
  // 只定位原始行，不拿 shapeOf 压缩过的正文替换原文；合法空行不改变任务范围。
  return workflow
    .split("\n")
    .map((line) => {
      if (line.trim() !== "" && !isComment(line)) {
        if (indentOf(line) === 0) {
          inJobs = line === "jobs:";
          keys = undefined;
        } else if (inJobs && indentOf(line) === 2) {
          keys = approved.get(line.match(JOB_KEY)?.[1] ?? "");
        }
      }
      return inJobs && keys
        ? line.replace(/\bsecrets\.([\w]+)/g, (reference: string, key: string) =>
            keys!.includes(key) ? "" : reference,
          )
        : line;
    })
    .join("\n");
}

describe("发布凭据例外的反例", () => {
  const fixture = (id: string, condition: string, keys: string[]) =>
    [
      "jobs:",
      `  ${id}:`,
      `    name: ${id}`,
      `    if: ${condition}`,
      "    env:",
      ...keys.map((key) => "      TOKEN_" + key + ": ${{ secrets." + key + " }}"),
      "",
    ].join("\n");
  it("批准任务内合法空行仍可引用凭据", () => {
    const job = CREDENTIAL_JOBS["images.yml"]![0]!;
    const valid = fixture(job.id, job.condition, job.keys).replace("    env:", "\n    env:");
    expect(unapprovedCredentials(valid, "images.yml")).not.toMatch(/\bsecrets\./);
  });
  it("批准凭据不能经env锚点流入构建任务，原无凭据runner锚点仍可用", () => {
    const job = CREDENTIAL_JOBS["images.yml"]![0]!;
    const anchored =
      fixture(job.id, job.condition, job.keys).replace("    env:", "    env: &credentials") +
      "  build:\n    name: build\n    env: *credentials\n";
    expect(unapprovedCredentials(anchored, "images.yml")).toMatch(/\bsecrets\./);
    const runner =
      "jobs:\n  build:\n    name: build\n    runs-on: &runner ubuntu-24.04\n  other:\n    name: other\n    runs-on: *runner\n";
    expect(unapprovedCredentials(runner, "ci.yml")).not.toMatch(/\bsecrets\./);
  });
  for (const [name, jobs] of Object.entries(CREDENTIAL_JOBS)) {
    for (const job of jobs) {
      it(`${name}/${job.id}：仅完整可信条件下批准的凭据可引用`, () => {
        const valid = fixture(job.id, job.condition, job.keys);
        expect(unapprovedCredentials(valid, name)).not.toMatch(/\bsecrets\./);
        for (const key of ["OTHER_SECRET", `${job.keys[0]}_EXTRA`])
          expect(unapprovedCredentials(fixture(job.id, job.condition, [key]), name)).toMatch(
            /\bsecrets\./,
          );
        for (const condition of [
          "true",
          `${job.condition} || true`,
          job.condition.replace("== 'true'", "!= 'true'"),
        ])
          expect(unapprovedCredentials(fixture(job.id, condition, job.keys), name)).toMatch(
            /\bsecrets\./,
          );
        expect(unapprovedCredentials(fixture("build", job.condition, job.keys), name)).toMatch(
          /\bsecrets\./,
        );
        expect(unapprovedCredentials(valid, "ci.yml")).toMatch(/\bsecrets\./);
        expect(
          unapprovedCredentials(
            valid +
              "  build:\n    name: build\n    env:\n      LEAK: ${{ secrets." +
              job.keys[0] +
              " }}\n",
            name,
          ),
        ).toMatch(/\bsecrets\./);
      });
    }
  }
});

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
    expect(unapprovedCredentials(text, name)).not.toMatch(/\bsecrets\./);
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

  // 必过任务并行跑：各任务各自装依赖、各起各的服务。
  // 往某个任务加一步时，在它那张清单的同一位置加一行；新增任务时在这里加一张清单（都是只增）。
  const INSTALL = "pnpm install --frozen-lockfile";
  // W0-05：数据库客户端不入库，类型检查与测试之前先生成
  const DB_GENERATE = "pnpm db:generate";
  // packages/db 的用例、枚举对账及其反例要连迁移库 lyx_migrate_check，W0-10 的 api-check、约束名核对
  // 及其用例与反例也读它：用到它的任务各建一份
  const MIGRATE = 'psql -X -w -d postgres -c "CREATE DATABASE lyx_migrate_check" && pnpm db:deploy';
  const MINIO_UP = "docker compose -f infra/compose/local.yml up -d --wait minio";
  // 已挂载清单由 apps/api 的探活用例写出，待落地数读它：先删旧的，跑完看文件在不在
  const EXPORT_MOUNTED =
    "rm -f apps/api/dist/mounted-operations.json && pnpm exec vitest run apps/api/test/probes.test.ts && test -s apps/api/dist/mounted-operations.json";
  // 测试隔离的每一片：各自生成客户端、建迁移库、起 MinIO，再跑分片脚本
  const ISOLATION_SETUP = [INSTALL, DB_GENERATE, MIGRATE, MINIO_UP];
  const STEPS: Record<string, string[]> = {
    // 静态检查，不连库
    verify: [
      INSTALL,
      "pnpm lint",
      // 只认 .prettierignore：不让 .gitignore（不是门禁文件）决定哪些文件不查格式
      "pnpm format:check --ignore-path .prettierignore",
      "pnpm check:rename",
      // W0-26：页面不写色值
      "pnpm lint:colors",
      // W1-05：文案约束（规范 第 11 节的词不出现在它管的页面与错误码的默认文案里）
      "pnpm lint:copy",
      DB_GENERATE,
      "pnpm typecheck",
      // 两个 React 大版本并存：类型解析不经 pnpm 的提升目录落到各工程装得不一样的包上
      "pnpm check:type-hoist",
      "pnpm depcheck",
      "pnpm db:validate",
      // W0-06b：迁移规范、草稿冻结守卫（不连库；结构防漂移其余四步在 test）
      'pnpm db:migration-lint --base "$BASE"',
      "pnpm db:draft-freeze:check",
      "pnpm contract:check",
      "pnpm contract:compat",
      // W0-09a：登记表对账（x01 名称登记与归属表）
      "pnpm registry:check",
      // W0-12：状态机迁移表与分组文档逐行对照
      "pnpm machines:check",
      "pnpm machines:coverage -- --strict --contract",
      "node infra/ci/check-stubs.mjs",
      // W0-09b：接口侧注册表对账（错误码、权限点、能力点、资源、场景、点位、埋点事件）
      "pnpm api-registries:check",
      // W0-10：路由元数据对账（不连库；其余四步在 test）
      "pnpm contract:docs-check",
      // W0-26：设计生成物无差异（它的下一步上传预览页，没有 run）
      "pnpm design:check",
      "node infra/ci/check-env-example.mjs",
      // 状态文件核对：只查状态文件合不合规；状态汇总不入库，不再与入库的文件比对
      "node infra/ci/status-summary.mjs --check",
      // W0-30a：状态字典键与契约枚举同名
      "pnpm status-tone:check",
      // W0-30：台账单项文件核对（留桩、计划变更、外部验证）；三张汇总不入库
      "node infra/ci/plan-summaries.mjs --check",
    ],
    // 各包的用例：infra 以外的测试项目
    test: [
      INSTALL,
      DB_GENERATE,
      // W0-05：首版迁移的等价性证明，排在“测试”之前（上传比对报告那一步没有 run）
      "npm ci --prefix tools/schema-check --no-audit --no-fund --registry https://registry.npmjs.org/ && python3 tools/schema-check/check.py --keep",
      MIGRATE,
      "pnpm db:catalog-diff",
      "pnpm db:deploy && pnpm db:catalog-diff",
      // W0-06b：结构防漂移。结构快照无差异、约束清单比对、分区断言
      "pnpm db:snapshot:check",
      "pnpm db:constraints:check",
      "pnpm db:partitions:assert",
      // W0-06b：分组文档字段表与迁移后的库一致（读迁移库）
      "python3 tools/schema-check/check.py --existing lyx_migrate_check",
      // W0-09a：枚举与库 CHECK 一致，读上面建的迁移库
      "pnpm enums:check",
      MINIO_UP,
      "pnpm exec vitest run packages/services/src/providers/storage/minio.test.ts",
      // infra 以外的全部测试项目分成三片，这里是第一片；另两片在 test-2、test-3
      "pnpm test --project '!infra' --shard=1/3",
      "pnpm e2e",
      // W0-10：api-check、约束名核对读上面建的迁移库；待落地数只减不增要排在“测试”之后（已挂载处理器的清单由
      // apps/api 的测试装配导出）；计划 第 8.2 节的表（它的下一步上传两份清单，没有 run）
      "node infra/ci/api-check.mjs",
      "node infra/ci/natural-constraints.mjs",
      // 分片之后写清单的那份用例不一定在本任务这一片里：单独跑它一遍，清单没写出来这一步就红
      EXPORT_MOUNTED,
      "node infra/ci/landed.mjs --check --report --out packages/contract/dist/pending-routes.md",
      "node infra/ci/landed.mjs --check --require M0,M1",
      "node infra/ci/plan-routes.mjs --check --summary packages/contract/dist/route-milestones.md",
      // W0-23：只构建任务进程这一个包（“构建”在 web，产物过不来），下面两步跑它的产物
      "pnpm --filter @liyoxi/worker build",
      // W0-23：任务进程的产物自检；兼容脚本在 CI 的 Redis 上跑通
      "node apps/worker/dist/index.js --check",
      "pnpm redis:compat --jobs 500 --idle-minutes 0.05",
      // W0-30：四个计数，排在“测试”之后（读 apps/api 的用例写出的已挂载清单）；M0 的四样退回去即失败
      "node infra/ci/four-counts.mjs --require M0",
      "node infra/ci/four-counts.mjs --require M0,M1",
    ],
    // “测试”的第二、三片：各自生成客户端、建迁移库、起 MinIO
    "test-2": [INSTALL, DB_GENERATE, MIGRATE, MINIO_UP, "pnpm test --project '!infra' --shard=2/3"],
    "test-3": [INSTALL, DB_GENERATE, MIGRATE, MINIO_UP, "pnpm test --project '!infra' --shard=3/3"],
    // infra 项目的用例：连库的几份自己建临时库，不用生成的客户端；W0-10 约束名核对的用例只读迁移库，所以先建一份
    "test-infra": [INSTALL, MIGRATE, "pnpm test --project infra"],
    // W0-05b：两个会话同时跑连库的测试项目（挂了 globalSetup 的），核对库名与 Redis 前缀没有交集。
    // 全量分成四片，一个任务跑一片（每片里照旧是两个会话），合起来是原来的那一遍
    "test-isolation": [...ISOLATION_SETUP, "node infra/ci/isolation-shard.mjs --shard 1/4"],
    "test-isolation-2": [...ISOLATION_SETUP, "node infra/ci/isolation-shard.mjs --shard 2/4"],
    "test-isolation-3": [...ISOLATION_SETUP, "node infra/ci/isolation-shard.mjs --shard 3/4"],
    "test-isolation-4": [...ISOLATION_SETUP, "node infra/ci/isolation-shard.mjs --shard 4/4"],
    // 构建；W0-28：后台与下载页的单测、构建、页面清单；后台冒烟按受影响范围跑（它后面上传截图的一步没有 run）
    web: [
      INSTALL,
      // W0-23：“构建”连任务进程一起构建，打包要读生成的数据库客户端
      DB_GENERATE,
      "pnpm -r --if-present build",
      "pnpm --filter @liyoxi/admin --filter @liyoxi/portal test",
      "pnpm admin:build && pnpm portal:build",
      "node infra/ci/pages/generate.mjs --check",
      'node apps/admin/scripts/e2e-affected.mjs --base "$BASE"',
      // 浏览器缓存的键：Playwright 的版本（它的下一步是缓存，没有 run）
      `node -p '"version=" + require("./apps/admin/package.json").devDependencies["@playwright/test"]' >> "$GITHUB_OUTPUT"`,
      'sudo env "PATH=$PATH" node infra/ci/normalize-browser-apt-source.mjs',
      "pnpm --filter @liyoxi/admin exec playwright install --with-deps chromium",
      "pnpm admin:e2e",
      "docker compose -f infra/compose/local.yml up -d --wait postgres redis",
      MINIO_UP,
      "pnpm admin:e2e:live",
      // W0-27a：小程序的单测、体积门禁；截图按受影响范围跑（它后面上传截图的一步没有 run）
      "pnpm --filter @liyoxi/weapp test",
      "node infra/ci/check-mp-size.mjs apps/weapp/dist",
      'node apps/weapp/scripts/shots-affected.mjs --base "$BASE"',
      'sudo env "PATH=$PATH" node infra/ci/normalize-browser-apt-source.mjs',
      "pnpm --filter @liyoxi/weapp exec playwright install --with-deps chromium",
      "pnpm weapp:shots",
    ],
    gates: [
      INSTALL,
      "node infra/ci/secret-scan.mjs",
      "pnpm audit --prod --audit-level high --registry https://registry.npmjs.org/",
      'node infra/ci/check-release-age.mjs --since "$SINCE" --registry https://registry.npmjs.org/',
      // 门禁自测里“枚举与库 CHECK 一致”的反例要读迁移库
      MIGRATE,
      // W0-23：门禁自测里任务进程的两例跑的是构建产物
      DB_GENERATE,
      "pnpm --filter @liyoxi/worker build",
      "pnpm gates:selftest",
    ],
  };
  // M1 冷检出仅加入探针的三个前置命令，原三个命令及完整相等断言保留。
  STEPS["test-infra"]!.splice(1, 0, DB_GENERATE);
  STEPS["test-infra"]!.splice(
    3,
    0,
    "docker compose -f infra/compose/local.yml up -d --wait redis",
    EXPORT_MOUNTED,
  );
  const commandsOf = (id: string) =>
    [...jobBody(ci, id).matchAll(/^ {8}run: (.+)$/gm)].map((match) => match[1] ?? "");

  it("跑检查的任务都列在这里：分类与汇总以外的每个任务各有一张命令清单", () => {
    const others = jobIds(ci).filter((id) => id !== "gate-classify" && id !== "required");
    expect(Object.keys(STEPS).sort()).toEqual(others.sort());
  });

  it.each(Object.keys(STEPS))("%s 的步骤齐全，顺序照清单", (id) => {
    expect(commandsOf(id)).toEqual(STEPS[id]);
  });

  /** 全部任务里以 prefix 开头的命令，连同它在哪个任务里 */
  const commandsStarting = (prefix: string) =>
    Object.keys(STEPS).flatMap((id) =>
      commandsOf(id)
        .filter((command) => command === prefix || command.startsWith(`${prefix} `))
        .map((command): [string, string] => [id, command]),
    );
  /**
   * 一组分片命令互补：除了片号逐字相同（都匹配 pattern，它的两个捕获组是片号与分母），分母都等于片数，
   * 片号恰好是 1 到片数各一次，一个任务只跑一片。加一片时各处的分母要一起改，漏改一处、片号重了或缺了，这里就红
   */
  function expectComplementary(runs: [string, string][], pattern: RegExp) {
    const shards = runs.map(([, command]) => pattern.exec(command));
    expect(shards.every((match) => match !== null)).toBe(true);
    expect(shards.length).toBeGreaterThan(1);
    expect(shards.map((match) => Number(match?.[2]))).toEqual(shards.map(() => shards.length));
    expect(shards.map((match) => Number(match?.[1])).sort((a, b) => a - b)).toEqual(
      shards.map((_, index) => index + 1),
    );
    expect(new Set(runs.map(([id]) => id)).size).toBe(runs.length);
  }

  it("根上的 pnpm test 拆在几个任务里跑：infra 项目一份，infra 以外的全部项目分成互补的几片，合起来是全量", () => {
    const runs = commandsStarting("pnpm test");
    expect(runs).toEqual([
      ["test", "pnpm test --project '!infra' --shard=1/3"],
      ["test-2", "pnpm test --project '!infra' --shard=2/3"],
      ["test-3", "pnpm test --project '!infra' --shard=3/3"],
      ["test-infra", "pnpm test --project infra"],
    ]);
    // 互补不靠上面那张写死的表：infra 以外的那几条按片号、分母核对
    expectComplementary(
      runs.filter(([id]) => id !== "test-infra"),
      /^pnpm test --project '!infra' --shard=(\d+)\/(\d+)$/,
    );
    // infra 确实是根测试配置里的一个项目：改了名，上面的命令就不再是“一份对其余”
    expect(read("infra/vitest.config.ts")).toMatch(/^ {4}name: "infra",$/m);
    expect(read("vitest.config.ts")).toMatch(/^ {4}projects: \[.*"infra".*\],$/m);
  });

  it("测试隔离的全量拆在几个任务里跑：范围照旧是全部连库的测试项目，分成互补的几片，合起来是原来的那一遍", () => {
    const runs = commandsStarting("node infra/ci/isolation-shard.mjs");
    expect(runs).toEqual([
      ["test-isolation", "node infra/ci/isolation-shard.mjs --shard 1/4"],
      ["test-isolation-2", "node infra/ci/isolation-shard.mjs --shard 2/4"],
      ["test-isolation-3", "node infra/ci/isolation-shard.mjs --shard 3/4"],
      ["test-isolation-4", "node infra/ci/isolation-shard.mjs --shard 4/4"],
    ]);
    // 每一条只有片号不同；没有哪一条带别的参数（缩范围、换 worker 数、只列不跑）
    expectComplementary(runs, /^node infra\/ci\/isolation-shard\.mjs --shard (\d+)\/(\d+)$/);
    // 不分片的那条命令不再出现在工作流里：全量只经分片跑，不会一边分片一边又整遍跑
    expect(commandsStarting("pnpm test:isolation")).toEqual([]);
    // 分片脚本取的范围、分法、核对：与不分片时相同，由 test/isolation-shard.test.ts 实跑名单核对
    const script = read("infra/ci/isolation-shard.mjs");
    expect(script).toContain('const CHECKER = "packages/services/src/testing/isolation.mjs";');
    expect(script).toContain("project.config.globalSetup.length > 0");
    expect(read("packages/services/src/testing/isolation.mjs")).toContain(
      "project.config.globalSetup.length > 0",
    );
  });

  it("各片各用各的库：跑一片的任务都先生成客户端、建迁移库、起 MinIO 再跑；必过的步骤不带条件", () => {
    const shardJobs = [
      ...commandsStarting("pnpm test"),
      ...commandsStarting("node infra/ci/isolation-shard.mjs"),
    ]
      .filter(([, command]) => command.includes("--shard"))
      .map(([id]) => id);
    expect(shardJobs).toHaveLength(7);
    for (const id of shardJobs) {
      const commands = commandsOf(id);
      const at = commands.findIndex((command) => command.includes("--shard"));
      for (const before of [DB_GENERATE, MIGRATE, MINIO_UP]) {
        expect(commands.slice(0, at), `${id}：${before}`).toContain(before);
      }
    }
    // 带条件的步骤只在 web（冒烟、截图按受影响范围跑）；上传产物的几步写的是 always()，不是“可以不跑”
    const conditional = (id: string) =>
      `${jobBody(ci, id)}\n`
        .split(/^ {6}- name: /m)
        .slice(1)
        .filter((text) => /^ {8}if: (?!always\(\)$)/m.test(text))
        .map((text) => text.slice(0, text.indexOf("\n")));
    for (const id of Object.keys(STEPS).filter((job) => job !== "web")) {
      expect(conditional(id), id).toEqual([]);
    }
  });

  it("待落地数排在导出已挂载清单之后：清单不靠“那份用例恰好在这一片里”", () => {
    const commands = commandsOf("test");
    const exported = commands.indexOf(EXPORT_MOUNTED);
    const landed = commands.findIndex((command) => command.startsWith("node infra/ci/landed.mjs "));
    expect(exported).toBeGreaterThan(0);
    expect(landed).toBe(exported + 1);
    // 写清单的确实是那份用例；待落地数读的确实是那个文件
    expect(read("apps/api/test/probes.test.ts")).toContain("mounted-operations.json");
    expect(read("infra/ci/landed.mjs")).toContain("apps/api/dist/mounted-operations.json");
  });

  it("状态文件核对的步骤名跟着含义走：不再叫“状态汇总无差异”", () => {
    expect(jobBody(ci, "verify")).toMatch(
      /^ {6}- name: 状态文件核对\n {8}run: node infra\/ci\/status-summary\.mjs --check$/m,
    );
    expect(ci).not.toContain("状态汇总无差异");
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
    expect(commands).toEqual([
      "pnpm install --frozen-lockfile",
      // W0-05：数据库客户端不入库，类型检查之前先生成
      "pnpm db:generate",
      "pnpm typecheck",
      // W0-05 起 pnpm test 要连库：起库、给连接参数、建迁移库并跑迁移。往每晚任务加一步时，在这张清单的同一位置加一行
      "docker compose -f infra/compose/local.yml up -d --wait postgres redis",
      "docker compose -f infra/compose/local.yml up -d --wait minio",
      'printf "%s\\n" "APP_ENV=test" "DATABASE_URL=postgresql://liyoxi:lyx-local-dev@localhost:5442/liyoxi" "REDIS_URL=redis://localhost:6389/0" >> "$GITHUB_ENV"',
      'psql -X -w -d postgres -c "CREATE DATABASE lyx_migrate_check" && pnpm db:deploy',
      "rm -f apps/api/dist/mounted-operations.json && pnpm exec vitest run apps/api/test/probes.test.ts && test -s apps/api/dist/mounted-operations.json",
      "pnpm test",
      "pnpm e2e",
      "pnpm machines:coverage -- --strict --contract",
      "node infra/ci/check-stubs.mjs",
      "node infra/ci/landed.mjs --check --require M0,M1",
      "node infra/ci/four-counts.mjs --require M0,M1",
      // W0-30：M0 的演示，业主用的那条命令每晚重放一遍
      "pnpm demo:m0",
      "pnpm --filter @liyoxi/admin exec playwright install --with-deps chromium",
      "pnpm admin:e2e:live",
    ]);
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

  it("CI 的服务容器与本地用同一组镜像、端口与开发口令；几个任务各挂各的，每一处都一样", () => {
    const password = compose.match(/POSTGRES_PASSWORD: (\S+)/)?.[1];
    const blocks = (service: string) =>
      [
        ...ci.matchAll(new RegExp(`^ {6}${service}:\\n {8}image: (\\S+)\\n(?: {8,}.*\\n)*`, "gm")),
      ].map((match) => ({ image: match[1], text: match[0] }));
    const postgres = blocks("postgres");
    const redis = blocks("redis");
    expect(postgres.length).toBeGreaterThan(0);
    expect(redis.length).toBeGreaterThan(0);
    for (const block of postgres) {
      expect(block.image).toBe(imageOf(compose, "postgres"));
      expect(block.text).toContain('ports: ["5442:5432"]');
      expect(block.text).toContain(`POSTGRES_PASSWORD: ${password}`);
    }
    for (const block of redis) {
      expect(block.image).toBe(imageOf(compose, "redis"));
      expect(block.text).toContain('ports: ["6389:6379"]');
    }
    // 换一种写法的（缩进不同、镜像不在下一行）上面读不到：叫这两个名字的键有几处，就得读到几处
    expect(ci.match(/^ +postgres:$/gm)).toHaveLength(postgres.length);
    expect(ci.match(/^ +redis:$/gm)).toHaveLength(redis.length);
    // 连接参数只写在工作流顶层一处，全部任务相同
    expect(ci).toMatch(
      new RegExp(
        `^env:\\n {2}APP_ENV: test\\n {2}DATABASE_URL: postgresql://liyoxi:${password}@localhost:5442/liyoxi\\n {2}REDIS_URL: redis://localhost:6389/0\\n`,
        "m",
      ),
    );
    expect(ci.match(/^ +APP_ENV: /gm)).toHaveLength(1);
  });

  it("要连库的任务都挂了 PostgreSQL；跑连 Redis 的用例的任务另挂 Redis", () => {
    const servicesOf = (id: string) =>
      [...jobBody(ci, id).matchAll(/^ {6}([\w-]+):\n {8}image: /gm)].map((match) => match[1]);
    for (const id of ["test", "test-2", "test-3"]) {
      expect(servicesOf(id), id).toEqual(["postgres", "redis"]);
    }
    for (const id of [
      "test-isolation",
      "test-isolation-2",
      "test-isolation-3",
      "test-isolation-4",
    ]) {
      expect(servicesOf(id), id).toEqual(["postgres", "redis"]);
    }
    expect(servicesOf("test-infra")).toEqual(["postgres"]);
    expect(servicesOf("gates")).toEqual(["postgres"]);
  });
});

describe("stack-smoke.yml", () => {
  const stackSmoke = read(".github/workflows/stack-smoke.yml");

  it("手动、推到 main、改到镜像定义、Compose、起停脚本、两个服务端应用、迁移或它自己的 PR 时触发", () => {
    expect(stackSmoke).toMatch(/^ {2}workflow_dispatch:$/m);
    expect(stackSmoke).toMatch(/^ {2}push:\n {4}branches: \[main\]$/m);
    const paths = [
      ...(
        stackSmoke.match(/^ {2}pull_request:\n {4}paths:\n((?: {6}- .+\n)+)/m)?.[1] ?? ""
      ).matchAll(/^ {6}- (.+)$/gm),
    ].map((match) => match[1]);
    expect(paths).toEqual([
      "infra/docker/**",
      "infra/compose/**",
      "infra/stack/**",
      "infra/deploy/**",
      "infra/bootstrap/**",
      "apps/api/**",
      "apps/worker/**",
      "packages/db/prisma/**",
      ".github/workflows/stack-smoke.yml",
    ]);
  });

  it("构建、看镜像、起两遍、冒烟、收场；超时 15 分钟；不装依赖", () => {
    expect(stackSmoke).toMatch(/^ {4}timeout-minutes: 15$/m);
    const commands = [...stackSmoke.matchAll(/^ {8}run: (.+)$/gm)].map((match) => match[1] ?? "");
    // 往这个任务加一步时，在这张清单的同一位置加一行。“没过时的现场”一步只在前面失败时跑，不在清单里比全文
    expect(commands.filter((command) => !command.startsWith("docker ps -a;"))).toEqual([
      "node infra/stack/up.mjs build",
      "node infra/stack/smoke.mjs --image-only",
      "node infra/stack/up.mjs up",
      "node infra/stack/up.mjs up",
      "node infra/stack/smoke.mjs",
      "|",
      "node infra/deploy/rehearse.mjs --without-image-smoke",
      "node infra/stack/up.mjs down --reset",
    ]);
    expect(stackSmoke).not.toMatch(/pnpm install/);
    // 根脚本指到同一组命令
    const scripts = (JSON.parse(read("package.json")) as { scripts: Record<string, string> })
      .scripts;
    expect(scripts["stack:build"]).toBe("node infra/stack/up.mjs build");
    expect(scripts["stack:up"]).toBe("node infra/stack/up.mjs up");
    expect(scripts["stack:smoke"]).toBe("node infra/stack/smoke.mjs");
    expect(scripts["stack:down"]).toBe("node infra/stack/up.mjs down");
  });

  it("不在必过检查里：ci.yml 的任务清单里没有它", () => {
    expect(jobIds(stackSmoke)).toEqual(["stack-smoke"]);
    expect(jobIds(ci)).not.toContain("stack-smoke");
  });
});
