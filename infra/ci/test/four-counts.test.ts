import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { makeTempDir, repoRoot, run, writeFiles } from "./helpers.js";

// 四个计数的报表（W0-30）：已落地接口数、待落地数、留桩数、未实现页面数，另出 x01 归属的未落地清单；
// --require 的里程碑有一样没清零即非 0 退出。数都从仓库里现读，用例不写死。

const script = join(repoRoot, "infra/ci/four-counts.mjs");

interface Route {
  operationId: string;
  version: string;
  milestone?: string;
}
const routes = JSON.parse(
  readFileSync(join(repoRoot, "packages/contract/generated/routes.json"), "utf8"),
) as Route[];
/** 归某个里程碑的 V1.0 接口 */
const routesOf = (milestone: string): string[] =>
  routes
    .filter((route) => route.version === "V1.0" && route.milestone === milestone)
    .map((route) => route.operationId);

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

/** 在仓库外放几份输入，返回各自的路径 */
function inputs(files: Record<string, string>): (name: string) => string {
  const temp = makeTempDir("lyx-four-counts-");
  cleanups.push(temp.cleanup);
  writeFiles(temp.dir, files);
  return (name) => join(temp.dir, name);
}
/** 一份“M0 的接口都挂上了”的已挂载清单：全新检出里没有真的那一份（它由 apps/api 的用例写出，不入库） */
const mountedM0 = (): string[] => {
  const at = inputs({ "mounted.json": JSON.stringify(routesOf("M0")) });
  return ["--mounted", at("mounted.json")];
};
const counts = (args: string[]) => run("node", [script, ...args], repoRoot);

const stub = (status: string, milestone: string): string =>
  [
    "# 样例留桩",
    "",
    "| 项 | 内容 |",
    "| --- | --- |",
    `| 状态 | ${status} |`,
    "| 留桩内容 | 样例 |",
    "| 骨架里的做法 | 返回空 |",
    "| 登记的工作包 | W9-01 |",
    `| 回补里程碑 | ${milestone} |`,
    "| 回补的工作包 | 待拆包后填 |",
    "| 依据 | 计划 第 7.3 节 |",
    "",
  ].join("\n");

describe("四个计数的报表", () => {
  it("本仓库：M0 的接口挂上之后，留桩、页面、x01 条目四样都已清零", () => {
    const result = counts([...mountedM0(), "--require", "M0"]);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("M0 的四样都已清零。");
    for (const name of ["已落地接口数", "待落地数", "留桩数", "未实现页面数"]) {
      expect(result.stdout).toMatch(new RegExp(`\\| ${name} \\| \\d+`));
    }
    // 已落地数就是挂上的那几条（探活），与待落地数加起来是 V1.0 的总数
    const landed = Number(result.stdout.match(/\| 已落地接口数 \| (\d+)/)?.[1]);
    const pending = Number(result.stdout.match(/\| 待落地数 \| (\d+)/)?.[1]);
    expect(landed).toBe(routesOf("M0").length);
    expect(landed + pending).toBe(routes.filter((route) => route.version === "V1.0").length);
    expect(result.stdout).toMatch(/\| M0 \| 0 \| 0 \| 0 \| 0（共 \d+ 项） \|/);
  });

  it("没有已挂载清单：照样出报表并注明，M0 的接口按待落地算，--require M0 不过", () => {
    const at = inputs({});
    const report = counts(["--mounted", at("nope.json")]);
    expect(report.status).toBe(0);
    expect(report.stdout).toContain("还没生成");
    expect(report.stdout).toContain("| 已落地接口数 | 0（");
    const required = counts(["--mounted", at("nope.json"), "--require", "M0"]);
    expect(required.status).toBe(1);
    expect(required.stderr).toContain(`M0：还有 ${routesOf("M0").length} 条接口待落地`);
  });

  it("应在本里程碑回补的留桩没清零：点出是哪个文件；已回补的不算", () => {
    const at = inputs({
      "stubs/m0-ops-left.md": stub("留桩中", "M0"),
      "stubs/m0-ops-done.md": stub("已回补", "M0"),
      "stubs/m3-ops-later.md": stub("留桩中", "M3，G3-A"),
    });
    const result = counts([...mountedM0(), "--stubs", at("stubs"), "--require", "M0"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("M0：应在本里程碑回补的留桩还有 1 项：m0-ops-left.md");
    expect(result.stdout).toContain("| 留桩数 | 2（已回补 1） |");
    expect(result.stdout).toMatch(/\| M3 \| \d+ \| 1 \|/);
  });

  it("x01 条目没有处理器或测试：列出名字与缺什么；循环与队列取括号里的代码名", () => {
    const at = inputs({
      "x01.md": [
        "# x01 条目归属表",
        "",
        "## 2. 条目",
        "",
        "| 类别 | 名称 | 所属模块 | 里程碑 |",
        "| --- | --- | --- | --- |",
        "| 周期任务 | `ops.retention` | ops | M0 |",
        "| 循环 | 出站中继（`outbox_relay`） | events | M0 |",
        "| 订阅者 | `lyxnope.onNothing` | ops | M0 |",
        "| 队列 | 没有的队列（`lyxnope_queue`） | ops | M0 |",
        "| 定时器 | `lyxnope.later`（主体 `drama_order`） | order | M1 |",
        "",
      ].join("\n"),
    });
    const result = counts([...mountedM0(), "--x01", at("x01.md"), "--require", "M0"]);
    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/\| M0 \| 0 \| 0 \| 0 \| 2（共 4 项） \|/);
    expect(result.stdout).toContain("| M0 | 订阅者 | `lyxnope.onNothing` | ops | 处理器、测试 |");
    expect(result.stderr).toContain(
      "lyxnope.onNothing（缺处理器、测试）；lyxnope_queue（缺处理器、测试）",
    );
    // 没要求的里程碑只进表，不列明细；加 --detail 才列
    expect(result.stdout).not.toContain("lyxnope.later");
    expect(counts([...mountedM0(), "--x01", at("x01.md"), "--detail"]).stdout).toContain(
      "| M1 | 定时器 | `lyxnope.later`（主体 `drama_order`） | order | 处理器、测试 |",
    );
  });

  it("应在本里程碑实现的页面还有未实现的：不过", () => {
    const at = inputs({
      "pages.md": [
        "# 页面清单",
        "",
        "## 1. 汇总",
        "",
        "| 端 | 登记 | V1.0 应实现 | 已实现 | 未实现 | V1.1 只登记 | 入口隐藏 |",
        "| --- | --- | --- | --- | --- | --- | --- |",
        "| 运营管理后台 | 5 | 4 | 1 | 3 | 1 | 0 |",
        "| 商家端小程序 | 2 | 2 | 0 | 2 | 0 | 0 |",
        "",
        "应实现未实现页面数，按里程碑：",
        "",
        "| 端 | M0 | M1 |",
        "| --- | --- | --- |",
        "| 运营管理后台 | 1 | 2 |",
        "| 商家端小程序 | 0 | 2 |",
        "",
        "## 2. 运营管理后台",
        "",
      ].join("\n"),
    });
    const result = counts([...mountedM0(), "--pages", at("pages.md"), "--require", "M0"]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("| 未实现页面数 | 5 |");
    expect(result.stderr).toContain("M0：应在本里程碑实现的页面还有 1 页未实现");
  });

  it("输入读不了、认不出：按环境错误退出，不报成“已清零”", () => {
    const at = inputs({ "pages.md": "# 页面清单\n\n没有表。\n", "x01.md": "# 归属表\n" });
    for (const args of [
      ["--pages", at("pages.md"), "--require", "M0"],
      ["--x01", at("x01.md"), "--require", "M0"],
      ["--stubs", at("nope"), "--require", "M0"],
      ["--require", "m0"],
      ["--nope"],
    ]) {
      const result = counts(args);
      expect(result.status, args.join(" ")).toBe(2);
      expect(result.stderr).toContain("四个计数：");
    }
  });
});
