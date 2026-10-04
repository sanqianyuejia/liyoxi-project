import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { git, makeTempDir, makeTempRepo, repoRoot, writeFiles } from "./helpers.js";

// 门禁改动分类脚本的用例（W0-03 任务书 第 7 节第 8 条）。
// 每条用例在仓库外建一个临时 git 仓库：先提交基线，再提交改动，让脚本判这两个提交之间的差异。
// 用的是仓库里真实的门禁文件清单 infra/ci/gate-files.json。经 gh 写 PR 的那一段用桩命令测。

const script = join(repoRoot, "infra/ci/classify-gate-changes.mjs");

const WORKFLOW = `name: ci
on:
  pull_request:
jobs:
  verify:
    runs-on: ubuntu-24.04
    steps:
      - name: lint
        run: pnpm lint
      - name: 测试
        run: pnpm test
  required:
    needs:
      - verify
    runs-on: ubuntu-24.04
    steps:
      - name: 汇总
        run: node x.mjs
`;
const RULES = `export const repoRules = {
  "@typescript-eslint/no-explicit-any": "error",
  "no-restricted-imports": ["error", { paths: ["axios"] }],
};
`;
const LAYERS = {
  servicesDir: "packages/services/src",
  layers: ["L0", "L1"],
  modules: { kernel: "L0", identity: "L1" },
  sameLayer: { L0: { policy: "free" }, L1: { policy: "whitelist", allow: {} } },
  nonModuleDirs: ["testing"],
};
const REGISTRY = {
  files: [
    { pattern: "infra/ci/**", kind: "append" },
    { pattern: ".gitleaks.toml", kind: "frozen" },
  ],
};
const ROOT = {
  name: "liyoxi",
  packageManager: "pnpm@10.34.5",
  engines: { node: ">=24.19.0 <25" },
  scripts: { lint: "eslint .", test: "vitest run" },
  devDependencies: { eslint: "10.11.0" },
};
const SERVICES = { name: "@liyoxi/services", scripts: { build: "echo 占位" }, dependencies: {} };
const LOCK = `lockfileVersion: '9.0'

settings:
  autoInstallPeers: true

importers:

  .:
    devDependencies:
      eslint:
        specifier: 10.11.0
        version: 10.11.0

packages:

  eslint@10.11.0:
    resolution: {integrity: sha512-aaa}

  '@types/node@24.19.0':
    resolution: {integrity: sha512-bbb}

snapshots:

  eslint@10.11.0: {}
`;
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

const baseFiles: Record<string, string> = {
  ".github/workflows/ci.yml": WORKFLOW,
  "infra/ci/layers.json": json(LAYERS),
  "infra/ci/gate-files.json": json(REGISTRY),
  "infra/ci/check-x.mjs": 'console.log("x");\n',
  "infra/ci/README.md": "# 说明\n",
  "packages/config/eslint/repo.js": RULES,
  "package.json": json(ROOT),
  "packages/services/package.json": json(SERVICES),
  "pnpm-lock.yaml": LOCK,
  ".prettierignore": "dist\n",
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
  outside: string[];
  dir: string;
}

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

/** 基线之上做一批改动（值为 null 表示删除），跑分类脚本 */
function classify(
  changes: Record<string, string | null>,
  args: string[] = [],
  env: Record<string, string> = {},
): Outcome {
  const temp = makeTempRepo("lyx-gate-", baseFiles);
  cleanups.push(temp.cleanup);
  git(temp.dir, "commit", "-q", "-m", "base");
  for (const [path, content] of Object.entries(changes)) {
    if (content === null) rmSync(join(temp.dir, path));
    else writeFiles(temp.dir, { [path]: content });
  }
  git(temp.dir, "add", "-A");
  git(temp.dir, "commit", "-q", "--allow-empty", "-m", "head");
  const out = join(temp.dir, ".result.json");
  const result = spawnSync("node", [script, "--base", "HEAD~1", "--out", out, ...args], {
    cwd: temp.dir,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  const parsed = existsSync(out)
    ? (JSON.parse(readFileSync(out, "utf8")) as Pick<
        Outcome,
        "verdict" | "touch" | "loosen" | "outside"
      >)
    : { verdict: "", touch: [], loosen: [], outside: [] };
  return {
    status: result.status ?? -1,
    output: `${result.stdout}\n${result.stderr}`,
    dir: temp.dir,
    ...parsed,
  };
}

const whats = (items: Item[]) => items.map((item) => `${item.file}: ${item.what}`);
const withChange = (text: string, from: string, to: string) => {
  if (!text.includes(from)) throw new Error(`基线里没有：${from}`);
  return text.replace(from, to);
};

describe("没有门禁改动", () => {
  it("只改业务代码：判为没有门禁改动，通过", () => {
    const result = classify({ "src/app.ts": "export const a = 2;\n" });
    expect(result.status).toBe(0);
    expect(result.verdict).toBe("none");
    expect(result.outside).toEqual(["src/app.ts"]);
    expect(result.output).toContain("没有门禁改动");
  });

  it("infra/ci 下的文档不逐行判", () => {
    const result = classify({ "infra/ci/README.md": "# 改过的说明\n" });
    expect(result.verdict).toBe("none");
    expect(result.outside).toEqual([]);
  });

  it("工作区包改自己的脚本不算门禁改动（占位构建换成真实构建）", () => {
    const next = { ...SERVICES, scripts: { build: "tsup" } };
    expect(classify({ "packages/services/package.json": json(next) }).verdict).toBe("none");
  });
});

describe("只增：判为 gate-touch 并列出", () => {
  it("新增依赖", () => {
    const next = { ...SERVICES, dependencies: { zod: "4.6.5" } };
    const result = classify({ "packages/services/package.json": json(next) });
    expect(result.status).toBe(0);
    expect(result.verdict).toBe("touch");
    expect(whats(result.touch)).toEqual([
      "packages/services/package.json: 新增依赖 zod@4.6.5（dependencies）",
    ]);
    expect(result.output).toContain("只增 1 项");
  });

  it("新增根脚本", () => {
    const next = { ...ROOT, scripts: { ...ROOT.scripts, "infra:up": "docker compose up" } };
    const result = classify({ "package.json": json(next) });
    expect(result.verdict).toBe("touch");
    expect(whats(result.touch)).toEqual(["package.json: 新增根脚本 infra:up"]);
  });

  it("工作流新增一个步骤", () => {
    const next = withChange(
      WORKFLOW,
      "        run: pnpm test\n",
      "        run: pnpm test\n      - name: 构建\n        run: pnpm build\n",
    );
    const result = classify({ ".github/workflows/ci.yml": next });
    expect(result.verdict).toBe("touch");
    expect(whats(result.touch)).toEqual([".github/workflows/ci.yml: 新增步骤或任务：- name: 构建"]);
  });

  it("工作流新增一个任务，并挂进 required 的 needs", () => {
    const job =
      "  e2e:\n    runs-on: ubuntu-24.04\n    steps:\n      - name: e2e\n        run: pnpm e2e\n";
    const next = withChange(
      withChange(WORKFLOW, "  required:\n", `${job}  required:\n`),
      "      - verify\n",
      "      - verify\n      - e2e\n",
    );
    const result = classify({ ".github/workflows/ci.yml": next });
    expect(result.verdict).toBe("touch");
    expect(result.touch.map((item) => item.what)).toEqual([
      "新增步骤或任务：e2e:",
      "新增步骤或任务：- e2e",
    ]);
  });

  it("新增工作流文件", () => {
    const result = classify({ ".github/workflows/nightly.yml": "name: nightly\n" });
    expect(whats(result.touch)).toEqual([".github/workflows/nightly.yml: 新增工作流文件"]);
  });

  it("infra/ci 新增文件（检查脚本、反例）", () => {
    const result = classify({
      "infra/ci/check-y.mjs": 'console.log("y");\n',
      "infra/ci/selftest/cases/y.mjs": "export default {};\n",
    });
    expect(result.verdict).toBe("touch");
    expect(whats(result.touch)).toEqual([
      "infra/ci/check-y.mjs: 新增文件",
      "infra/ci/selftest/cases/y.mjs: 新增文件",
    ]);
  });

  it("已有的门禁文件里只加行", () => {
    const next = withChange(RULES, "};\n", '  "no-var": "error",\n};\n');
    const result = classify({ "packages/config/eslint/repo.js": next });
    expect(result.verdict).toBe("touch");
    expect(whats(result.touch)).toEqual(["packages/config/eslint/repo.js: 新增 1 行"]);
  });

  it("加的行里有 disallow、shallow 这类词：不当成豁免", () => {
    const next = `${RULES}// disallowed：用 shallow clone 时也照查\nexport const depth = 1;\n`;
    const result = classify({ "packages/config/eslint/repo.js": next });
    expect(result.verdict).toBe("touch");
    expect(whats(result.touch)).toEqual(["packages/config/eslint/repo.js: 新增 2 行"]);
  });

  it("layers.json 只新增模块登记", () => {
    const next = { ...LAYERS, modules: { ...LAYERS.modules, tenant: "L1" } };
    const result = classify({ "infra/ci/layers.json": json(next) });
    expect(result.verdict).toBe("touch");
    expect(whats(result.touch)).toEqual(["infra/ci/layers.json: 新增模块登记 tenant → L1"]);
  });

  it("门禁文件清单只新增条目", () => {
    const next = {
      files: [...REGISTRY.files, { pattern: "infra/ci/colors.json", kind: "frozen" }],
    };
    const result = classify({ "infra/ci/gate-files.json": json(next) });
    expect(result.verdict).toBe("touch");
    expect(whats(result.touch)).toEqual([
      "infra/ci/gate-files.json: 新增门禁文件条目 `infra/ci/colors.json`（frozen）",
    ]);
  });

  it("锁文件只新增版本", () => {
    const next = withChange(
      LOCK,
      "snapshots:\n",
      "  zod@4.6.5:\n    resolution: {integrity: sha512-ccc}\n\nsnapshots:\n",
    );
    const result = classify({ "pnpm-lock.yaml": next });
    expect(result.verdict).toBe("touch");
    expect(whats(result.touch)).toEqual(["pnpm-lock.yaml: 锁文件新增 1 个版本：zod@4.6.5"]);
  });

  it("放行文件与它的门禁条目在同一个 PR 里新建：算只增，列出来给业主看", () => {
    // .gitleaksignore 在真实清单里是 frozen，但这个临时仓库的基线清单里还没有登记它
    const result = classify({ ".gitleaksignore": "abc:README.md:generic-api-key:1\n" });
    expect(result.verdict).toBe("touch");
    expect(whats(result.touch)).toEqual([
      ".gitleaksignore: 新建了密钥扫描的放行项（它的门禁条目也是这次新增的）",
    ]);
  });

  it("基线上没有门禁文件清单（门禁第一次建立）：新建清单只列一项", () => {
    const temp = makeTempRepo("lyx-gate-", { "src/app.ts": "export const a = 1;\n" });
    cleanups.push(temp.cleanup);
    git(temp.dir, "commit", "-q", "-m", "base");
    writeFiles(temp.dir, { "infra/ci/gate-files.json": json(REGISTRY), ".gitleaks.toml": "\n" });
    git(temp.dir, "add", "-A");
    git(temp.dir, "commit", "-q", "-m", "head");
    const result = spawnSync("node", [script, "--base", "HEAD~1"], {
      cwd: temp.dir,
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("`infra/ci/gate-files.json`：新增门禁文件清单，共 2 条");
    expect(result.stdout).toContain("`.gitleaks.toml`：新建了密钥扫描的放行项");
  });
});

describe("放松：没有 gate-change 标签即失败", () => {
  const cases: Array<[string, Record<string, string | null>, string]> = [
    [
      "删一条 lint 规则",
      {
        "packages/config/eslint/repo.js": withChange(
          RULES,
          '  "@typescript-eslint/no-explicit-any": "error",\n',
          "",
        ),
      },
      "删改了已有行",
    ],
    [
      "改一条 lint 规则的级别",
      {
        "packages/config/eslint/repo.js": withChange(
          RULES,
          '"error",\n  "no-res',
          '"warn",\n  "no-res',
        ),
      },
      "删改了已有行",
    ],
    ["删掉一个检查脚本", { "infra/ci/check-x.mjs": null }, "删除了门禁文件"],
    [
      "加一行忽略项",
      { "packages/config/eslint/repo.js": `${RULES}export const ignores = ["legacy/**"];\n` },
      "加的行像是忽略、豁免或白名单",
    ],
    [
      "用例里加 skip",
      { "infra/ci/check-x.mjs": 'console.log("x");\nit.skip("以后再说", () => {});\n' },
      "加的行像是忽略、豁免或白名单",
    ],
    [
      "删一个 CI 步骤",
      {
        ".github/workflows/ci.yml": withChange(
          WORKFLOW,
          "      - name: 测试\n        run: pnpm test\n",
          "",
        ),
      },
      "删改了已有行",
    ],
    [
      "改一个 CI 步骤的命令",
      { ".github/workflows/ci.yml": withChange(WORKFLOW, "run: pnpm lint", "run: true") },
      "删改了已有行",
    ],
    [
      "给已有步骤加 continue-on-error",
      {
        ".github/workflows/ci.yml": withChange(
          WORKFLOW,
          "        run: pnpm lint\n",
          "        run: pnpm lint\n        continue-on-error: true\n",
        ),
      },
      "加的行像是忽略、豁免或白名单",
    ],
    [
      "往已有步骤里加行（判不出，按放松算）",
      {
        ".github/workflows/ci.yml": withChange(
          WORKFLOW,
          "        run: pnpm lint\n",
          "        run: pnpm lint\n        env:\n          LINT_LEVEL: loose\n",
        ),
      },
      "判不出是不是只增",
    ],
    [
      "依赖版本有变",
      { "package.json": json({ ...ROOT, devDependencies: { eslint: "10.12.0" } }) },
      "依赖版本有变 eslint：10.11.0 → 10.12.0",
    ],
    ["删掉依赖", { "package.json": json({ ...ROOT, devDependencies: {} }) }, "删掉了 eslint"],
    [
      "改已有的根脚本",
      { "package.json": json({ ...ROOT, scripts: { ...ROOT.scripts, lint: "true" } }) },
      "改了已有的根脚本 lint",
    ],
    [
      "改 engines",
      { "package.json": json({ ...ROOT, engines: { node: ">=20" } }) },
      "改了 engines",
    ],
    [
      "改已登记模块的层",
      { "infra/ci/layers.json": json({ ...LAYERS, modules: { kernel: "L1", identity: "L1" } }) },
      "改了已登记模块 kernel 的层：L0 → L1",
    ],
    [
      "改同层白名单",
      {
        "infra/ci/layers.json": json({
          ...LAYERS,
          sameLayer: {
            ...LAYERS.sameLayer,
            L1: { policy: "whitelist", allow: { identity: ["x"] } },
          },
        }),
      },
      "改了同层策略或白名单",
    ],
    [
      "往非模块目录的放行名单里加一项",
      { "infra/ci/layers.json": json({ ...LAYERS, nonModuleDirs: ["testing", "tmp"] }) },
      "改了非模块目录的放行名单",
    ],
    [
      "改已有的门禁文件条目",
      {
        "infra/ci/gate-files.json": json({
          files: [{ pattern: "infra/ci/**", kind: "append", except: ["**"] }],
        }),
      },
      "改了已有的门禁文件条目 `infra/ci/**`",
    ],
    ["格式检查加忽略项", { ".prettierignore": "dist\nlegacy\n" }, "改了格式检查的忽略项"],
    ["新建密钥扫描的放行文件", { ".gitleaks.toml": "[allowlist]\n" }, "新建了密钥扫描的放行项"],
    [
      "锁文件里的版本被替换",
      { "pnpm-lock.yaml": LOCK.replaceAll("eslint@10.11.0", "eslint@10.12.0") },
      "锁文件里有 1 个版本被移除或替换：eslint@10.11.0",
    ],
    [
      "锁文件头部的设置有变",
      { "pnpm-lock.yaml": withChange(LOCK, "autoInstallPeers: true", "autoInstallPeers: false") },
      "锁文件头部",
    ],
    ["清单文件解析不了（判不出）", { "infra/ci/layers.json": "{ 不是 JSON" }, "解析不了，判不出"],
  ];

  it.each(cases)("%s", (_label, changes, expected) => {
    const result = classify(changes);
    expect(result.verdict).toBe("loosen");
    expect(whats(result.loosen).join("\n")).toContain(expected);
    expect(result.status).toBe(1);
    expect(result.output).toContain("没有 gate-change 标签");
  });
});

describe("gate-change 标签", () => {
  const loosened = { "package.json": json({ ...ROOT, devDependencies: { eslint: "10.12.0" } }) };

  it("带 gate-change、只改门禁文件：通过", () => {
    const result = classify(loosened, ["--labels", "gate-change"]);
    expect(result.verdict).toBe("loosen");
    expect(result.status).toBe(0);
  });

  it("带 gate-change 又改了门禁文件以外的路径：失败", () => {
    const result = classify({ ...loosened, "src/app.ts": "export const a = 2;\n" }, [
      "--labels",
      "agent-reviewed,gate-change",
    ]);
    expect(result.status).toBe(1);
    expect(result.output).toContain("只能改门禁文件，这里还改了 1 个别的路径：src/app.ts");
  });

  it("gate-change 的 PR 可以同时改 infra/ci 下的文档", () => {
    const result = classify({ ...loosened, "infra/ci/README.md": "# 改过的说明\n" }, [
      "--labels",
      "gate-change",
    ]);
    expect(result.status).toBe(0);
  });

  it("只增与放松并存：仍按放松判", () => {
    const next = { ...ROOT, devDependencies: { eslint: "10.12.0", prettier: "3.9.9" } };
    const result = classify({ "package.json": json(next) });
    expect(result.verdict).toBe("loosen");
    expect(result.touch).toHaveLength(1);
    expect(result.status).toBe(1);
  });
});

describe("用法", () => {
  it("缺 --base：退出码 2", () => {
    const result = spawnSync("node", [script], { cwd: repoRoot, encoding: "utf8" });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("缺 --base");
  });

  it("仓库里的门禁文件清单能被读懂：对本仓库跑一遍不报用法错误", () => {
    const result = spawnSync("node", [script, "--base", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
  });
});

// ---------- 经 gh 写 PR：真脚本加桩命令 ----------

/** 假的 gh：把每次调用记进日志，按环境变量里的设定应答 */
const GH_STUB = String.raw`#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_GH_LOG, JSON.stringify(args) + "\n");
const path = args.find((arg) => arg.startsWith("repos/"));
const method = args.includes("--method") ? args[args.indexOf("--method") + 1] : "GET";
if (method === "GET" && /\/pulls\/\d+$/.test(path)) {
  process.stdout.write(process.env.FAKE_GH_PR);
} else if (method === "GET" && /\/labels\/gate-touch$/.test(path)) {
  if (process.env.FAKE_GH_NO_LABEL) {
    process.stderr.write("gh: Not Found (HTTP 404)\n");
    process.exit(1);
  }
} else if (method === "PATCH") {
  const field = args[args.indexOf("--field") + 1];
  fs.copyFileSync(field.slice("body=@".length), process.env.FAKE_GH_BODY);
}
`;

function withGh(pr: { body: string; labels: string[] }, extraEnv: Record<string, string> = {}) {
  const temp = makeTempDir("lyx-gh-");
  cleanups.push(temp.cleanup);
  const bin = join(temp.dir, "bin");
  writeFiles(bin, { gh: GH_STUB });
  chmodSync(join(bin, "gh"), 0o755);
  const log = join(temp.dir, "calls.log");
  const body = join(temp.dir, "body.md");
  writeFileSync(log, "");
  const env = {
    PATH: `${bin}:${process.env.PATH ?? ""}`,
    FAKE_GH_LOG: log,
    FAKE_GH_BODY: body,
    FAKE_GH_PR: JSON.stringify({ body: pr.body, labels: pr.labels.map((name) => ({ name })) }),
    ...extraEnv,
  };
  const calls = () =>
    readFileSync(log, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => (JSON.parse(line) as string[]).join(" "));
  const writtenBody = () => (existsSync(body) ? readFileSync(body, "utf8") : null);
  return { env, calls, writtenBody };
}

const prArgs = ["--pr", "12", "--repo", "byfire-dev/liyoxi-project"];
const touched = {
  "packages/services/package.json": json({ ...SERVICES, dependencies: { zod: "4.6.5" } }),
};
const TEMPLATE =
  "<!-- gate-diff:start -->\n门禁改动清单：由 CI 自动写入。\n<!-- gate-diff:end -->\n\n## 1. 工作包\n";

describe("在 PR 上：写描述顶部的清单，打 gate-touch", () => {
  it("只增：清单写进两个标记之间，其余描述不动；打上 gate-touch", () => {
    const gh = withGh({ body: TEMPLATE, labels: [] });
    const result = classify(touched, prArgs, gh.env);
    expect(result.status).toBe(0);
    const body = gh.writtenBody() ?? "";
    expect(body).toMatch(/^<!-- gate-diff:start -->\n\*\*门禁改动清单\*\*/);
    expect(body).toContain("判定：只增（`gate-touch`）");
    expect(body).toContain(
      "- `packages/services/package.json`：新增依赖 zod@4.6.5（dependencies）",
    );
    expect(body).toContain("<!-- gate-diff:end -->\n\n## 1. 工作包\n");
    expect(body).not.toContain("由 CI 自动写入。\n<!--");
    expect(gh.calls()).toContain(
      "api --method POST repos/byfire-dev/liyoxi-project/issues/12/labels --raw-field labels[]=gate-touch --silent",
    );
  });

  it("描述里没有标记：把清单加在最前面", () => {
    const gh = withGh({ body: "## 1. 工作包\n", labels: [] });
    classify(touched, prArgs, gh.env);
    expect(gh.writtenBody()).toMatch(
      /^<!-- gate-diff:start -->[\s\S]*<!-- gate-diff:end -->\n\n## 1\. 工作包\n$/,
    );
  });

  it("仓库里没有 gate-touch 标签：报出明确的错误，不自己建", () => {
    const gh = withGh({ body: TEMPLATE, labels: [] }, { FAKE_GH_NO_LABEL: "1" });
    const result = classify(touched, prArgs, gh.env);
    expect(result.status).toBe(1);
    expect(result.output).toContain("仓库里没有 gate-touch 标签。请业主先建");
    expect(gh.calls().some((call) => call.includes("--method POST"))).toBe(false);
  });

  it("已经有 gate-touch：不重复打", () => {
    const gh = withGh({ body: TEMPLATE, labels: ["gate-touch"] });
    expect(classify(touched, prArgs, gh.env).status).toBe(0);
    expect(gh.calls().some((call) => call.includes("--method POST"))).toBe(false);
  });

  it("后来的提交撤掉了门禁改动：摘掉 gate-touch", () => {
    const gh = withGh({ body: TEMPLATE, labels: ["gate-touch"] });
    const result = classify({ "src/app.ts": "export const a = 2;\n" }, prArgs, gh.env);
    expect(result.status).toBe(0);
    expect(gh.calls()).toContain(
      "api --method DELETE repos/byfire-dev/liyoxi-project/issues/12/labels/gate-touch --silent",
    );
    expect(gh.writtenBody()).toContain("判定：没有门禁改动");
  });

  it("标签从 PR 上读：带 gate-change 的放松类 PR 通过", () => {
    const gh = withGh({ body: TEMPLATE, labels: ["gate-change"] });
    const loosened = { "package.json": json({ ...ROOT, devDependencies: { eslint: "10.12.0" } }) };
    const result = classify(loosened, prArgs, gh.env);
    expect(result.status).toBe(0);
    expect(gh.writtenBody()).toContain("放松 1 项");
  });

  it("放松类改动而 PR 没有 gate-change：失败，清单照样写上", () => {
    const gh = withGh({ body: TEMPLATE, labels: [] });
    const loosened = {
      "packages/config/eslint/repo.js": RULES.replace(/^.*no-explicit-any.*\n/m, ""),
    };
    const result = classify(loosened, prArgs, gh.env);
    expect(result.status).toBe(1);
    expect(gh.writtenBody()).toContain("含放松类改动");
  });
});
