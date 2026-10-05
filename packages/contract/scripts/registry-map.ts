/**
 * x01 条目归属表的生成脚本：由 packages/contract/src/registry 的登记数据生成 docs/plan/x01-map.md
 *（计划 第 5.7 节“x01 归属”行、第 8.4 节）。
 *
 * 用法（在仓库根目录）：
 *   pnpm registry:generate   重新生成，写进 docs/plan/x01-map.md
 *   pnpm registry:check      重新生成后 git diff --exit-code，再与 x01 对账（scripts/registry-check.ts）
 * 直接跑：tsx scripts/registry-map.ts [--out <文件>]，不给 --out 时写进 docs/plan/x01-map.md。
 *
 * 约定：
 *   - 归属表是生成物，只由本脚本写，不手改。改归属就改登记数据再重新生成，并在 docs/plan/changes/ 记一条。
 *   - 一项一行：类别、名称、所属模块、里程碑。有里程碑的是七类：订阅者、定时器（kind × 主体）、周期任务、
 *     进程内循环、队列通道、回调处理、命令行。出站事件不单列里程碑，只在末尾给数量。
 *   - 输出稳定：按里程碑、类别、名称排序；同一输入两次生成字节相同。
 */
import { realpathSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  EVENT_STATUSES,
  MILESTONES,
  REGISTRY,
  type Milestone,
  type RegistrySnapshot,
} from "../src/registry/index.js";

/** docs/plan/x01-map.md 的绝对路径 */
export const X01_MAP_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../docs/plan/x01-map.md",
);

/** 有里程碑的七类，顺序同计划 第 8.4 节的表 */
export const MAP_CATEGORIES = [
  "订阅者",
  "定时器",
  "周期任务",
  "循环",
  "队列",
  "回调",
  "命令行",
] as const;
export type MapCategory = (typeof MAP_CATEGORIES)[number];

export interface MapRow {
  readonly category: MapCategory;
  /** 名称一栏的 Markdown */
  readonly name: string;
  readonly module: string;
  readonly milestone: Milestone;
}

const code = (text: string) => `\`${text}\``;
const byCodePoint = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** 七类条目，一项一行，按里程碑、类别、名称排序 */
export function x01MapRows(registry: RegistrySnapshot = REGISTRY): MapRow[] {
  const rows: MapRow[] = [
    ...registry.subscribers.map((item) => ({
      category: "订阅者" as const,
      name: code(item.name),
      module: item.module,
      milestone: item.milestone,
    })),
    ...registry.timers.map((item) => ({
      category: "定时器" as const,
      name: `${code(item.kind)}（主体 ${code(item.subject)}）`,
      module: item.module,
      milestone: item.milestone,
    })),
    ...registry.jobs.map((item) => ({
      category: "周期任务" as const,
      name: code(item.kind),
      module: item.module,
      milestone: item.milestone,
    })),
    ...registry.loops.map((item) => ({
      category: "循环" as const,
      name: `${item.label}（${code(item.id)}）`,
      module: item.module,
      milestone: item.milestone,
    })),
    ...registry.queues.map((item) => ({
      category: "队列" as const,
      name: `${item.label}（${code(item.id)}）`,
      module: item.module,
      milestone: item.milestone,
    })),
    ...registry.callbacks.map((item) => ({
      category: "回调" as const,
      name: code(item.operationId),
      module: item.module,
      milestone: item.milestone,
    })),
    ...registry.commands.map((item) => ({
      category: "命令行" as const,
      name: `${code(item.label)}（${code(item.id)}）`,
      module: item.module,
      milestone: item.milestone,
    })),
  ];
  return rows.sort(
    (a, b) =>
      MILESTONES.indexOf(a.milestone) - MILESTONES.indexOf(b.milestone) ||
      MAP_CATEGORIES.indexOf(a.category) - MAP_CATEGORIES.indexOf(b.category) ||
      byCodePoint(a.name, b.name),
  );
}

/** 各里程碑各类的条目数：行是里程碑，列的顺序同 MAP_CATEGORIES */
export function milestoneMatrix(
  registry: RegistrySnapshot = REGISTRY,
): Record<Milestone, number[]> {
  const rows = x01MapRows(registry);
  return Object.fromEntries(
    MILESTONES.map((milestone) => [
      milestone,
      MAP_CATEGORIES.map(
        (category) =>
          rows.filter((row) => row.milestone === milestone && row.category === category).length,
      ),
    ]),
  ) as Record<Milestone, number[]>;
}

const tableRow = (cells: readonly (string | number)[]) => `| ${cells.join(" | ")} |`;
const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);

/** 归属表的全文 */
export function renderX01Map(registry: RegistrySnapshot = REGISTRY): string {
  const rows = x01MapRows(registry);
  const matrix = milestoneMatrix(registry);
  const totals = MAP_CATEGORIES.map((_, column) =>
    sum(MILESTONES.map((milestone) => matrix[milestone][column] ?? 0)),
  );
  const modules = [...new Set(registry.events.map((item) => item.module))].sort(byCodePoint);
  const eventCount = (module: string | null, status: string) =>
    registry.events.filter(
      (item) => (module === null || item.module === module) && item.status === status,
    ).length;

  const lines = [
    "# x01 条目归属表",
    "",
    "本文件是生成物：由 `pnpm registry:generate` 从 `packages/contract/src/registry/` 的登记数据生成，不手改。改归属就改登记数据并重新生成，同一个 PR 在 [changes/](changes/README.md) 记一条（[开发计划](../08-development-plan.md) 第 5.7 节“x01 归属”行）。`pnpm registry:check` 核对它与登记数据无差异，并拿登记数据与 x01 对账。",
    "",
    "“x01”指[事件目录与任务进程](../api/x01-events-jobs.md)。一项一行：类别、名称、所属模块、里程碑。“里程碑”是这个条目应有处理器与测试的那个里程碑，各里程碑退出时据此核对（计划 第 8.4 节；之后以本表为准，计划里的那张表不再手改）。循环、队列、命令行在 x01 里写的是叫法，括号里是代码用的标识符。出站事件不单列里程碑，随发出它的接口或任务落地，数量见第 3 节。",
    "",
    "## 1. 各里程碑的条目数",
    "",
    tableRow(["里程碑", ...MAP_CATEGORIES, "合计"]),
    tableRow(["---", ...MAP_CATEGORIES.map(() => "---"), "---"]),
    ...MILESTONES.map((milestone) =>
      tableRow([milestone, ...matrix[milestone], sum(matrix[milestone])]),
    ),
    tableRow(["合计", ...totals, sum(totals)]),
    "",
    "定时器按“kind × 主体”计行：同一个 kind 有几种主体就有几行（`sla.breach` 有 7 行）。",
    "",
    "## 2. 条目",
    "",
    tableRow(["类别", "名称", "所属模块", "里程碑"]),
    tableRow(["---", "---", "---", "---"]),
    ...rows.map((row) => tableRow([row.category, row.name, row.module, row.milestone])),
    "",
    "## 3. 出站事件的数量",
    "",
    "事件名、聚合与状态登记在同一份数据里（各模块文件的 `events`），这里只给数量。“不发”的名字占住、不挪作他用；“预留”的等对应的表与任务补上后才发。",
    "",
    tableRow(["发出模块", "V1.0 发出", "不发", "预留"]),
    tableRow(["---", "---", "---", "---"]),
    ...modules.map((module) =>
      tableRow([module, ...EVENT_STATUSES.map((status) => eventCount(module, status))]),
    ),
    tableRow(["合计", ...EVENT_STATUSES.map((status) => eventCount(null, status))]),
    "",
  ];
  return lines.join("\n");
}

function main(argv: readonly string[]): void {
  let out = X01_MAP_PATH;
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i + 1];
    if (argv[i] === "--out" && value) {
      out = resolve(value);
      i += 1;
    } else {
      console.error(`不认识的参数 ${argv[i]}。用法：tsx scripts/registry-map.ts [--out <文件>]`);
      process.exit(2);
    }
  }
  writeFileSync(out, renderX01Map());
  console.log(`x01 条目归属表已写入 ${out}（${x01MapRows().length} 行）`);
}

// 只在被直接执行时跑；被检查脚本与用例 import 时不跑。两边都取真实路径再比，免得符号链接下静默不执行
const entry = process.argv[1];
if (entry !== undefined && realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2));
}
