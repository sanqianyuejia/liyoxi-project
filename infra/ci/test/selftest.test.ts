import { readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { makeTempDir, repoRoot, run, writeFiles } from "./helpers.js";

// gates:selftest 框架自己的用例（W0-03 任务书 第 7 节第 7 条）：
// 反例没让检查失败、或失败原因对不上时，框架必须红。反例目录换成临时目录，里面放假的反例。

const runner = join(repoRoot, "infra/ci/selftest/run.mjs");
const casesDir = join(repoRoot, "infra/ci/selftest/cases");

const caseFile = (body: string) =>
  `export default {\n  gate: "示例门禁",\n  mutation: "示例变异",\n${body}\n};\n`;
/** 一个“检查”：按给定的退出码退出，并在标准错误里写一句话 */
const check = (status: number, message: string) =>
  `  run(ctx) {\n    return ctx.run("node", ["-e", ${JSON.stringify(
    `console.error(${JSON.stringify(message)}); process.exit(${status})`,
  )}]);\n  },`;

const GOOD = caseFile(`  reason: /规则 A 被违反/,\n${check(1, "规则 A 被违反")}`);
const NOT_FAILING = caseFile(`  reason: /规则 A 被违反/,\n${check(0, "一切正常")}`);
const WRONG_REASON = caseFile(`  reason: "规则 A 被违反",\n${check(1, "找不到配置文件")}`);

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

function selftest(files: Record<string, string>, args: string[] = []) {
  const temp = makeTempDir("lyx-selftest-cases-");
  cleanups.push(temp.cleanup);
  writeFiles(temp.dir, files);
  return run("node", [runner, "--cases", temp.dir, ...args], repoRoot);
}

describe("框架", () => {
  it("反例让检查失败且原因对得上：通过，逐例报告", () => {
    const result = selftest({ "a.mjs": GOOD, "b.mjs": GOOD });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("✓ a.mjs（示例门禁）：示例变异 → 检查失败，且失败原因对得上");
    expect(result.stdout).toContain("门禁自测通过：2 个反例");
  });

  it("反例没让检查失败：退出码非 0", () => {
    const result = selftest({ "a.mjs": GOOD, "b.mjs": NOT_FAILING });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("✗ b.mjs：检查没有失败（退出码 0）");
    expect(result.stderr).toContain("2 个反例里有 1 个没过");
    expect(result.stdout).toContain("✓ a.mjs");
  });

  it("检查失败了但原因对不上：退出码非 0", () => {
    const result = selftest({ "a.mjs": WRONG_REASON });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("✗ a.mjs：检查失败了，但失败原因对不上");
    expect(result.stderr).toContain("找不到配置文件");
  });

  it("一个反例都没有：退出码非 0", () => {
    const result = selftest({ "README.md": "不是反例\n" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("一个反例都没有");
  });

  it.each([
    ["缺 reason", caseFile(check(1, "x"))],
    ["缺 run", caseFile('  reason: "x",')],
    ["没有 default 导出", "export const nothing = 1;\n"],
    [
      "run 返回的不是 { status, output }",
      caseFile('  reason: "x",\n  run() {\n    return 1;\n  },'),
    ],
  ])("反例文件写错（%s）：退出码非 0", (_label, content) => {
    const result = selftest({ "a.mjs": content });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("✗ a.mjs：反例文件写错");
  });

  it("反例造不出来（run 抛错）：退出码非 0", () => {
    const body = '  reason: "x",\n  run() {\n    throw new Error("夹具不见了");\n  },';
    const result = selftest({ "a.mjs": caseFile(body) });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("✗ a.mjs：反例没造出来：夹具不见了");
  });

  it("检查命令不存在：不算检查失败，退出码非 0（哪怕输出碰巧对得上 reason）", () => {
    const body =
      '  reason: "命令没跑起来",\n  run(ctx) {\n    return ctx.run("lyx-no-such-command", []);\n  },';
    const result = selftest({ "a.mjs": caseFile(body) });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("✗ a.mjs：检查没跑完，不算检查失败");
  });

  it("ctx 的助手可用：临时目录、写文件、git 仓库", () => {
    const body = [
      '  reason: "有 2 个已暂存的文件",',
      "  run(ctx) {",
      '    const dir = ctx.gitRepo({ "a.txt": "a\\n", "b/c.txt": "c\\n" });',
      '    const staged = ctx.git(dir, "diff", "--cached", "--name-only").output.trim().split("\\n");',
      "    return { status: 1, output: `有 ${staged.length} 个已暂存的文件` };",
      "  },",
    ].join("\n");
    expect(selftest({ "a.mjs": caseFile(body) }).status).toBe(0);
  });

  it("--only 只跑文件名对得上的反例", () => {
    const result = selftest({ "keep.mjs": GOOD, "other.mjs": NOT_FAILING }, ["--only", "keep"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("门禁自测通过：1 个反例");
  });
});

describe("仓库里的反例", () => {
  const files = readdirSync(casesDir).filter((name) => name.endsWith(".mjs"));

  it("第一批反例都在（W0-03 任务书 第 7 节）", () => {
    for (const expected of [
      "rename-old-name.mjs",
      "lint-axios.mjs",
      "layers-cross-layer.mjs",
      "layers-circular.mjs",
      "layers-fe-imports-db.mjs",
      "layers-unregistered-module.mjs",
      "gate-classify-delete-lint-rule.mjs",
      "secret-scan-fake-key.mjs",
    ]) {
      expect(files).toContain(expected);
    }
  });

  it("复审后补的反例都在：密钥扫描的几种漏法、遮蔽 lint 配置、类型检查的严格度、required 汇总", () => {
    for (const expected of [
      "secret-scan-history.mjs",
      "secret-scan-broken-history.mjs",
      "secret-scan-inline-allow.mjs",
      "secret-scan-merge-commit.mjs",
      "gate-classify-shadow-eslint-config.mjs",
      "typecheck-strict-presets.mjs",
      "ci-required-verify-failed.mjs",
      "ci-required-verify-skipped.mjs",
    ]) {
      expect(files).toContain(expected);
    }
  });

  it("独立检验后补的反例都在：.gitattributes 挡住密钥扫描、.gitignore 挡住格式检查、分类的两种绕法", () => {
    for (const expected of [
      "secret-scan-gitattributes-binary.mjs",
      "format-check-gitignore.mjs",
      "gate-classify-stale-copy-registry.mjs",
      "gate-classify-lockfile-decoy.mjs",
    ]) {
      expect(files).toContain(expected);
    }
  });

  it.each(files)("%s 的写法合规：有 gate、mutation、reason、run", async (name) => {
    const definition = (
      (await import(pathToFileURL(join(casesDir, name)).href)) as {
        default: { gate: unknown; mutation: unknown; reason: unknown; run: unknown };
      }
    ).default;
    expect(typeof definition.gate).toBe("string");
    expect(typeof definition.mutation).toBe("string");
    expect(definition.reason instanceof RegExp || typeof definition.reason === "string").toBe(true);
    expect(typeof definition.run).toBe("function");
  });
});
