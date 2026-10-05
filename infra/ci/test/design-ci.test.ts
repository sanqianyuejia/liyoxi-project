import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { git, makeTempRepo, repoRoot, run, writeFiles } from "./helpers.js";

// 设计地基（W0-26）接进 CI 与门禁文件清单的几样（任务书 第 4 节，第 7 节第 7、8、10 条）。
// 钉在这里：步骤被拿掉、预览页不再上传、清单里的条目被改，用例会红。
// 两项检查自己的口径在 colors.test.ts、design-generated.test.ts；反例在 selftest/cases/。

const read = (path: string) => readFileSync(join(repoRoot, path), "utf8");
const ci = read(".github/workflows/ci.yml");
const GENERATED = "packages/shared/src/design/generated";
const ALLOWLIST = "infra/ci/colors-allowlist.txt";
/** generated 口径在清单里写明的把关检查（infra/ci/gate-files.json 里这个条目的 check） */
const GUARD = "与源码一致由 `pnpm design:check` 把关";

/** verify 任务的全文：从它的键到下一个任务的键 */
function verifyJob(): string {
  const start = ci.indexOf("\n  verify:\n");
  expect(start).toBeGreaterThan(0);
  const next = ci.slice(start + 2).search(/^ {2}[\w-]+:$/m) + 1;
  expect(next).toBeGreaterThan(0);
  return ci.slice(start, start + 1 + next);
}

describe("CI：两步检查在必过任务 verify 里", () => {
  const verify = verifyJob();

  it("页面不写色值、设计生成物无差异各一步，跑的是根脚本", () => {
    expect(verify).toMatch(/^ {6}- name: 页面不写色值\n {8}run: pnpm lint:colors$/m);
    expect(verify).toMatch(/^ {6}- name: 设计生成物无差异\n {8}run: pnpm design:check$/m);
    const scripts = (JSON.parse(read("package.json")) as { scripts: Record<string, string> })
      .scripts;
    expect(scripts["lint:colors"]).toBe("node infra/ci/check-colors.mjs");
    expect(scripts["design:generate"]).toBe("pnpm --filter @liyoxi/shared run design:generate");
    expect(scripts["design:check"]).toMatch(/^pnpm design:generate && git diff --exit-code -- /);
  });

  it("verify 是 required 的依赖：这两步失败，必过检查就失败", () => {
    const required = ci.slice(ci.indexOf("\n  required:\n"));
    expect(required).toMatch(/^ {4}needs:\n(?: {6}- [\w-]+\n)*? {6}- verify$/m);
  });

  it("这两步与上传那一步都不带条件、不带免死牌", () => {
    const steps = verify.split(/^ {6}- name: /m);
    for (const name of ["页面不写色值", "设计生成物无差异", "上传设计预览页"]) {
      const step = steps.find((text) => text.startsWith(`${name}\n`));
      expect(step, name).toBeDefined();
      expect(step, name).not.toMatch(/^ {8}if:/m);
      expect(step, name).not.toMatch(/\|\|/);
    }
  });
});

describe("CI：预览页作为产物上传", () => {
  const verify = verifyJob();

  it("紧跟在 design:check 之后上传，目录里没有文件即失败", () => {
    expect(verify).toMatch(
      new RegExp(
        [
          "^ {8}run: pnpm design:check",
          "(?: {6}#.*\\n)*" + " {6}- name: 上传设计预览页",
          " {8}uses: actions/upload-artifact@[0-9a-f]{40} # v\\d+\\.\\d+\\.\\d+",
          " {8}with:",
          " {10}name: design-preview",
          " {10}path: packages/shared/dist/design-preview/",
          " {10}if-no-files-found: error",
        ].join("\n"),
        "m",
      ),
    );
  });

  it("上传的目录就是生成脚本写预览页的地方", () => {
    const generate = read("packages/shared/scripts/generate.ts");
    expect(generate).toContain('preview: join(packageDir, "dist/design-preview/index.html")');
    expect(generate).toContain('const packageDir = fileURLToPath(new URL("..", import.meta.url));');
  });
});

describe("门禁文件清单", () => {
  interface Entry {
    pattern: string;
    kind: string;
    except?: string[];
  }
  const entries = (JSON.parse(read("infra/ci/gate-files.json")) as { files: Entry[] }).files;
  const kindOf = (pattern: string) => entries.find((entry) => entry.pattern === pattern)?.kind;

  it("白名单按 frozen 登记，生成物目录按 generated 登记", () => {
    expect(kindOf(ALLOWLIST)).toBe("frozen");
    expect(kindOf(`${GENERATED}/**`)).toBe("generated");
  });

  it("两个检查脚本与四个反例已被原有条目按 new-file 盖住，不另登记", () => {
    expect(kindOf("infra/ci/*.mjs")).toBe("new-file");
    expect(kindOf("infra/ci/selftest/**")).toBe("new-file");
    for (const file of ["infra/ci/check-colors.mjs", "infra/ci/check-untracked.mjs"]) {
      expect(read(file).length, file).toBeGreaterThan(0);
    }
  });
});

describe("门禁改动分类：照清单判这两处的改动", () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    while (cleanups.length > 0) cleanups.pop()?.();
  });

  /** 临时仓库：基线里有清单、白名单与一个生成物；提交一次改动后让分类脚本判 */
  function classify(files: Record<string, string>) {
    const temp = makeTempRepo("lyx-design-gate-", {
      "infra/ci/gate-files.json": read("infra/ci/gate-files.json"),
      [ALLOWLIST]: read(ALLOWLIST),
      [`${GENERATED}/merchant.scss`]: "// 生成物，勿手改\n$lyx-radius-card: 14px;\n",
    });
    cleanups.push(temp.cleanup);
    git(temp.dir, "commit", "-q", "-m", "base");
    git(temp.dir, "branch", "base");
    writeFiles(temp.dir, files);
    git(temp.dir, "add", "-A");
    git(temp.dir, "commit", "-q", "-m", "change");
    return run(
      "node",
      [join(repoRoot, "infra/ci/classify-gate-changes.mjs"), "--base", "base"],
      temp.dir,
    );
  }

  it("往白名单里加一行：放松，没有 gate-change 标签即失败", () => {
    const result = classify({
      [ALLOWLIST]: `${read(ALLOWLIST)}apps/weapp/src/components/cover/index.scss\n`,
    });
    expect(result.status).toBe(1);
    expect(result.output).toContain(`\`${ALLOWLIST}\`：改了页面色值检查的白名单`);
    expect(result.output).toContain("没有 gate-change 标签");
  });

  it("生成物目录里新增文件、已有文件里加行：只增，列进清单给业主看", () => {
    const result = classify({
      [`${GENERATED}/admin.scss`]: "// 生成物，勿手改\n$lyx-radius-card: 8px;\n",
      [`${GENERATED}/merchant.scss`]:
        "// 生成物，勿手改\n$lyx-radius-card: 14px;\n$lyx-radius-card-lg: 16px;\n",
    });
    expect(result.status).toBe(0);
    expect(result.output).toContain("判定：只增");
    expect(result.output).toContain(`\`${GENERATED}/admin.scss\`：新增生成物（${GUARD}）`);
    expect(result.output).toContain(
      `\`${GENERATED}/merchant.scss\`：重新生成的生成物，内容有变：加 1 行、删 0 行（${GUARD}）`,
    );
  });

  // 口径已补上（单独的 gate-change PR，业主 2026-10-05 同意）：生成物目录按 generated 登记，
  // 重新生成一律算只增并列出（计划 第 5.3 节），与来源一致由 design:check 把关。
  // 此前按 append 登记，这一条钉的是“已有的行变了判成放松”（docs/plan/status/W0-26.md 偏差 17）。
  it("生成物里已有的行变了（改一个已有变量的取值后重新生成）：只增，列进清单给业主看", () => {
    const result = classify({
      [`${GENERATED}/merchant.scss`]: "// 生成物，勿手改\n$lyx-radius-card: 12px;\n",
    });
    expect(result.status).toBe(0);
    expect(result.output).toContain("判定：只增");
    expect(result.output).toContain(
      `\`${GENERATED}/merchant.scss\`：重新生成的生成物，内容有变：加 1 行、删 1 行（${GUARD}）`,
    );
  });
});
