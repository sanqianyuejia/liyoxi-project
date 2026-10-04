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

describe("全部工作流", () => {
  const files = readdirSync(workflowsDir).filter((name) => /\.ya?ml$/.test(name));

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
  it("PR 与推到 main 时触发；按分支分组并发，PR 上新提交取消在途的运行", () => {
    expect(ci).toMatch(/^on:\n {2}pull_request:\n {2}push:\n {4}branches: \[main\]\n/m);
    expect(ci).toContain("group: ci-${{ github.head_ref || github.ref }}");
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

  it("端口只绑回环地址：PostgreSQL 5442、Redis 6389、MinIO 9100 与 9101；镜像不用 latest，不设 TZ", () => {
    const ports = [...compose.matchAll(/^ {6}- "127\.0\.0\.1:(\d+:\d+)"$/gm)].map(
      (match) => match[1],
    );
    expect(ports).toEqual(["5442:5432", "6389:6379", "9100:9000", "9101:9001"]);
    const images = [...compose.matchAll(/^ {4}image: (\S+)$/gm)].map((match) => match[1] ?? "");
    expect(images).toHaveLength(3);
    for (const image of images) expect(image).toMatch(/:(?!latest$)[\w.-]+$/);
    expect(images[0]).toMatch(/^postgres:17-/);
    expect(images[1]).toBe("redis:7.4-alpine");
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
