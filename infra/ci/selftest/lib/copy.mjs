// 文案约束（pnpm lint:copy）的反例共用：在仓库外摆一棵树，照根脚本的原文跑检查，规则表用仓库里真的那一份。
import { cpSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const RULES_FILE = "infra/ci/copy-rules.json";
export const ERRORS_DIR = "packages/contract/src/errors";
const PAGES_FILE = "apps/weapp/src/pages.ts";
const ROOT_SCRIPT = "node infra/ci/check-copy.mjs";

/** 仓库里真的规则表 */
export function readRuleTable(ctx) {
  return JSON.parse(readFileSync(join(ctx.repoRoot, RULES_FILE), "utf8"));
}

/** 一棵临时的树：真的小程序页面清单与契约的错误码定义，外加给定的文件（后写，可以盖掉前两样） */
export function copyTree(ctx, files) {
  const dir = ctx.tempDir();
  cpSync(join(ctx.repoRoot, ERRORS_DIR), join(dir, ERRORS_DIR), { recursive: true });
  ctx.writeFiles(dir, { [PAGES_FILE]: readFileSync(join(ctx.repoRoot, PAGES_FILE), "utf8") });
  ctx.writeFiles(dir, files);
  return dir;
}

/** 对那棵树跑根脚本 lint:copy 指的检查；根脚本被换掉时抛错 */
export function runCopyCheck(ctx, dir) {
  const manifest = JSON.parse(readFileSync(join(ctx.repoRoot, "package.json"), "utf8"));
  const script = manifest.scripts?.["lint:copy"];
  if (script !== ROOT_SCRIPT) {
    throw new Error(`根脚本 lint:copy 不是 ${ROOT_SCRIPT}，现在是：${script}`);
  }
  return ctx.node(script.split(" ")[1], ["--root", dir]);
}
