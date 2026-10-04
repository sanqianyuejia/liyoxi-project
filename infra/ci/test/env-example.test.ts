import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { makeTempDir, repoRoot, run, writeFiles } from "./helpers.js";

// .env.example 核对脚本的用例（W0-03 任务书 第 7 节第 4 条）。
// 形似真实配置的值在这里拼出来，不把它们作为字面量入库。

const script = join(repoRoot, "infra/ci/check-env-example.mjs");
const KEYS = "APP_ENV,DATABASE_URL,DATABASE_URL_FILE";
const GOOD = [
  "# 说明",
  "",
  "APP_ENV=<local|test|stg|prod>",
  "DATABASE_URL=postgresql://<用户>:<口令>@<主机>:<端口>/<库名>",
  "DATABASE_URL_FILE=<文件路径>",
  "",
].join("\n");

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

function check(content: string, keys = KEYS) {
  const temp = makeTempDir("lyx-envex-");
  cleanups.push(temp.cleanup);
  writeFiles(temp.dir, { "env.example": content });
  return run("node", [script, "--file", join(temp.dir, "env.example"), "--keys", keys], repoRoot);
}

describe("本仓库的 .env.example", () => {
  it("键集合等于 loadEnv 的键集合，值都是占位", () => {
    const result = run("node", [script], repoRoot);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("6 个键与 loadEnv 一致，值都是占位");
  });
});

describe("键集合", () => {
  it("一致：通过", () => {
    const result = check(GOOD);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("3 个键与 loadEnv 一致");
  });

  it("样例里少了一个键", () => {
    const result = check(GOOD.replace("DATABASE_URL_FILE=<文件路径>\n", ""));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("缺 DATABASE_URL_FILE：loadEnv 读它，样例里没有");
  });

  it("样例里多了一个键", () => {
    const result = check(`${GOOD}JWT_SECRET=<密钥>\n`);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("多了 JWT_SECRET：样例里有，loadEnv 不读它");
  });

  it("键重复", () => {
    const result = check(`${GOOD}APP_ENV=<环境>\n`);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("第 6 行：APP_ENV 重复");
  });

  it("不是 KEY=VALUE 的行", () => {
    const result = check(`${GOOD}export app_env local\n`);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("第 6 行：不是 KEY=VALUE 的写法");
  });
});

describe("值都是占位", () => {
  it.each([
    ["空值", "APP_ENV="],
    ["一个占位段", "APP_ENV=<环境>"],
    ["协议头加占位段", "APP_ENV=redis://<主机>:<端口>/<库号>"],
    ["带查询串的占位", "APP_ENV=postgresql://<用户>:<口令>@<主机>/<库名>?<参数>=<值>"],
  ])("%s：通过", (_label, line) => {
    expect(check(`${line}\n`, "APP_ENV").status).toBe(0);
  });

  const host = ["db", "internal"].join(".");
  const password = ["s3cr3t", "pass"].join("-");
  it.each([
    ["字面的取值", "APP_ENV=prod"],
    ["字面的主机与端口", `APP_ENV=redis://${host}:6379/0`],
    ["占位里夹着字面的口令", `APP_ENV=postgresql://<用户>:${password}@<主机>/<库名>`],
    ["字面的文件路径", "APP_ENV=/run/secrets/database_url"],
    ["只有协议头之外的字面量", "APP_ENV=changeme"],
  ])("%s：失败，报错不回显值", (_label, line) => {
    const result = check(`${line}\n`, "APP_ENV");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("第 1 行：APP_ENV 的值不是占位");
    expect(result.output).not.toContain(line.slice("APP_ENV=".length));
  });
});

describe("用法", () => {
  it("样例文件不存在：退出码 2", () => {
    const result = run(
      "node",
      [script, "--file", "/nonexistent/env.example", "--keys", "A"],
      repoRoot,
    );
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("读不了样例文件");
  });

  it("不认识的参数：退出码 2", () => {
    expect(run("node", [script, "--oops", "1"], repoRoot).status).toBe(2);
  });
});
