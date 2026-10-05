import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { git, makeTempDir, makeTempRepo, repoRoot, run, writeFiles } from "./helpers.js";

// 小程序工程（W0-27a）接进 CI 的几样：步骤在不在、体积门禁的口径、截图的受影响范围怎么判。
// 钉在这里：步骤被拿掉、体积门禁不再看某一类包、截图被改成总是不跑，用例会红。反例在 selftest/cases/mp-size-*.mjs。

const read = (path: string) => readFileSync(join(repoRoot, path), "utf8");
const ci = read(".github/workflows/ci.yml");
const MP_SIZE = join(repoRoot, "infra/ci/check-mp-size.mjs");
const AFFECTED = join(repoRoot, "apps/weapp/scripts/shots-affected.mjs");

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function verifySteps(): Map<string, string> {
  const start = ci.indexOf("\n  verify:\n");
  const end = ci.indexOf("\n  gate-classify:\n");
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  const steps = new Map<string, string>();
  for (const text of ci
    .slice(start, end)
    .split(/^ {6}- name: /m)
    .slice(1)) {
    steps.set(text.slice(0, text.indexOf("\n")), text);
  }
  return steps;
}

describe("CI：小程序的步骤在必过任务 verify 里", () => {
  const steps = verifySteps();
  const scripts = (JSON.parse(read("package.json")) as { scripts: Record<string, string> }).scripts;
  const weapp = (JSON.parse(read("apps/weapp/package.json")) as { scripts: Record<string, string> })
    .scripts;

  it("单测与体积门禁两步都在，不带条件、不带免死牌", () => {
    const expected: Record<string, string> = {
      小程序单测: "pnpm --filter @liyoxi/weapp test",
      小程序体积门禁: "node infra/ci/check-mp-size.mjs apps/weapp/dist",
    };
    for (const [name, command] of Object.entries(expected)) {
      const step = steps.get(name);
      expect(step, name).toBeDefined();
      expect(step, name).toContain(`\n        run: ${command}\n`);
      expect(step, name).not.toMatch(/^ {8}if:/m);
      expect(step, name).not.toMatch(/\|\|/);
    }
  });

  it("根脚本指到小程序自己的脚本；小程序的 build 是真的构建（构建脚本末尾过体积门禁），test 是真的 vitest", () => {
    expect(scripts["weapp:build"]).toBe("pnpm --filter @liyoxi/weapp build");
    expect(scripts["weapp:shots"]).toBe("pnpm --filter @liyoxi/weapp shots");
    expect(weapp.build).toBe("node scripts/build.mjs weapp");
    expect(weapp.test).toBe("vitest run");
    const build = read("apps/weapp/scripts/build.mjs");
    expect(build).toContain("infra/ci/check-mp-size.mjs");
    expect(build).toMatch(/if \(type === "weapp" && !watch\) \{\n\s+run\(process\.execPath/);
  });

  it("截图三步只看“要不要跑”那一步的结论；截图在出图失败时也上传，没有文件即失败", () => {
    const decide = steps.get("小程序截图要不要跑");
    expect(decide).toContain("\n        id: weapp-shots\n");
    expect(decide).toContain(
      '\n        run: node apps/weapp/scripts/shots-affected.mjs --base "$BASE"\n',
    );
    expect(decide).toContain(
      "github.event_name == 'pull_request' && format('origin/{0}', github.base_ref) || ''",
    );
    expect(decide).not.toMatch(/^ {8}if:/m);
    for (const name of ["装小程序截图用的浏览器", "小程序截图"]) {
      expect(steps.get(name), name).toContain(
        "\n        if: steps.weapp-shots.outputs.run == 'true'\n",
      );
      expect(steps.get(name), name).not.toMatch(/\|\|/);
    }
    expect(steps.get("小程序截图")).toContain("\n        run: pnpm weapp:shots\n");
    const upload = steps.get("上传小程序截图");
    expect(upload).toContain("\n        if: always() && steps.weapp-shots.outputs.run == 'true'\n");
    expect(upload).toMatch(/uses: actions\/upload-artifact@[0-9a-f]{40} # v\d+\.\d+\.\d+/);
    expect(upload).toContain("apps/weapp/shots/dist/png/");
    expect(upload).toContain("if-no-files-found: error");
  });
});

describe("小程序体积门禁", () => {
  const KB = 1024;
  /** 造一份产物：subRoots 是分包，sizes 是各文件的字节数 */
  function check(subRoots: string[] | null, sizes: Record<string, number>) {
    const temp = makeTempDir("lyx-mp-size-");
    cleanups.push(temp.cleanup);
    const files: Record<string, string> = {};
    if (subRoots !== null) {
      files["app.json"] = JSON.stringify({ subPackages: subRoots.map((root) => ({ root })) });
    }
    for (const [path, bytes] of Object.entries(sizes)) files[path] = "x".repeat(bytes);
    writeFiles(temp.dir, files);
    return run(process.execPath, [MP_SIZE, temp.dir], repoRoot);
  }

  it("都在红线内：通过，并打印主包、各分包与合计的体积", () => {
    const result = check(["sub/catalog", "sub/order"], {
      "taro.js": 1400 * KB,
      "sub/catalog/a.js": 800 * KB,
      "sub/order/a.js": 10 * KB,
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/主包 {2}1400\.\d \/ 1500（93%）/);
    expect(result.stdout).toContain("sub/catalog  800.0 / 800（100%）");
    expect(result.stdout).toContain("sub/order  10.0 / 800（1%）");
    expect(result.stdout).toMatch(/合计 {2}2210\.\d/);
  });

  it("主包超限、分包超限各自失败并指出是谁；分包的体积不算进主包", () => {
    const main = check(["sub/catalog"], { "taro.js": 1501 * KB, "sub/catalog/a.js": 700 * KB });
    expect(main.status).toBe(1);
    expect(main.stderr).toMatch(/主包 1501\.\dKB，超过 1500KB/);
    expect(main.stderr).not.toContain("sub/catalog");

    const sub = check(["sub/catalog"], { "taro.js": 900 * KB, "sub/catalog/a.js": 801 * KB });
    expect(sub.status).toBe(1);
    expect(sub.stderr).toContain("sub/catalog 801.0KB，超过 800KB，多了 1.0KB");
    expect(sub.stderr).not.toContain("主包");
  });

  it("没有分包的产物只量主包；产物不对（没有 app.json、声明的分包目录不在、目录不在）是环境错误，不算通过", () => {
    expect(check([], { "taro.js": 300 * KB }).status).toBe(0);
    expect(check(null, { "taro.js": 300 * KB }).status).toBe(2);
    expect(check(["sub/ghost"], { "taro.js": 300 * KB }).status).toBe(2);
    expect(run(process.execPath, [MP_SIZE, "/no/such/dir"], repoRoot).status).toBe(2);
    expect(run(process.execPath, [MP_SIZE], repoRoot).status).toBe(2);
  });
});

describe("小程序截图的受影响范围", () => {
  /** 建一个有 main 与一条分支的临时仓库，分支上改 files，返回脚本对它的结论 */
  function decide(files: Record<string, string>, base = "main") {
    const repo = makeTempRepo("lyx-shots-affected-", { "README.md": "x\n" });
    cleanups.push(repo.cleanup);
    git(repo.dir, "commit", "-q", "-m", "base");
    git(repo.dir, "branch", "-M", "main");
    git(repo.dir, "checkout", "-q", "-b", "feat");
    writeFiles(repo.dir, files);
    git(repo.dir, "add", "-A");
    git(repo.dir, "commit", "-q", "-m", "change");
    return run(process.execPath, [AFFECTED, "--base", base], repo.dir);
  }

  it("改到小程序、设计变量与图标、锁文件或工作流：要跑；只改了别处：不用跑", () => {
    const hit = decide({
      "apps/weapp/src/pages.ts": "x\n",
      "packages/shared/src/design/generated/merchant.scss": "x\n",
      "design/tokens.json": "{}\n",
      "pnpm-lock.yaml": "x\n",
      ".github/workflows/ci.yml": "x\n",
    });
    expect(hit.status).toBe(0);
    expect(hit.output).toContain("小程序截图：要跑");
    for (const file of [
      "apps/weapp/src/pages.ts",
      "packages/shared/src/design/generated/merchant.scss",
      "design/tokens.json",
      "pnpm-lock.yaml",
      ".github/workflows/ci.yml",
    ]) {
      expect(hit.output, file).toContain(file);
    }

    const miss = decide({
      "packages/services/src/kernel/index.ts": "x\n",
      "apps/admin/src/main.tsx": "x\n",
      "packages/contract/src/index.ts": "x\n",
      "docs/08-development-plan.md": "x\n",
    });
    expect(miss.status).toBe(0);
    expect(miss.output).toContain("小程序截图：不用跑");
  });

  it("没有基线（推到 main）一律跑；基线找不到按要跑算；不给 --base 是用法错误", () => {
    expect(decide({ "docs/x.md": "x\n" }, "").output).toContain("小程序截图：要跑。不是 PR");
    const missing = decide({ "docs/x.md": "x\n" }, "origin/no-such-branch");
    expect(missing.status).toBe(0);
    expect(missing.output).toContain("按要跑算");
    expect(run(process.execPath, [AFFECTED], repoRoot).status).toBe(2);
  });
});
