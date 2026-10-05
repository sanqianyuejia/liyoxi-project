import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { makeTempDir, repoRoot, run, writeFiles } from "./helpers.js";

// 台账三张汇总的用例（W0-30）：由单项文件生成留桩、计划变更、外部验证三份汇总；汇总不入库，
// --check 只核对单项文件合不合规，不写文件。

const script = join(repoRoot, "infra/ci/plan-summaries.mjs");

const table = (title: string, rows: Record<string, string>): string =>
  [
    `# ${title}`,
    "",
    "| 项 | 内容 |",
    "| --- | --- |",
    ...Object.entries(rows).map(([key, value]) => `| ${key} | ${value} |`),
    "",
  ].join("\n");

const stub = (title: string, status: string, milestone: string): string =>
  table(title, {
    状态: status,
    留桩内容: "样例接口只出框架",
    骨架里的做法: "返回空",
    登记的工作包: "W9-01",
    回补里程碑: milestone,
    回补的工作包: "待拆包后填",
    依据: "计划 第 7.3 节",
  });
const change = (title: string): string =>
  table(title, { 改了什么: "样例", 原因: "样例", 影响的包: "W9-01", 类别: "拆并", PR: "—" });
const verification = (id: string, status: string): Record<string, string> => ({
  编号: id,
  来源: "计划 第 8.6 节",
  验证什么: `验 ${id}`,
  通过标准: "通过",
  依赖的业主事项: "无",
  谁来做: "W9-01",
  最晚关闭点: "M9 退出",
  不通过的退路: "—",
  状态: status,
  结论: "",
  证据: "",
  关闭日期: "",
});

const GOOD: Record<string, string> = {
  "docs/plan/stubs/README.md": "# 说明：不算单项文件\n",
  "docs/plan/stubs/m1-ops-a.md": stub("样例留桩甲", "留桩中", "M1，G1-A"),
  "docs/plan/stubs/m1-ops-b.md": stub("样例留桩乙", "已回补", "M1"),
  "docs/plan/stubs/m4-ops-c.md": stub("样例留桩丙", "留桩中", "M4"),
  "docs/plan/changes/README.md": "# 说明\n",
  "docs/plan/changes/W9-01-split.md": change("样例变更"),
  "docs/plan/external-verification/README.md": "# 说明\n",
  "docs/plan/external-verification/v01-one.md": table("V1 样例", verification("V1", "进行中")),
  // 一个文件两张表（V5 的写法）：各算一项
  "docs/plan/external-verification/v05-two.md": [
    table("V5 样例", verification("V5（扩展）", "未开始")),
    table("V5 样例", verification("V5（恢复）", "不做")).split("\n").slice(1).join("\n"),
  ].join("\n"),
};

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

function summarize(files: Record<string, string>, args: string[] = []) {
  const temp = makeTempDir("lyx-plan-summaries-");
  cleanups.push(temp.cleanup);
  writeFiles(temp.dir, files);
  const result = run("node", [script, "--root", temp.dir, ...args], repoRoot);
  const at = (ledger: string) => join(temp.dir, "docs/plan", ledger, "SUMMARY.md");
  return { ...result, at, read: (ledger: string) => readFileSync(at(ledger), "utf8") };
}

describe("台账三张汇总", () => {
  it("本仓库的单项文件都合规；三份汇总都被 git 忽略", () => {
    const result = run("node", [script, "--check"], repoRoot);
    expect(result.output).toContain("台账单项文件核对通过");
    expect(result.status).toBe(0);
    for (const ledger of ["stubs", "changes", "external-verification"]) {
      const ignored = run("git", ["check-ignore", `docs/plan/${ledger}/SUMMARY.md`], repoRoot);
      expect(ignored.status, `docs/plan/${ledger}/SUMMARY.md 应被 git 忽略`).toBe(0);
    }
  });

  it("由单项文件生成三份汇总：留桩数按“留桩中”数，一个文件两张表算两项；重跑结果不变", () => {
    const first = summarize(GOOD);
    expect(first.status).toBe(0);
    const stubs = first.read("stubs");
    expect(stubs).toContain("留桩数 2（状态为“留桩中”的文件数）；已回补 1。");
    expect(stubs).toContain("| M1 | 1 | 1 |");
    expect(stubs).toContain("| M4 | 1 | 0 |");
    expect(stubs).toContain("| [样例留桩甲](m1-ops-a.md) | 留桩中 | M1，G1-A |");
    expect(first.read("changes")).toContain("| [样例变更](W9-01-split.md) | 拆并 | — |");
    const external = first.read("external-verification");
    expect(external).toContain("共 3 项。");
    expect(external).toContain("| 1 | 1 | 0 | 0 | 1 |");
    expect(external).toContain("| [V5（恢复）](v05-two.md) | 验 V5（恢复） |");

    const again = run("node", [script, "--root", join(first.at("stubs"), "../../../..")], repoRoot);
    expect(again.status).toBe(0);
    expect(first.read("stubs")).toBe(stubs);
    expect(first.read("external-verification")).toBe(external);
  });

  it("--check 只核对，不写文件", () => {
    const result = summarize(GOOD, ["--check"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("留桩 3 条、计划变更 1 条、外部验证 3 条");
    expect(existsSync(result.at("stubs"))).toBe(false);
  });

  it.each([
    [
      "留桩的状态写成表外的值",
      { "docs/plan/stubs/m4-ops-c.md": stub("样例留桩丙", "已完成", "M4") },
      /docs\/plan\/stubs\/m4-ops-c\.md：状态“已完成”不在取值范围内，只能是 留桩中、已回补/,
    ],
    [
      "留桩的回补里程碑认不出里程碑号",
      { "docs/plan/stubs/m4-ops-c.md": stub("样例留桩丙", "留桩中", "以后再说") },
      /m4-ops-c\.md：回补里程碑“以后再说”要以里程碑号开头/,
    ],
    [
      "变更记录缺键",
      { "docs/plan/changes/W9-01-split.md": table("样例变更", { 改了什么: "样例", 原因: "样例" }) },
      /docs\/plan\/changes\/W9-01-split\.md：表里缺 影响的包、类别、PR/,
    ],
    [
      "外部验证的状态写成表外的值",
      {
        "docs/plan/external-verification/v01-one.md": table(
          "V1 样例",
          verification("V1", "已通过"),
        ),
      },
      /v01-one\.md：状态“已通过”不在取值范围内/,
    ],
    [
      "单项文件里没有键值表",
      { "docs/plan/changes/W9-01-split.md": "# 样例变更\n\n只有一句话。\n" },
      /W9-01-split\.md：没有找到带“改了什么”一行的/,
    ],
  ])("%s：非 0 退出并指出文件与项，带不带 --check 都一样", (_name, patch, message) => {
    for (const args of [[], ["--check"]]) {
      const result = summarize({ ...GOOD, ...patch }, args);
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(message);
      expect(existsSync(result.at("changes"))).toBe(false);
    }
  });
});
