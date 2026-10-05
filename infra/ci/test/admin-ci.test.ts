import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { git, makeTempDir, makeTempRepo, repoRoot, run, writeFiles } from "./helpers.js";

// 后台与下载页骨架（W0-28）接进 CI 的几样：步骤在不在、冒烟的受影响范围怎么判、构建产物检查与页面清单的口径。
// 钉在这里：步骤被拿掉、冒烟被改成总是不跑、检查不再看某一项，用例会红。反例在 selftest/cases/（pages-*、web-build-*）。

const read = (path: string) => readFileSync(join(repoRoot, path), "utf8");
const ci = read(".github/workflows/ci.yml");
const CHECK_BUILD = join(repoRoot, "apps/admin/scripts/check-build.mjs");
const AFFECTED = join(repoRoot, "apps/admin/scripts/e2e-affected.mjs");
const PAGES = join(repoRoot, "infra/ci/pages/generate.mjs");

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/** web 任务的各个步骤：从它的键到下一个任务的键 */
function webSteps(): Map<string, string> {
  const start = ci.indexOf("\n  web:\n");
  expect(start).toBeGreaterThan(0);
  const next = ci.slice(start + 2).search(/^ {2}[\w-]+:$/m) + 1;
  expect(next).toBeGreaterThan(0);
  const steps = new Map<string, string>();
  for (const text of ci
    .slice(start, start + 1 + next)
    .split(/^ {6}- name: /m)
    .slice(1)) {
    steps.set(text.slice(0, text.indexOf("\n")), text);
  }
  return steps;
}

describe("CI：后台与下载页的步骤在必过任务 web 里", () => {
  const steps = webSteps();
  const scripts = (JSON.parse(read("package.json")) as { scripts: Record<string, string> }).scripts;

  it("单测、构建、页面清单三步都在，不带条件、不带免死牌", () => {
    const expected: Record<string, string> = {
      后台与下载页单测: "pnpm --filter @liyoxi/admin --filter @liyoxi/portal test",
      后台与下载页构建: "pnpm admin:build && pnpm portal:build",
      页面清单无差异: "node infra/ci/pages/generate.mjs --check",
    };
    for (const [name, command] of Object.entries(expected)) {
      const step = steps.get(name);
      expect(step, name).toBeDefined();
      expect(step, name).toContain(`\n        run: ${command}\n`);
      expect(step, name).not.toMatch(/^ {8}if:/m);
      expect(step, name).not.toMatch(/\|\|/);
    }
  });

  it("web 是 required 的依赖：这几步失败，必过检查就失败", () => {
    const required = ci.slice(ci.indexOf("\n  required:\n"));
    expect(required).toMatch(/^ {4}needs:\n(?: {6}- [\w-]+\n)*? {6}- web$/m);
  });

  it("根脚本指到两个应用自己的脚本；两个应用的 build 都在 vite build 之后跑产物检查，test 是真的 vitest", () => {
    expect(scripts["admin:build"]).toBe("pnpm --filter @liyoxi/admin build");
    expect(scripts["portal:build"]).toBe("pnpm --filter @liyoxi/portal build");
    expect(scripts["admin:e2e"]).toBe("pnpm --filter @liyoxi/admin e2e");
    for (const app of ["admin", "portal"]) {
      const manifest = JSON.parse(read(`apps/${app}/package.json`)) as {
        scripts: Record<string, string>;
      };
      expect(manifest.scripts.build, app).toMatch(
        new RegExp(`^vite build && node \\S*scripts/check-build\\.mjs dist/app --app ${app}$`),
      );
      expect(manifest.scripts.test, app).toBe("vitest run");
    }
  });

  it("冒烟三步只看“要不要跑”那一步的结论；截图在用例失败时也上传，没有文件即失败", () => {
    const decide = steps.get("后台冒烟要不要跑");
    expect(decide).toContain("\n        id: admin-e2e\n");
    expect(decide).toContain(
      '\n        run: node apps/admin/scripts/e2e-affected.mjs --base "$BASE"\n',
    );
    expect(decide).toContain(
      "github.event_name == 'pull_request' && format('origin/{0}', github.base_ref) || ''",
    );
    expect(decide).not.toMatch(/^ {8}if:/m);
    // 浏览器缓存的两步（取版本、缓存）也只在要跑时执行；缓存的键里带 Playwright 的版本
    for (const name of ["取 Playwright 的版本", "后台冒烟用的浏览器缓存"]) {
      expect(steps.get(name), name).toContain(
        "\n        if: steps.admin-e2e.outputs.run == 'true'\n",
      );
    }
    expect(steps.get("取 Playwright 的版本")).toContain("\n        id: playwright\n");
    const cache = steps.get("后台冒烟用的浏览器缓存");
    expect(cache).toMatch(/uses: actions\/cache@[0-9a-f]{40} # v\d+\.\d+\.\d+/);
    expect(cache).toContain("\n          path: ~/.cache/ms-playwright\n");
    expect(cache).toMatch(
      /^ {10}key: playwright-.*\$\{\{ steps\.playwright\.outputs\.version \}\}$/m,
    );
    for (const name of ["装后台冒烟用的浏览器", "后台冒烟"]) {
      expect(steps.get(name), name).toContain(
        "\n        if: steps.admin-e2e.outputs.run == 'true'\n",
      );
      expect(steps.get(name), name).not.toMatch(/\|\|/);
    }
    expect(steps.get("后台冒烟")).toContain("\n        run: pnpm admin:e2e\n");
    const upload = steps.get("上传后台冒烟截图");
    expect(upload).toContain("\n        if: always() && steps.admin-e2e.outputs.run == 'true'\n");
    expect(upload).toMatch(/uses: actions\/upload-artifact@[0-9a-f]{40} # v\d+\.\d+\.\d+/);
    expect(upload).toContain("apps/admin/dist/e2e-shots/");
    expect(upload).toContain("if-no-files-found: error");
  });
});

describe("后台冒烟的受影响范围", () => {
  /** 建一个有 main 与一条分支的临时仓库，分支上改 files，返回脚本对它的结论 */
  function decide(files: Record<string, string>, base = "main") {
    const repo = makeTempRepo("lyx-e2e-affected-", { "README.md": "x\n" });
    cleanups.push(repo.cleanup);
    git(repo.dir, "commit", "-q", "-m", "base");
    git(repo.dir, "branch", "-M", "main");
    git(repo.dir, "checkout", "-q", "-b", "feat");
    writeFiles(repo.dir, files);
    git(repo.dir, "add", "-A");
    git(repo.dir, "commit", "-q", "-m", "change");
    return run(process.execPath, [AFFECTED, "--base", base], repo.dir);
  }

  it("改到后台、它依赖的包与预设、设计变量的来源、安装设置、锁文件、根清单或工作流：要跑", () => {
    for (const file of [
      "apps/admin/src/lib/menu/merchant.ts",
      "packages/shared/src/design/generated/tokens.ts",
      "packages/contract/src/index.ts",
      "packages/config/tsconfig/web-react19.json",
      "design/tokens.json",
      "pnpm-lock.yaml",
      "package.json",
      "pnpm-workspace.yaml",
      ".npmrc",
      ".nvmrc",
      ".node-version",
      ".github/workflows/ci.yml",
    ]) {
      const result = decide({ [file]: "changed\n" });
      expect(result.status, file).toBe(0);
      expect(result.output, file).toContain("后台冒烟：要跑");
      expect(result.output, file).toContain(file);
    }
  });

  it("只改了别处（服务端、文档、别的应用的 package.json、设计目录里变量来源以外的文件）：不用跑", () => {
    const result = decide({
      "packages/services/src/kernel/index.ts": "x\n",
      "docs/08-development-plan.md": "x\n",
      "apps/api/package.json": "{}\n",
      "design/design-spec.md": "x\n",
    });
    expect(result.status).toBe(0);
    expect(result.output).toContain("后台冒烟：不用跑");
  });

  it("没有基线（推到 main）一律跑；基线找不到按要跑算；不给 --base 是用法错误", () => {
    expect(decide({ "docs/x.md": "x\n" }, "").output).toContain("后台冒烟：要跑。不是 PR");
    const missing = decide({ "docs/x.md": "x\n" }, "origin/no-such-branch");
    expect(missing.status).toBe(0);
    expect(missing.output).toContain("按要跑算");
    expect(run(process.execPath, [AFFECTED], repoRoot).status).toBe(2);
  });

  it("结论写进 GITHUB_OUTPUT，后面的步骤按它决定跑不跑", () => {
    const repo = makeTempRepo("lyx-e2e-output-", { "README.md": "x\n" });
    cleanups.push(repo.cleanup);
    git(repo.dir, "commit", "-q", "-m", "base");
    const output = join(repo.dir, "github-output.txt");
    writeFiles(repo.dir, { "github-output.txt": "" });
    const result = run(
      "env",
      [`GITHUB_OUTPUT=${output}`, process.execPath, AFFECTED, "--base", "HEAD"],
      repo.dir,
    );
    expect(result.output).toContain("后台冒烟：不用跑");
    expect(readFileSync(output, "utf8")).toBe("run=false\n");
  });
});

describe("构建产物检查", () => {
  const BUILD = "0123456789ab";
  const good = (): Record<string, string> => ({
    "build.json": JSON.stringify({ app: "admin", build: BUILD, mode: "production" }),
    "index.html": `<script type="module" src="/assets/index-Ab12Cd34.js"></script><link rel="stylesheet" href="/assets/index-Zz99Yy88.css"><meta name="lyx-build" content="${BUILD}">`,
    "assets/index-Ab12Cd34.js": "console.log(1);\n",
    "assets/index-Zz99Yy88.css": "body{margin:0}\n",
  });
  const check = (files: Record<string, string>, app = "admin") => {
    const temp = makeTempDir("lyx-web-build-");
    cleanups.push(temp.cleanup);
    writeFiles(temp.dir, files);
    return run(process.execPath, [CHECK_BUILD, temp.dir, "--app", app], repoRoot);
  };

  it("合格的产物通过，并报出构建号", () => {
    const result = check(good());
    expect(result.output).toContain(`构建产物检查通过：admin，构建号 ${BUILD}`);
    expect(result.status).toBe(0);
  });

  it("带样例页的冒烟构建不能当生产产物：mode 不是 production 即失败", () => {
    const result = check({
      ...good(),
      "build.json": JSON.stringify({ app: "admin", build: BUILD, mode: "e2e" }),
    });
    expect(result.status).toBe(1);
    expect(result.output).toContain('不是生产构建：build.json 的 mode 是 "e2e"');
  });

  it("构建号缺失、两处不一致、应用名对不上、引用的文件不在：各自指出", () => {
    const { "build.json": _dropped, ...withoutBuild } = good();
    expect(check(withoutBuild).output).toContain("没有 build.json");
    expect(
      check({
        ...good(),
        "build.json": JSON.stringify({ app: "admin", build: "other", mode: "production" }),
      }).output,
    ).toMatch(/index\.html 的构建号（0123456789ab）与 build\.json 的（other）不一致/);
    expect(check(good(), "portal").output).toContain('build.json 的 app 是 "admin"，应为 portal');
    const { "assets/index-Zz99Yy88.css": _css, ...withoutCss } = good();
    expect(check(withoutCss).output).toContain("引用的 /assets/index-Zz99Yy88.css 不在产物里");
  });

  it("目录不存在是环境错误，不算通过", () => {
    expect(run(process.execPath, [CHECK_BUILD, "/no/such/dist"], repoRoot).status).toBe(2);
    expect(run(process.execPath, [CHECK_BUILD], repoRoot).status).toBe(2);
  });
});

describe("页面清单", () => {
  it("入库的 pages.md 与登记一致；重新生成到别处的内容与入库的逐字相同", () => {
    const temp = makeTempDir("lyx-pages-");
    cleanups.push(temp.cleanup);
    const out = join(temp.dir, "pages.md");
    expect(run(process.execPath, [PAGES, "--check"], repoRoot).status).toBe(0);
    expect(run(process.execPath, [PAGES, "--out", out], repoRoot).status).toBe(0);
    expect(readFileSync(out, "utf8")).toBe(read("docs/plan/pages.md"));
  });

  it("后台 56 个画板、16 个无画板业务页；下载页 5 页加落地页、验真页都标 M6", () => {
    const pages = read("docs/plan/pages.md");
    expect(pages).toContain("### 2.1 画板页（56）");
    expect(pages).toContain("### 2.2 无画板业务页（16）");
    expect(pages).toContain("| 运营管理后台 | 80 | 67 | 0 | 67 | 13 | 2 |");
    const portal = pages.slice(pages.indexOf("## 3. 电脑端下载页"));
    const m6 = portal.split("\n").filter((line) => line.includes("| M6 | G6-B |"));
    expect(m6.map((line) => line.split("|")[1]?.trim())).toEqual([
      "扫码登录页",
      "可下载清单",
      "成片下载",
      "样片与广告只读预览",
      "会话失效说明页",
      "扫一扫落地页",
      "授权书验真页",
    ]);
    // 通知面板、全局搜索标“入口隐藏”
    expect(pages).toMatch(/\| 通知面板 \| — \| 弹层或抽屉 \| 入口隐藏 \|/);
    expect(pages).toMatch(/\| 全局搜索 \| — \| 弹层或抽屉 \| 入口隐藏 \|/);
  });

  it("文件不在、内容被改：--check 失败并指出第一处差异；不认识的参数是用法错误", () => {
    const temp = makeTempDir("lyx-pages-");
    cleanups.push(temp.cleanup);
    const missing = run(
      process.execPath,
      [PAGES, "--check", "--out", join(temp.dir, "none.md")],
      repoRoot,
    );
    expect(missing.status).toBe(1);
    expect(missing.output).toContain("不存在");
    writeFiles(temp.dir, {
      "pages.md": read("docs/plan/pages.md").replace("# 页面清单", "# 页面清单（手改）"),
    });
    const edited = run(
      process.execPath,
      [PAGES, "--check", "--out", join(temp.dir, "pages.md")],
      repoRoot,
    );
    expect(edited.status).toBe(1);
    expect(edited.output).toContain("第一处差异在第 1 行");
    expect(run(process.execPath, [PAGES, "--bogus"], repoRoot).status).toBe(2);
  });
});
