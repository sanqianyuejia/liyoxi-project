import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { makeTempDir, repoRoot, run, writeFiles } from "./helpers.js";

// 状态汇总脚本的用例（W0-03 任务书 第 7 节第 11 条；docs/plan/status/README.md 第 5 节）。

const script = join(repoRoot, "infra/ci/status-summary.mjs");

interface Fields {
  name?: string;
  milestone?: string;
  status?: string;
  pr?: string;
  deps?: string;
}

function statusFile(id: string, fields: Fields = {}): string {
  return [
    `# ${id} ${fields.name ?? `${id} 的名称`}`,
    "",
    "| 项 | 内容 |",
    "| --- | --- |",
    `| 编号 | ${id} |`,
    `| 里程碑 | ${fields.milestone ?? "M0"} |`,
    `| 状态 | ${fields.status ?? "未开工"} |`,
    `| PR | ${fields.pr ?? "—"} |`,
    `| 依赖 | ${fields.deps ?? "—"} |`,
    "| 评审级别 | 乙 |",
    "| 规模 | M |",
    "| 阻塞原因 | 无 |",
    "| 结构变更包 | 否 |",
    `| 任务书 | \`docs/plan/tasks/${id}.md\` |`,
    "",
    "## 偏差",
    "",
    "无",
    "",
  ].join("\n");
}

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

function summarize(files: Record<string, string>, args: string[] = []) {
  const temp = makeTempDir("lyx-status-");
  cleanups.push(temp.cleanup);
  writeFiles(temp.dir, { "README.md": "# 说明：不算状态文件\n", ...files });
  const result = run("node", [script, "--dir", temp.dir, ...args], repoRoot);
  const read = () => readFileSync(join(temp.dir, "SUMMARY.md"), "utf8");
  return { ...result, dir: temp.dir, read };
}

/** 汇总里“可开工的包”一节列出的编号 */
function readyIds(summary: string): string[] {
  const section = summary.split("## 2. 可开工的包")[1]?.split("## 3.")[0] ?? "";
  return [...section.matchAll(/^\| \[([^\]]+)\]/gm)].map((match) => match[1] ?? "");
}

describe("本仓库", () => {
  it("SUMMARY.md 与各包的状态文件一致（改了状态文件要重新跑 pnpm status:summary）", () => {
    const result = run("node", [script, "--check"], repoRoot);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });
});

describe("生成", () => {
  const files = {
    "W0-01.md": statusFile("W0-01", { status: "完成", pr: "#6" }),
    "W0-02.md": statusFile("W0-02", { status: "完成", deps: "W0-01；Q4" }),
    "W0-03.md": statusFile("W0-03", { status: "进行中", deps: "W0-02" }),
    "W0-05.md": statusFile("W0-05", { deps: "W0-03；Q2" }),
    "W0-05b.md": statusFile("W0-05b", { deps: "W0-05" }),
    "W0-08.md": statusFile("W0-08", { deps: "W0-02", name: "`packages/contract` 骨架" }),
    "W0-10.md": statusFile("W0-10", { status: "阻塞", deps: "W0-02" }),
    "W1-01a.md": statusFile("W1-01a", {
      milestone: "M1",
      deps: "M0 退出（里程碑，计划 第 6.3 节；W0-01–W0-31 共 37 个包全部合并）",
    }),
    "X-01.md": statusFile("X-01", {
      milestone: "技术验证泳道",
      deps: "W0-02；E2、E4、E7；一个可带真实密钥的运行环境（业主本机或预发）",
    }),
    "X-03.md": statusFile("X-03", { milestone: "技术验证泳道", deps: "W0-08" }),
  };

  it("列出各包状态，按里程碑分组、按编号排序", () => {
    const result = summarize(files);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    const summary = result.read();
    expect(summary).toContain("| M0 | 7 | 3 | 1 | 1 | 2 |");
    expect(summary).toContain("| 合计 | 10 | 6 | 1 | 1 | 2 |");
    expect(summary).toContain("| [W0-01](W0-01.md) | W0-01 的名称 | 完成 | #6 | — | 乙 | M | 无 |");
    const order = [...summary.split("## 3. 各包状态")[1]!.matchAll(/^\| \[([^\]]+)\]/gm)].map(
      (match) => match[1],
    );
    expect(order).toEqual([
      "W0-01",
      "W0-02",
      "W0-03",
      "W0-05",
      "W0-05b",
      "W0-08",
      "W0-10",
      "W1-01a",
      "X-01",
      "X-03",
    ]);
  });

  it("可开工 = 未开工且依赖的包都已完成；Q、E 项与文字条件列在“另需核对”", () => {
    const summary = summarize(files).read();
    // W0-05 等 W0-03（进行中）；W0-05b 等 W0-05；W0-10 是阻塞；X-03 等 W0-08；W1-01a 等 M0 退出
    expect(readyIds(summary)).toEqual(["W0-08", "X-01"]);
    expect(summary).toContain("| E2、E4、E7；一个可带真实密钥的运行环境 |");
    expect(rowOf(summary, "W0-08")).toContain("`packages/contract` 骨架");
  });

  it("“M0 退出”要 M0 的包全部完成", () => {
    const allDone = Object.fromEntries(
      Object.entries(files).map(([name, text]) => [
        name,
        name.startsWith("W0-") ? text.replace(/\| 状态 \| \S+ \|/, "| 状态 | 完成 |") : text,
      ]),
    );
    expect(readyIds(summarize(allDone).read())).toEqual(["W1-01a", "X-01", "X-03"]);
  });

  it("同样的输入生成同样的文件；--check 通过", () => {
    const first = summarize(files);
    const before = first.read();
    expect(run("node", [script, "--dir", first.dir], repoRoot).status).toBe(0);
    expect(first.read()).toBe(before);
    const check = run("node", [script, "--dir", first.dir, "--check"], repoRoot);
    expect(check.status).toBe(0);
    expect(check.stdout).toContain("与 10 个状态文件一致");
  });

  it("没有可开工的包时照实写", () => {
    const summary = summarize({ "W0-01.md": statusFile("W0-01", { status: "完成" }) }).read();
    expect(summary).toContain("现在没有可开工的包。");
  });
});

function rowOf(summary: string, id: string): string {
  return summary.split("\n").find((line) => line.startsWith(`| [${id}]`)) ?? "";
}

describe("状态文件有问题即报错", () => {
  it.each(["待评审", "已合并", "done", ""])("状态取值“%s”不在范围内", (status) => {
    const outcome = summarize({ "W0-01.md": statusFile("W0-01", { status }) });
    expect(outcome.status).toBe(1);
    expect(outcome.stderr).toContain("W0-01.md：");
    expect(outcome.stderr).toMatch(/不在取值范围内|字段表缺/);
  });

  it("依赖里的包没有状态文件", () => {
    const outcome = summarize({ "W0-02.md": statusFile("W0-02", { deps: "W0-01" }) });
    expect(outcome.status).toBe(1);
    expect(outcome.stderr).toContain("W0-02.md：依赖里的 W0-01 没有状态文件");
  });

  it("编号与文件名不一致", () => {
    const outcome = summarize({ "W0-09.md": statusFile("W0-01") });
    expect(outcome.status).toBe(1);
    expect(outcome.stderr).toContain("W0-09.md：标题、“编号”一行与文件名里的编号不一致");
  });

  it("字段表缺键", () => {
    const text = statusFile("W0-01").replace(/^\| 依赖 .*\n/m, "");
    const outcome = summarize({ "W0-01.md": text });
    expect(outcome.status).toBe(1);
    expect(outcome.stderr).toContain("W0-01.md：字段表缺 依赖");
  });
});

describe("--check：汇总与状态文件不一致即失败", () => {
  it("改了状态文件没重新生成", () => {
    const first = summarize({ "W0-01.md": statusFile("W0-01") });
    writeFileSync(join(first.dir, "W0-01.md"), statusFile("W0-01", { status: "完成" }));
    const check = run("node", [script, "--dir", first.dir, "--check"], repoRoot);
    expect(check.status).toBe(1);
    expect(check.stderr).toContain("SUMMARY.md 与状态文件不一致");
  });

  it("手改了汇总", () => {
    const first = summarize({ "W0-01.md": statusFile("W0-01") });
    writeFileSync(join(first.dir, "SUMMARY.md"), first.read().replace("未开工", "完成"));
    expect(run("node", [script, "--dir", first.dir, "--check"], repoRoot).status).toBe(1);
  });

  it("还没有汇总文件", () => {
    const outcome = summarize({ "W0-01.md": statusFile("W0-01") }, ["--check"]);
    expect(outcome.status).toBe(1);
  });
});
