// W1-05 的门禁：文案约束（pnpm lint:copy）管到的错误码默认文案。
// 取规则表里第一条登记了错误码的规则与它的第一个码，在契约的副本里往这个码的默认文案开头加上规则的词：
// 检查必须失败，并指出是哪条规则、哪个错误码。改哪条规则、哪个码都是现取的，规则表加行不用改这个反例。
// 检查不再读契约的错误码定义、规则的 errors 一栏被拿掉时，这一例会红。
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { copyTree, ERRORS_DIR, readRuleTable, runCopyCheck } from "../lib/copy.mjs";

// gate、mutation、reason 要在加载时就定下来，所以规则表在这里读，不等到 run
const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const rule = readRuleTable({ repoRoot }).rules.find((item) => (item.errors ?? []).length > 0);
if (!rule) throw new Error("规则表里没有一条规则登记了错误码");
const symbol = rule.errors[0];

/** 这个码定义在哪个文件里；返回 [相对路径, 改过的内容]：默认文案（定义里第一个字符串）开头加上那个词 */
function mutated(ctx, symbol, word) {
  const dir = join(ctx.repoRoot, ERRORS_DIR);
  const definition = new RegExp(`(\\b${symbol}:[^"]*")`);
  for (const name of readdirSync(dir, { recursive: true })) {
    if (!name.endsWith(".ts") || name.endsWith(".test.ts")) continue;
    const text = readFileSync(join(dir, name), "utf8");
    if (definition.test(text))
      return [`${ERRORS_DIR}/${name}`, text.replace(definition, `$1${word}`)];
  }
  throw new Error(`在 ${ERRORS_DIR} 下找不到错误码 ${symbol} 的定义`);
}

export default {
  gate: "文案约束（lint:copy）",
  mutation: `错误码 ${symbol} 的默认文案开头加上“${rule.word}”`,
  reason: `规则 ${rule.id}：错误码 ${symbol} 的默认文案里出现“${rule.word}”`,
  run(ctx) {
    const [file, text] = mutated(ctx, symbol, rule.word);
    return runCopyCheck(ctx, copyTree(ctx, { [file]: text }));
  },
};
