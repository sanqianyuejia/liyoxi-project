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

/** jobs: 下一级的键，即各任务的编号 */
function jobIds(workflow: string): string[] {
  const body = workflow.split(/^jobs:\s*$/m)[1] ?? "";
  return [...body.matchAll(/^ {2}([\w-]+):\s*$/gm)].map((match) => match[1] ?? "");
}

/** 一个任务的全文：从它的键到下一个任务的键 */
function jobBody(workflow: string, id: string): string {
  const body = workflow.split(/^jobs:\s*$/m)[1] ?? "";
  const start = body.search(new RegExp(`^ {2}${id}:\\s*$`, "m"));
  const rest = body.slice(start).split("\n").slice(1);
  const end = rest.findIndex((line) => /^ {2}[\w-]+:\s*$/.test(line));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}

/** 各任务在平台上的检查名：写了 name 用 name，没写用任务编号。必过检查是按这个名字认的 */
function checkNames(workflow: string): string[] {
  return jobIds(workflow).map((id) => {
    const name = jobBody(workflow, id).match(/^ {4}name:\s*(.+?)\s*(?:#.*)?$/m)?.[1] ?? id;
    return name.replace(/^(['"])(.*)\1$/, "$2");
  });
}

/**
 * 检查名的重名问题：同一个工作流里两个任务同名（或任务编号重复）；必过的那个名字在全部工作流里不止一个。
 * 重名时平台按哪一个算必过检查说不准：再加一个同名且恒成功的任务，就可能顶掉真的那个。
 */
function duplicateCheckNames(workflows: Record<string, string>, requiredName: string): string[] {
  const problems: string[] = [];
  const holders: string[] = [];
  for (const [file, text] of Object.entries(workflows)) {
    const names = checkNames(text);
    const ids = jobIds(text);
    for (const [label, values] of [
      ["检查名", names],
      ["任务编号", ids],
    ] as const) {
      const repeated = [...new Set(values.filter((value, at) => values.indexOf(value) !== at))];
      for (const value of repeated) problems.push(`${file}：${label} ${value} 出现了不止一次`);
    }
    for (const name of names) if (name === requiredName) holders.push(file);
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

  it("必过检查名 required 在全部工作流里只出现一次，同一个工作流里任务名不重复", () => {
    expect(duplicateCheckNames(workflows, "required")).toEqual([]);
    expect(checkNames(ci)).toContain("required");
    // 每个任务都显式写了 name，且与任务编号相同：检查名不靠缺省值
    for (const text of Object.values(workflows)) expect(checkNames(text)).toEqual(jobIds(text));
  });

  describe("重名的反例：上面那条断言要能把它们查出来", () => {
    const shadowJob = (id: string, name: string | null) =>
      [
        `  ${id}:`,
        ...(name === null ? [] : [`    name: ${name}`]),
        "    runs-on: ubuntu-24.04",
        "    steps:",
        '      - run: "true"',
        "",
      ].join("\n");
    const extra = (job: string) =>
      `name: extra\non:\n  pull_request:\npermissions:\n  contents: read\njobs:\n${job}`;

    it.each([
      ["另一个工作流里的任务也叫 required", shadowJob("shadow", "required")],
      ["名字带引号", shadowJob("shadow", '"required"')],
      ["名字后面带注释", shadowJob("shadow", "required # 恒成功")],
      ["没写 name，任务编号就是 required", shadowJob("required", null)],
    ])("%s：查出 required 出现两次", (_label, job) => {
      expect(duplicateCheckNames({ ...workflows, "extra.yml": extra(job) }, "required")).toEqual([
        "检查名 required 在全部工作流里要恰好出现一次，现在是 2 次（ci.yml、extra.yml）",
      ]);
    });

    it("ci.yml 里再加一个检查名也叫 required 的任务：查出同一个工作流里重名", () => {
      const mutated = { ...workflows, "ci.yml": `${ci}\n${shadowJob("shadow", "required")}` };
      expect(duplicateCheckNames(mutated, "required")).toEqual([
        "ci.yml：检查名 required 出现了不止一次",
        "检查名 required 在全部工作流里要恰好出现一次，现在是 2 次（ci.yml、ci.yml）",
      ]);
    });

    it("同一个工作流里两个任务同名（不是 required 也算）", () => {
      const mutated = { ...workflows, "ci.yml": `${ci}\n${shadowJob("lint-again", "verify")}` };
      expect(duplicateCheckNames(mutated, "required")).toEqual([
        "ci.yml：检查名 verify 出现了不止一次",
      ]);
    });

    it("任务编号重复（后写的顶掉前面的）", () => {
      const mutated = { ...workflows, "ci.yml": `${ci}\n${shadowJob("verify", "verify-2")}` };
      // 按编号取任务正文时两个都取到前一个，所以检查名也报重复
      expect(duplicateCheckNames(mutated, "required")).toEqual([
        "ci.yml：检查名 verify 出现了不止一次",
        "ci.yml：任务编号 verify 出现了不止一次",
      ]);
    });

    it("把 required 改了名：查出一次都没有", () => {
      const mutated = {
        ...workflows,
        "ci.yml": ci.replace("    name: required\n", "    name: all\n"),
      };
      expect(duplicateCheckNames(mutated, "required")).toEqual([
        "检查名 required 在全部工作流里要恰好出现一次，现在是 0 次",
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
      "pnpm format:check",
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
