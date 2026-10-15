import { cpSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { makeTempDir, repoRoot, run } from "./helpers.js";

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});
const script = join(repoRoot, "infra/ci/check-stubs.mjs");
function fixture() {
  const { dir, cleanup } = makeTempDir("lyx-m1-stubs-");
  cleanups.push(cleanup);
  cpSync(join(repoRoot, "docs/plan/stubs"), join(dir, "stubs"), { recursive: true });
  cpSync(join(repoRoot, "docs/08-development-plan.md"), join(dir, "plan.md"));
  cpSync(join(repoRoot, "docs/plan/pages.md"), join(dir, "pages.md"));
  return {
    dir,
    check: () =>
      run(
        process.execPath,
        [
          script,
          "--plan",
          join(dir, "plan.md"),
          "--stubs",
          join(dir, "stubs"),
          "--pages",
          join(dir, "pages.md"),
        ],
        repoRoot,
      ),
  };
}
function replace(path: string, before: string, after: string) {
  const text = readFileSync(path, "utf8");
  expect(text).toContain(before);
  writeFileSync(path, text.replace(before, after));
}

describe("计划逐行留桩与未来页面", () => {
  it("真实登记通过，两个员工部分桩已随 M2 回补", () => {
    const { dir, check } = fixture();
    expect(check().status).toBe(0);
    for (const name of ["m2-staff-activation-sms.md", "m2-staff-assignment-pool.md"])
      expect(readFileSync(join(dir, "stubs", name), "utf8")).toContain("| 状态 | 已回补 |");
  });
  it("删除已回补文件也拒绝，不能因当前计数为零丢掉登记", () => {
    const { dir, check } = fixture();
    rmSync(join(dir, "stubs/m1-content-order-counts.md"));
    const result = check();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("缺少登记文件：m1-content-order-counts.md");
  });
  it("改变计划回补点而没同步映射拒绝", () => {
    const { dir, check } = fixture();
    replace(
      join(dir, "plan.md"),
      "| 微信登录、手机号组件、短信 | wechat 替身 | M2 |",
      "| 微信登录、手机号组件、短信 | wechat 替身 | M3 |",
    );
    expect(check().stderr).toContain("计划留桩行映射未同步：微信登录、手机号组件、短信");
    expect(check().status).toBe(1);
  });
  it("一个 M1 留桩退回未回补立即失败", () => {
    const { dir, check } = fixture();
    replace(join(dir, "stubs/m1-order-start.md"), "| 状态 | 已回补 |", "| 状态 | 留桩中 |");
    const result = check();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("m1-order-start.md：M1 留桩尚未回补");
  });
  it("缺键与未知里程碑拒绝", () => {
    const { dir, check } = fixture();
    const path = join(dir, "stubs/m2-staff-activation-sms.md");
    writeFileSync(
      path,
      readFileSync(path, "utf8")
        .split("\n")
        .filter((line) => !line.startsWith("| 依据 |"))
        .join("\n"),
    );
    replace(path, "| 回补里程碑 | M2（", "| 回补里程碑 | M99（");
    const result = check();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("表里缺 依据");
    expect(result.stderr).toContain("回补里程碑不合法");
  });
  it("删除映射的未来审批页面拒绝", () => {
    const { dir, check } = fixture();
    const path = join(dir, "pages.md");
    writeFileSync(
      path,
      readFileSync(path, "utf8")
        .split("\n")
        .filter((line) => !line.includes("`/approvals`"))
        .join("\n"),
    );
    const result = check();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("未来页面登记缺失或回补说明不符：/approvals");
  });
  it("登记页面仍在但删掉 M4/M5 未来回补说明也拒绝", () => {
    const { dir, check } = fixture();
    replace(join(dir, "pages.md"), "M4、M5 各补一段", "审批全部完成");
    const result = check();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("未来页面登记缺失或回补说明不符：/approvals");
  });
  it("功能文件改为其他合法里程碑也不能避开 M1 清零", () => {
    const { dir, check } = fixture();
    replace(join(dir, "stubs/m1-order-start.md"), "| 回补里程碑 | M1 |", "| 回补里程碑 | M2 |");
    const result = check();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("回补点与精确映射不一致，应为 M1");
  });
});
