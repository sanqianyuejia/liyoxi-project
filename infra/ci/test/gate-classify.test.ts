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
const SERVICES = {
  name: "@liyoxi/services",
  scripts: {
    typecheck: "tsc --noEmit -p tsconfig.json",
    test: "vitest run --passWithNoTests",
    build: "echo 占位",
  },
  dependencies: {},
};
const WEAPP = {
  name: "@liyoxi/weapp",
  scripts: { typecheck: "tsc --noEmit -p tsconfig.json", test: "echo '占位：前端测试以后接'" },
};
const LOCK = `lockfileVersion: '9.0'

settings:
  autoInstallPeers: true

importers:

  .:
    devDependencies:
      eslint:
        specifier: 10.11.0
        version: 10.11.0
      vitest:
        specifier: 4.1.11
        version: 4.1.11(@types/node@24.19.0)

  packages/services: {}

packages:

  eslint@10.11.0:
    resolution: {integrity: sha512-aaa}

  '@types/node@24.19.0':
    resolution: {integrity: sha512-bbb}

  debug@4.4.3:
    resolution: {integrity: sha512-ddd}

  ms@2.1.3:
    resolution: {integrity: sha512-mmm}

  vitest@4.1.11:
    resolution: {integrity: sha512-vvv}
    peerDependencies:
      '@types/node': ^22.0.0 || >=24.0.0

snapshots:

  eslint@10.11.0:
    dependencies:
      debug: 4.4.3

  '@types/node@24.19.0': {}

  debug@4.4.3:
    dependencies:
      ms: 2.1.3

  ms@2.1.3: {}

  vitest@4.1.11(@types/node@24.19.0):
    dependencies:
      debug: 4.4.3
    optionalDependencies:
      '@types/node': 24.19.0
`;
/** tsconfig 预设：故意带注释与行尾逗号，分类脚本要能解析 */
const TSCONFIG = `{
  // 全仓的严格度以这份为准
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023"],
    "strict": true,
    "skipLibCheck": false,
    "exactOptionalPropertyTypes": false,
    "types": ["node"],
  },
  "include": ["src", "test"],
}
`;
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

const baseFiles: Record<string, string> = {
  ".github/workflows/ci.yml": WORKFLOW,
  "infra/ci/layers.json": json(LAYERS),
  "infra/ci/gate-files.json": json(REGISTRY),
  "infra/ci/check-x.mjs": 'console.log("x");\n',
  "infra/ci/selftest/cases/x.mjs": "export default { reason: /出现旧名/ };\n",
  "infra/ci/test/x.test.ts": 'it("x", () => {});\n',
  "infra/ci/README.md": "# 说明\n",
  "packages/config/eslint/repo.js": RULES,
  "packages/config/tsconfig/base.json": TSCONFIG,
  "eslint.config.js": "export default [];\n",
  "commitlint.config.js": 'export default { extends: ["@commitlint/config-conventional"] };\n',
  "package.json": json(ROOT),
  "packages/services/package.json": json(SERVICES),
  "apps/weapp/package.json": json(WEAPP),
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

/**
 * 分了叉的两条线：共同祖先（缺省是全部基线文件）之上，目标分支提交 onTarget，工作分支提交 onBranch。
 * 返回仓库目录（检出在工作分支上）与目标分支头的提交号，分类脚本用 --base <目标分支头> 来判。
 */
function diverged(
  onTarget: Record<string, string>,
  onBranch: Record<string, string>,
  ancestor: Record<string, string> = baseFiles,
): { dir: string; target: string } {
  const temp = makeTempRepo("lyx-gate-", ancestor);
  cleanups.push(temp.cleanup);
  git(temp.dir, "commit", "-q", "-m", "ancestor");
  git(temp.dir, "branch", "work");
  writeFiles(temp.dir, onTarget);
  git(temp.dir, "add", "-A");
  git(temp.dir, "commit", "-q", "-m", "target");
  const target = git(temp.dir, "rev-parse", "HEAD").stdout.trim();
  git(temp.dir, "checkout", "-q", "work");
  writeFiles(temp.dir, onBranch);
  git(temp.dir, "add", "-A");
  git(temp.dir, "commit", "-q", "-m", "work");
  return { dir: temp.dir, target };
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

  it("工作区包改自己的 build 脚本、加别的脚本不算门禁改动（占位构建换成真实构建）", () => {
    const next = {
      ...SERVICES,
      scripts: { ...SERVICES.scripts, build: "tsup", generate: "tsx scripts/generate.ts" },
    };
    expect(classify({ "packages/services/package.json": json(next) }).verdict).toBe("none");
  });

  it("根 package.json 改已知的说明性键（license、description）不算门禁改动", () => {
    const next = { ...ROOT, license: "UNLICENSED", description: "改过的说明" };
    const result = classify({ "package.json": json(next) });
    expect(result.verdict).toBe("none");
    expect(result.outside).toEqual([]);
  });

  it("工作区包加 exports、main 这类键不算门禁改动", () => {
    const next = { ...SERVICES, main: "src/index.ts", exports: { ".": "./src/index.ts" } };
    expect(classify({ "packages/services/package.json": json(next) }).verdict).toBe("none");
  });

  it("tsconfig 只改写法（去注释、一行拆多行、键与数组项换顺序）：按键值判，不算改动", () => {
    const next = json({
      include: ["test", "src"],
      compilerOptions: {
        types: ["node"],
        exactOptionalPropertyTypes: false,
        skipLibCheck: false,
        strict: true,
        lib: ["ES2023"],
        target: "ES2022",
      },
    });
    const result = classify({ "packages/config/tsconfig/base.json": next });
    expect(result.verdict).toBe("none");
    expect(result.outside).toEqual([]);
  });

  it("锁文件里加依赖带来的 peer 解析变化（版本后面括号里的内容）不算改动", () => {
    const next = LOCK.replaceAll(
      "4.1.11(@types/node@24.19.0)",
      "4.1.11(@types/node@24.19.0)(jsdom@27.0.0)",
    )
      .replace("      debug: 4.4.3\n", "      debug: 4.4.3(supports-color@10.2.2)\n")
      .replace(
        "  debug@4.4.3:\n    dependencies:",
        "  debug@4.4.3(supports-color@10.2.2):\n    dependencies:",
      );
    expect(next).not.toBe(LOCK);
    const result = classify({ "pnpm-lock.yaml": next });
    expect(whats(result.loosen)).toEqual([]);
    expect(result.verdict).toBe("none");
  });

  it("锁文件里多出一份 peer 解析不同的同名条目，只有它声明过的 peer 依赖版本不同：不算改动", () => {
    // 另一个工作区包带来了另一种 peer 解析：vitest 声明了 @types/node 是 peer，这一份解析到 22
    const variant = [
      "  vitest@4.1.11(@types/node@22.18.0):",
      "    dependencies:",
      "      debug: 4.4.3",
      "    optionalDependencies:",
      "      '@types/node': 22.18.0",
      "",
    ].join("\n");
    const result = classify({ "pnpm-lock.yaml": `${LOCK}\n${variant}` });
    expect(whats(result.loosen)).toEqual([]);
    expect(result.verdict).toBe("none");
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

  it.each(["4.6.5", "5.0.0-beta.2", "1.2.3+build.7", "workspace:*", "workspace:^"])(
    "新增依赖写成精确版本或工作区协议（%s）：只增",
    (version) => {
      const next = { ...SERVICES, dependencies: { zod: version } };
      const result = classify({ "packages/services/package.json": json(next) });
      expect(result.verdict).toBe("touch");
      expect(whats(result.touch)).toEqual([
        `packages/services/package.json: 新增依赖 zod@${version}（dependencies）`,
      ]);
    },
  );

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

  it("根上已登记的 lint 装配、提交信息规则里加行：仍按加行判，不被“遮蔽”那几条当成新建", () => {
    const result = classify({
      "eslint.config.js": "export default [];\nexport const extra = 1;\n",
      "commitlint.config.js": `${baseFiles["commitlint.config.js"]}export const extra = 1;\n`,
    });
    expect(result.verdict).toBe("touch");
    expect(whats(result.touch)).toEqual([
      "commitlint.config.js: 新增 1 行",
      "eslint.config.js: 新增 1 行",
    ]);
  });

  it("tsconfig 新增键、往数组里加项：只增，逐项列出", () => {
    const next = withChange(
      withChange(TSCONFIG, '"types": ["node"],', '"types": ["node", "vitest/globals"],'),
      '"strict": true,',
      '"strict": true,\n    "noImplicitOverride": true,\n    "paths": { "@/*": ["./src/*"] },',
    ).replace('"include": ["src", "test"],', '"include": ["src", "test", "scripts"],');
    const result = classify({ "packages/config/tsconfig/base.json": next });
    expect(whats(result.loosen)).toEqual([]);
    expect(result.touch.map((item) => item.what).sort()).toEqual(
      [
        'compilerOptions.types 里新增 "vitest/globals"',
        'include 里新增 "scripts"',
        "新增 compilerOptions.noImplicitOverride: true",
        '新增 compilerOptions.paths.@/*: ["./src/*"]',
      ].sort(),
    );
  });

  it("tsconfig 把严格性开关由松改严：是收紧，算只增", () => {
    const next = withChange(
      TSCONFIG,
      '"exactOptionalPropertyTypes": false,',
      '"exactOptionalPropertyTypes": true,',
    );
    const result = classify({ "packages/config/tsconfig/base.json": next });
    expect(result.verdict).toBe("touch");
    expect(whats(result.touch)).toEqual([
      "packages/config/tsconfig/base.json: 收紧了严格性开关 compilerOptions.exactOptionalPropertyTypes：false → true",
    ]);
  });

  it("新增一份 tsconfig 预设：只增", () => {
    const result = classify({
      "packages/config/tsconfig/node-lib.json": '{ "extends": "./base.json" }\n',
    });
    expect(whats(result.touch)).toEqual(["packages/config/tsconfig/node-lib.json: 新增文件"]);
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

  it("工作区包的检查脚本去掉 --passWithNoTests：是收紧，算只增", () => {
    const next = { ...SERVICES, scripts: { ...SERVICES.scripts, test: "vitest run" } };
    const result = classify({ "packages/services/package.json": json(next) });
    expect(result.verdict).toBe("touch");
    expect(whats(result.touch)).toEqual([
      "packages/services/package.json: 检查脚本 test 去掉了 --passWithNoTests",
    ]);
  });

  it("工作区包占位的检查脚本换成真实命令：算只增", () => {
    const next = { ...WEAPP, scripts: { ...WEAPP.scripts, test: "vitest run" } };
    const result = classify({ "apps/weapp/package.json": json(next) });
    expect(result.verdict).toBe("touch");
    expect(whats(result.touch)).toEqual([
      "apps/weapp/package.json: 检查脚本 test 由占位换成真实命令",
    ]);
  });

  it("工作流里新步骤后面紧跟一个新任务：两样都是整段新增", () => {
    const added =
      "      - name: 构建\n        run: pnpm build\n  e2e:\n    runs-on: ubuntu-24.04\n    steps:\n      - name: e2e\n        run: pnpm e2e\n";
    const next = withChange(WORKFLOW, "  required:\n", `${added}  required:\n`);
    const result = classify({ ".github/workflows/ci.yml": next });
    expect(result.verdict).toBe("touch");
    expect(result.touch.map((item) => item.what)).toEqual(["新增步骤或任务：- name: 构建"]);
  });

  it("放行文件与它的门禁条目在同一个 PR 里新建：算只增，两样都列出来给业主看", () => {
    // .gitleaksignore 在真实清单里是 frozen；这次差异里既建了它，也在仓库的清单里登记了它
    const registry = {
      files: [...REGISTRY.files, { pattern: ".gitleaksignore", kind: "frozen" }],
    };
    const result = classify({
      ".gitleaksignore": "abc:README.md:generic-api-key:1\n",
      "infra/ci/gate-files.json": json(registry),
    });
    expect(result.verdict).toBe("touch");
    expect(whats(result.touch)).toEqual([
      ".gitleaksignore: 新建了密钥扫描的放行项（它的门禁条目也是这次新增的）",
      "infra/ci/gate-files.json: 新增门禁文件条目 `.gitleaksignore`（frozen）",
    ]);
  });

  it("同建之后目标分支又往前走了（没登记这一条）：仍算只增", () => {
    const { dir, target } = diverged(
      { "src/other.ts": "export const b = 1;\n" },
      {
        ".gitleaksignore": "abc:README.md:generic-api-key:1\n",
        "infra/ci/gate-files.json": json({
          files: [...REGISTRY.files, { pattern: ".gitleaksignore", kind: "frozen" }],
        }),
      },
    );
    const result = spawnSync("node", [script, "--base", target], { cwd: dir, encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      "`.gitleaksignore`：新建了密钥扫描的放行项（它的门禁条目也是这次新增的）",
    );
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
      { "infra/ci/test/x.test.ts": 'it("x", () => {});\nit.skip("以后再说", () => {});\n' },
      "加的行像是忽略、豁免或白名单",
    ],
    [
      "已有的检查脚本里加一行（加在开头就能让它空转，判不出）",
      { "infra/ci/check-x.mjs": 'process.exit(0);\nconsole.log("x");\n' },
      "改了已有的检查脚本：这类文件只许新增",
    ],
    [
      "已有的反例里加一行（后写的同名键会盖掉前面的）",
      {
        "infra/ci/selftest/cases/x.mjs": "export default { reason: /出现旧名/,\n reason: /./ };\n",
      },
      "改了已有的门禁自测的框架与反例：这类文件只许新增",
    ],
    [
      "新步骤后面夹带任务级的键",
      {
        ".github/workflows/ci.yml": withChange(
          WORKFLOW,
          "  required:\n",
          "      - name: 构建\n        run: pnpm build\n    if: github.actor == 'someone'\n  required:\n",
        ),
      },
      "新增的步骤或任务后面夹带了它之外的行，判不出是不是只增：if: github.actor == 'someone'",
    ],
    [
      "新任务后面夹带顶层的键",
      {
        ".github/workflows/ci.yml": `${WORKFLOW}  e2e:\n    runs-on: ubuntu-24.04\ndefaults:\n  run:\n    shell: bash\n`,
      },
      "新增的步骤或任务后面夹带了它之外的行，判不出是不是只增：defaults:",
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
      "根 package.json 加依赖覆盖项（resolutions）",
      { "package.json": json({ ...ROOT, resolutions: { eslint: "10.10.0" } }) },
      "改了 resolutions",
    ],
    [
      "工作区包的 typecheck 脚本改成空转",
      {
        "packages/services/package.json": json({
          ...SERVICES,
          scripts: { ...SERVICES.scripts, typecheck: "true" },
        }),
      },
      "检查脚本 typecheck 改成了空转：true",
    ],
    [
      "工作区包的检查脚本后面接 || true",
      {
        "apps/weapp/package.json": json({
          ...WEAPP,
          scripts: { ...WEAPP.scripts, test: "vitest run || true" },
        }),
      },
      "检查脚本 test 改成了空转：vitest run || true",
    ],
    [
      "工作区包占位的检查脚本换成另一种空转",
      { "apps/weapp/package.json": json({ ...WEAPP, scripts: { ...WEAPP.scripts, test: "" } }) },
      "检查脚本 test 改成了空转",
    ],
    [
      "工作区包删掉 test 脚本",
      {
        "packages/services/package.json": json({
          ...SERVICES,
          scripts: { typecheck: SERVICES.scripts.typecheck, build: SERVICES.scripts.build },
        }),
      },
      "删掉了检查脚本 test",
    ],
    [
      "工作区包的检查脚本换了写法（判不出，按放松算）",
      {
        "packages/services/package.json": json({
          ...SERVICES,
          scripts: { ...SERVICES.scripts, typecheck: "tsc --noEmit -p tsconfig.loose.json" },
        }),
      },
      "改了已有的检查脚本 typecheck，判不出是不是放松",
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
      "锁文件里已有条目换了来源",
      {
        "pnpm-lock.yaml": withChange(
          LOCK,
          "resolution: {integrity: sha512-aaa}",
          "resolution: {tarball: https://example.invalid/eslint-10.11.0.tgz}",
        ),
      },
      "锁文件里有 1 个已有条目的内容有变（来源、校验值等）：eslint@10.11.0",
    ],
    [
      "锁文件里已有条目换了校验值",
      { "pnpm-lock.yaml": withChange(LOCK, "sha512-bbb", "sha512-zzz") },
      "锁文件里有 1 个已有条目的内容有变（来源、校验值等）：@types/node@24.19.0",
    ],
    [
      "锁文件头部的设置有变",
      { "pnpm-lock.yaml": withChange(LOCK, "autoInstallPeers: true", "autoInstallPeers: false") },
      "锁文件头部",
    ],
    ["清单文件解析不了（判不出）", { "infra/ci/layers.json": "{ 不是 JSON" }, "解析不了，判不出"],
    [
      "新建放行文件，而这次差异里没有登记它的条目",
      { ".gitleaksignore": "abc:README.md:generic-api-key:1\n" },
      ".gitleaksignore: 新建了密钥扫描的放行项",
    ],
    [
      "新建放行文件，同时把清单改得解析不了（判不出是不是同建）",
      { ".gitleaksignore": "abc\n", "infra/ci/gate-files.json": "{ 不是 JSON" },
      ".gitleaksignore: 新建了密钥扫描的放行项",
    ],
    [
      "锁文件 importers 段里已有依赖的解析版本有变",
      {
        "pnpm-lock.yaml": withChange(
          LOCK,
          "        version: 10.11.0\n",
          "        version: 10.10.0\n",
        ),
      },
      "锁文件 importers 段里有 1 处已有的依赖有变：. 的 eslint 由“specifier 10.11.0、解析到 10.11.0”改成“specifier 10.11.0、解析到 10.10.0”",
    ],
    [
      "锁文件 importers 段里已有依赖的 specifier 改成范围",
      {
        "pnpm-lock.yaml": withChange(LOCK, "specifier: 4.1.11\n", "specifier: ^4.1.11\n"),
      },
      ". 的 vitest 由“specifier 4.1.11、解析到 4.1.11”改成“specifier ^4.1.11、解析到 4.1.11”",
    ],
    [
      "锁文件 importers 段里删掉一个已有的依赖",
      {
        "pnpm-lock.yaml": withChange(
          LOCK,
          "      vitest:\n        specifier: 4.1.11\n        version: 4.1.11(@types/node@24.19.0)\n",
          "",
        ),
      },
      "锁文件 importers 段里有 1 处已有的依赖有变：. 的 vitest 被删",
    ],
    [
      "锁文件 importers 段里删掉整个工作区包",
      { "pnpm-lock.yaml": withChange(LOCK, "  packages/services: {}\n", "") },
      "packages/services 整个条目被删",
    ],
    [
      "锁文件 snapshots 段里已有条目的依赖版本有变",
      { "pnpm-lock.yaml": withChange(LOCK, "      ms: 2.1.3\n", "      ms: 2.1.2\n") },
      "锁文件 snapshots 段里有 1 处已有条目的依赖有变：debug@4.4.3 的 ms 由 2.1.3 改成 2.1.2",
    ],
    [
      "锁文件 snapshots 段里已有条目删掉一个依赖",
      {
        "pnpm-lock.yaml": withChange(
          LOCK,
          "  debug@4.4.3:\n    dependencies:\n      ms: 2.1.3\n",
          "  debug@4.4.3: {}\n",
        ),
      },
      "debug@4.4.3 的 ms 被删",
    ],
    [
      "锁文件 snapshots 段里改已有条目的依赖版本，另加一份同名的条目留着旧版本",
      {
        "pnpm-lock.yaml": withChange(
          LOCK,
          "  debug@4.4.3:\n    dependencies:\n      ms: 2.1.3\n",
          "  debug@4.4.3:\n    dependencies:\n      ms: 2.1.2\n\n  debug@4.4.3(decoy@1.0.0):\n    dependencies:\n      ms: 2.1.3\n",
        ),
      },
      "锁文件 snapshots 段里有 1 处已有条目的依赖有变：debug@4.4.3 的 ms 由 2.1.3 改成 2.1.2",
    ],
    [
      "锁文件 snapshots 段里已有条目删掉一个依赖，另加一份同名的条目留着它",
      {
        "pnpm-lock.yaml": withChange(
          LOCK,
          "  debug@4.4.3:\n    dependencies:\n      ms: 2.1.3\n",
          "  debug@4.4.3: {}\n\n  debug@4.4.3(decoy@1.0.0):\n    dependencies:\n      ms: 2.1.3\n",
        ),
      },
      "锁文件 snapshots 段里有 1 处已有条目的依赖有变：debug@4.4.3 的 ms 被删",
    ],
    [
      "锁文件 importers 段把解析版本改指到新加的同名条目，那份条目里的依赖版本不同",
      {
        "pnpm-lock.yaml": withChange(
          withChange(LOCK, "        version: 10.11.0\n", "        version: 10.11.0(decoy@1.0.0)\n"),
          "  '@types/node@24.19.0': {}\n",
          "  eslint@10.11.0(decoy@1.0.0):\n    dependencies:\n      debug: 4.4.2\n\n  '@types/node@24.19.0': {}\n",
        ),
      },
      "锁文件 snapshots 段里有 1 处已有条目的依赖有变：新出现的同名条目 eslint@10.11.0(decoy@1.0.0) 的 debug 是 4.4.2，基线上是 4.4.3",
    ],
    [
      "锁文件 snapshots 段里别的条目改指到新加的同名条目，那份条目里的依赖版本不同",
      {
        "pnpm-lock.yaml": withChange(
          withChange(LOCK, "      debug: 4.4.3\n", "      debug: 4.4.3(decoy@1.0.0)\n"),
          "  ms@2.1.3: {}\n",
          "  debug@4.4.3(decoy@1.0.0):\n    dependencies:\n      ms: 2.1.2\n\n  ms@2.1.3: {}\n",
        ),
      },
      "新出现的同名条目 debug@4.4.3(decoy@1.0.0) 的 ms 是 2.1.2，基线上是 2.1.3",
    ],
    [
      "锁文件 snapshots 段里条目的键变了（多一个 peer），依赖版本也跟着改了",
      {
        "pnpm-lock.yaml": LOCK.replaceAll(
          "4.1.11(@types/node@24.19.0)",
          "4.1.11(@types/node@24.19.0)(jsdom@27.0.0)",
        ).replace(
          "(jsdom@27.0.0):\n    dependencies:\n      debug: 4.4.3\n",
          "(jsdom@27.0.0):\n    dependencies:\n      debug: 4.4.2\n",
        ),
      },
      "vitest@4.1.11 的 debug 由 4.4.3 改成 4.4.2",
    ],
    [
      "锁文件里多出一份同名条目，没声明成 peer 的依赖版本不同（声明过的那个不算）",
      {
        "pnpm-lock.yaml": `${LOCK}\n  vitest@4.1.11(@types/node@22.18.0):\n    dependencies:\n      debug: 4.4.2\n    optionalDependencies:\n      '@types/node': 22.18.0\n`,
      },
      "锁文件 snapshots 段里有 1 处已有条目的依赖有变：新出现的同名条目 vitest@4.1.11(@types/node@22.18.0) 的 debug 是 4.4.2，基线上是 4.4.3",
    ],
    [
      "tsconfig 新增一行把 noImplicitAny 关掉",
      {
        "packages/config/tsconfig/base.json": withChange(
          TSCONFIG,
          '"strict": true,',
          '"strict": true,\n    "noImplicitAny": false,',
        ),
      },
      "关掉了严格性开关：新增 compilerOptions.noImplicitAny: false",
    ],
    [
      "tsconfig 把 strict 改成 false",
      {
        "packages/config/tsconfig/base.json": withChange(
          TSCONFIG,
          '"strict": true',
          '"strict": false',
        ),
      },
      "关掉了严格性开关 compilerOptions.strict：true → false",
    ],
    [
      "tsconfig 用同名键顶替（后写的 strict: false 生效）",
      {
        "packages/config/tsconfig/base.json": withChange(
          TSCONFIG,
          '"types": ["node"],',
          '"types": ["node"],\n    "strict": false,',
        ),
      },
      "关掉了严格性开关 compilerOptions.strict：true → false",
    ],
    [
      "tsconfig 把 skipLibCheck 由 false 改成 true",
      {
        "packages/config/tsconfig/base.json": withChange(
          TSCONFIG,
          '"skipLibCheck": false',
          '"skipLibCheck": true',
        ),
      },
      "关掉了严格性开关 compilerOptions.skipLibCheck：false → true",
    ],
    [
      "tsconfig 新增 noCheck",
      {
        "packages/config/tsconfig/base.json": withChange(
          TSCONFIG,
          '"strict": true,',
          '"strict": true,\n    "noCheck": true,',
        ),
      },
      "关掉了严格性开关：新增 compilerOptions.noCheck: true",
    ],
    [
      "tsconfig 新增 exclude",
      {
        "packages/config/tsconfig/base.json": withChange(
          TSCONFIG,
          '"include": ["src", "test"],',
          '"include": ["src", "test"],\n  "exclude": ["src/legacy"],',
        ),
      },
      '新增了 exclude：["src/legacy"]',
    ],
    [
      "tsconfig 新增 extends",
      {
        "packages/config/tsconfig/base.json": withChange(
          TSCONFIG,
          '"include": ["src", "test"],',
          '"include": ["src", "test"],\n  "extends": "./loose.json",',
        ),
      },
      '新增了 extends："./loose.json"',
    ],
    [
      "tsconfig 从 include 里删一项",
      {
        "packages/config/tsconfig/base.json": withChange(
          TSCONFIG,
          '"include": ["src", "test"],',
          '"include": ["src"],',
        ),
      },
      'include 里删掉了 "test"',
    ],
    [
      "tsconfig 删掉 strict",
      {
        "packages/config/tsconfig/base.json": withChange(TSCONFIG, '    "strict": true,\n', ""),
      },
      "删掉了 compilerOptions.strict（原来是 true）",
    ],
    [
      "tsconfig 改已有的键（target）",
      {
        "packages/config/tsconfig/base.json": withChange(TSCONFIG, '"ES2022"', '"ES5"'),
      },
      '改了 compilerOptions.target："ES2022" → "ES5"',
    ],
    [
      "tsconfig 新增的键命中豁免关键字（allowJs）",
      {
        "packages/config/tsconfig/base.json": withChange(
          TSCONFIG,
          '"strict": true,',
          '"strict": true,\n    "allowJs": true,',
        ),
      },
      "新增的键像是忽略、豁免或白名单：compilerOptions.allowJs: true",
    ],
    [
      "tsconfig 解析不了（判不出）",
      { "packages/config/tsconfig/base.json": '{ "compilerOptions": { "strict": }' },
      "改后的文件解析不了，判不出",
    ],
  ];

  it.each(cases)("%s", (_label, changes, expected) => {
    const result = classify(changes);
    expect(result.verdict).toBe("loosen");
    expect(whats(result.loosen).join("\n")).toContain(expected);
    expect(result.status).toBe(1);
    expect(result.output).toContain("没有 gate-change 标签");
  });

  // 新增一个文件就能遮蔽已登记的配置：这些文件名在任何目录下都是 frozen，新建即放松
  const LINT = "根上那份以外的 lint 配置（子目录里的会遮蔽根上的装配）";
  const FORMAT = "格式规则（任何目录）";
  const shadows: Array<[string, string]> = [
    ["packages/services/eslint.config.js", LINT],
    ["apps/api/src/eslint.config.mjs", LINT],
    ["infra/eslint.config.ts", LINT],
    ["eslint.config.mjs", LINT],
    ["packages/shared/.prettierrc", FORMAT],
    ["apps/weapp/.prettierrc.json", FORMAT],
    [".prettierrc", FORMAT],
    ["apps/admin/prettier.config.js", "另一种文件名的格式规则（会遮蔽已登记的那份）"],
    [".commitlintrc.json", "另一种文件名的提交信息规则（会遮蔽已登记的那份）"],
    ["commitlint.config.mjs", "根上那份以外的提交信息规则（会遮蔽已登记的那份）"],
    [".lintstagedrc", "根上那份以外的提交前检查配置（会遮蔽已登记的那份）"],
    ["packages/shared/.lintstagedrc.json", "根上那份以外的提交前检查配置（会遮蔽已登记的那份）"],
    ["lint-staged.config.js", "另一种文件名的提交前检查配置（会遮蔽已登记的那份）"],
  ];

  it.each(shadows)("新增 %s：会遮蔽已登记的配置，按放松算", (path, note) => {
    const result = classify({ [path]: "export default [];\n" });
    expect(result.verdict).toBe("loosen");
    expect(whats(result.loosen)).toEqual([`${path}: 新建了${note}`]);
    expect(result.outside).toEqual([]);
    expect(result.status).toBe(1);
  });

  // 新增一个键也能遮蔽：工具先读 package.json 里的同名键
  it.each(["commitlint", "prettier", "lint-staged", "eslintConfig", "workspaces", "devEngines"])(
    "根 package.json 新增顶层键 %s：不在已知的键里，按放松算",
    (key) => {
      const result = classify({ "package.json": json({ ...ROOT, [key]: { rules: {} } }) });
      expect(result.verdict).toBe("loosen");
      expect(whats(result.loosen).join("\n")).toContain(
        `package.json: 新增了顶层键 ${key}：不在已知的键里，判不出`,
      );
      expect(result.status).toBe(1);
    },
  );

  it.each(["prettier", "lint-staged", "commitlint", "eslintConfig"])(
    "工作区包的 package.json 新增 %s 键：按放松算",
    (key) => {
      const next = { ...SERVICES, [key]: { semi: false } };
      const result = classify({ "packages/services/package.json": json(next) });
      expect(result.verdict).toBe("loosen");
      expect(whats(result.loosen)).toEqual([
        `packages/services/package.json: 动了 ${key} 键：工具先读 package.json 里的它，会遮蔽已登记的配置文件`,
      ]);
    },
  );

  // 新增依赖不是精确版本：判不出装的是哪一版
  it.each([
    "^4.6.5",
    "~4.6.5",
    "*",
    "latest",
    ">=4.6.0 <5",
    "4.x",
    "4.6",
    "npm:zod@4.6.5",
    "catalog:",
  ])("新增依赖写成 %s：不是精确版本，按放松算", (version) => {
    const next = { ...SERVICES, dependencies: { zod: version } };
    const result = classify({ "packages/services/package.json": json(next) });
    expect(result.verdict).toBe("loosen");
    expect(result.touch).toEqual([]);
    expect(whats(result.loosen)).toEqual([
      `packages/services/package.json: 新增依赖 zod@${version}（dependencies）不是精确版本，判不出装的是哪一版（CLAUDE.md 第 4 节：全部写精确版本）`,
    ]);
    expect(result.status).toBe(1);
  });

  it("根 package.json 新增的依赖写成范围：同样按放松算", () => {
    const next = { ...ROOT, devDependencies: { ...ROOT.devDependencies, prettier: "^3.9.9" } };
    const result = classify({ "package.json": json(next) });
    expect(result.verdict).toBe("loosen");
    expect(whats(result.loosen).join("\n")).toContain(
      "新增依赖 prettier@^3.9.9（devDependencies）不是精确版本",
    );
  });

  it("分支的共同祖先上没有清单，分支自己也没登记：新建放行文件不算同建，按放松算", () => {
    const temp = makeTempRepo("lyx-gate-", { "src/app.ts": "export const a = 1;\n" });
    cleanups.push(temp.cleanup);
    git(temp.dir, "commit", "-q", "-m", "base");
    writeFiles(temp.dir, { ".gitleaksignore": "abc:README.md:generic-api-key:1\n" });
    git(temp.dir, "add", "-A");
    git(temp.dir, "commit", "-q", "-m", "head");
    const result = spawnSync("node", [script, "--base", "HEAD~1"], {
      cwd: temp.dir,
      encoding: "utf8",
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("- `.gitleaksignore`：新建了密钥扫描的放行项\n");
    expect(result.stdout).not.toContain("它的门禁条目也是这次新增的");
  });

  it("落后的分支把目标分支上的清单原样拷进来，再新建放行文件：目标分支上已登记，不算同建，按放松算", () => {
    // 共同祖先上还没有清单；目标分支随后登记了清单（含 .gitleaksignore）。分支没同步，把那份清单逐字拷进来
    const registry = json({
      files: [...REGISTRY.files, { pattern: ".gitleaksignore", kind: "frozen" }],
    });
    const { dir, target } = diverged(
      { "infra/ci/gate-files.json": registry },
      {
        "infra/ci/gate-files.json": registry,
        ".gitleaksignore": "abc:README.md:generic-api-key:1\n",
      },
      { "src/app.ts": "export const a = 1;\n" },
    );
    const result = spawnSync("node", [script, "--base", target], { cwd: dir, encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("- `.gitleaksignore`：新建了密钥扫描的放行项\n");
    expect(result.stdout).not.toContain("它的门禁条目也是这次新增的");
    expect(result.stderr).toContain("没有 gate-change 标签");
  });

  it("目标分支上的清单解析不了：判不出是不是同建，按放松算", () => {
    const { dir, target } = diverged(
      { "infra/ci/gate-files.json": "{ 不是 JSON" },
      {
        ".gitleaksignore": "abc:README.md:generic-api-key:1\n",
        "infra/ci/gate-files.json": json({
          files: [...REGISTRY.files, { pattern: ".gitleaksignore", kind: "frozen" }],
        }),
      },
    );
    const result = spawnSync("node", [script, "--base", target], { cwd: dir, encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("- `.gitleaksignore`：新建了密钥扫描的放行项\n");
  });

  // 规则文件里只加行，但加的是关掉、降级检查的写法：靠关键字拦
  const disabling: Array<[string, string]> = [
    ["末尾追加一段把规则设为 off", 'export const late = { rules: { "no-var": "off" } };'],
    ["追加一段把规则降成 warn", "export const late = { rules: { 'no-var': 'warn' } };"],
    ["规则级别写成数字 0", 'export const late = { rules: { "no-var": 0 } };'],
    ["规则级别写成数组里的数字 1", 'export const late = { rules: { "no-var": [1, "always"] } };'],
    ["加一行提前退出", "process.exit(0);"],
    [
      "加 doNotFollow（依赖方向不跟进）",
      'export const options = { doNotFollow: { path: "packages" } };',
    ],
    ["加 passWithNoTests（没有用例也算过）", "export const test = { passWithNoTests: true };"],
  ];

  it.each(disabling)("规则文件里%s", (_label, line) => {
    const result = classify({ "packages/config/eslint/repo.js": `${RULES}${line}\n` });
    expect(result.verdict).toBe("loosen");
    expect(whats(result.loosen)).toEqual([
      `packages/config/eslint/repo.js: 加的行像是忽略、豁免或白名单（含关掉、降级检查的写法）：${line}`,
    ]);
    expect(result.status).toBe(1);
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
