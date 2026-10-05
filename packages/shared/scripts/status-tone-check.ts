/**
 * 状态字典键与契约枚举同名（任务书 W0-30a 第 7 节第 3、4 条；计划 第 7.2 节 W0-30 一行；W0-26 任务书 第 11 节第 5 项）：
 * 状态色调字典（src/design/status-tone）里写了“表.列”的条目，取值都得是契约里那一列枚举的取值。一处不符即非 0 退出。
 * 页面拿库里的状态值去字典里找颜色：字典里的取值写错、或契约改了名而字典没跟，页面就找不到颜色，这里先拦下。
 *
 * 用法（在仓库根目录）：pnpm status-tone:check。直接跑：tsx scripts/status-tone-check.ts，不带参数。只读，不连库。
 *
 * 核对两样：
 *   1. 条目的“表.列”在契约里绑定了枚举（@liyoxi/contract/enums 的 enumByColumn）。
 *   2. 条目的每个取值都在那个枚举的取值之内。
 * 不核对：
 *   - 没写“表.列”的条目（“无枚举对应”：由多列推导的展示状态、分类标签）：只数出来。
 *   - 库里确有这一列、契约还没有绑定枚举的条目（库里的取值写在组合条件的 CHECK 里，枚举对账认不了）：
 *     条目的说明要以“契约未绑定枚举：”开头并写明出处，这里只列出。没写这句的照第 1 条报差异（多半是列名写错了）；
 *     写了这句而契约里已经有了枚举的也报差异：把这句去掉，改由第 2 条核对。
 *   - 枚举里字典没有收的取值：字典只收页面上要显示颜色的状态，不要求铺满；只数出来。
 *   - 中文的状态名与色调：那是与规范 第 6.2 节的对账，在 src/design/status-tone/status-tone.test.ts。
 *
 * 本脚本不写死数量：有几个业务对象、几个条目，都从字典与契约现取。
 * 退出码：0 通过；1 有差异；2 环境错误（字典或契约加载不了）。
 */
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { enumByColumn } from "@liyoxi/contract/enums";
import type { EnumDef } from "@liyoxi/contract/enums";

import {
  STATUS_TONE_GROUPS,
  UNBOUND_ENUM_NOTE,
  type StatusToneGroup,
} from "../src/design/status-tone/index.js";

export interface StatusToneCheckResult {
  /** 差异，一条一句；空即通过 */
  problems: string[];
  /** 核对了的条目数（写了“表.列”的） */
  checked: number;
  /** 没写“表.列”、不核对的条目数 */
  derived: number;
  /** 核对到的“表.列” */
  columns: string[];
  /** 契约还没有绑定枚举、条目里写明了的“表.列”：只列出 */
  unbound: string[];
  /** 这些列的枚举里字典没有收的取值，写成“表.列=取值”：不算差异 */
  uncovered: string[];
}

/** 按“表.列”找契约枚举的办法；用例里可以换一个 */
export type EnumLookup = (column: string) => Pick<EnumDef, "name" | "values"> | undefined;

export function checkStatusTone(
  groups: readonly StatusToneGroup[] = STATUS_TONE_GROUPS,
  lookup: EnumLookup = enumByColumn,
): StatusToneCheckResult {
  const problems: string[] = [];
  const used = new Map<string, Set<string>>();
  const unbound = new Set<string>();
  let checked = 0;
  let derived = 0;
  for (const group of groups) {
    for (const entry of group.entries) {
      if (entry.column === null) {
        derived += 1;
        continue;
      }
      const title = `${group.object} · ${entry.state}（${group.key}）`;
      const def = lookup(entry.column);
      const declaredUnbound = entry.note?.startsWith(UNBOUND_ENUM_NOTE) === true;
      if (def === undefined) {
        if (declaredUnbound) unbound.add(entry.column);
        else
          problems.push(
            `${title}：${entry.column} 在契约里没有绑定枚举（列名写错了就改列名；库里确有这一列而契约还没有枚举的，说明以“${UNBOUND_ENUM_NOTE}”开头并写明出处）`,
          );
        continue;
      }
      if (declaredUnbound) {
        problems.push(
          `${title}：说明里写着“${UNBOUND_ENUM_NOTE}”，而契约里已经有枚举 ${def.name} 绑定了 ${entry.column}：把这句去掉`,
        );
      }
      checked += 1;
      const seen = used.get(entry.column) ?? new Set<string>();
      used.set(entry.column, seen);
      const allowed: readonly string[] = def.values;
      for (const value of entry.values) {
        seen.add(value);
        if (!allowed.includes(value)) {
          problems.push(
            `${title}：取值 '${value}' 不在契约枚举 ${def.name}（${entry.column}）的取值之内`,
          );
        }
      }
    }
  }
  const columns = [...used.keys()].sort();
  const uncovered = columns.flatMap((column) =>
    (lookup(column)?.values ?? [])
      .filter((value) => !used.get(column)?.has(value))
      .map((value) => `${column}=${value}`),
  );
  return { problems, checked, derived, columns, unbound: [...unbound].sort(), uncovered };
}

function main(): void {
  let result: StatusToneCheckResult;
  try {
    result = checkStatusTone();
  } catch (error) {
    console.error(
      `状态字典键与契约枚举同名：没跑成。${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(2);
  }
  console.log(
    [
      "状态字典键与契约枚举同名（packages/shared/src/design/status-tone ↔ packages/contract/src/enums）",
      `  业务对象 ${STATUS_TONE_GROUPS.length} 个；核对了 ${result.checked} 个条目，涉及 ${result.columns.length} 列；没写“表.列”的 ${result.derived} 条（无枚举对应，不查）`,
      `  契约还没有绑定枚举的列 ${result.unbound.length}${result.unbound.length > 0 ? `：${result.unbound.join("、")}` : ""}（条目里写明了，只列出）`,
      `  核对到的列的枚举里字典没有收的取值 ${result.uncovered.length} 个（不算差异）`,
    ].join("\n"),
  );
  if (result.problems.length > 0) {
    console.error(`\n状态字典键与契约枚举同名未通过：差异 ${result.problems.length}`);
    for (const problem of result.problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
  console.log("\n状态字典键与契约枚举同名通过：差异 0");
}

// 只在被直接执行时跑；被用例 import 时不跑
const entryPath = process.argv[1];
if (
  entryPath !== undefined &&
  realpathSync(entryPath) === realpathSync(fileURLToPath(import.meta.url))
) {
  main();
}
