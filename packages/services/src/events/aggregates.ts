// 聚合类型自检（W0-15）：契约登记的聚合类型都是库里存在的表名（01 分组 第 2 节通用说明、第 3.4 节）。
// 库里对 outbox_event.aggregate_type 只校验写法，清单在契约：登记写错表名，要到这里才查得出。
// 这里只给函数；接到进程启动由 W0-22、W0-23（docs/plan/tasks/README.md 第 5 节移交表第 1 行）。
import { EVENTS } from "@liyoxi/contract/registry";

import { selectExistingTables } from "./repo.js";
import type { RawReader } from "./repo.js";

/** 会写进库的聚合类型：状态为“发出”的事件登记的聚合。预留事件的表可以还没建（如 billing_month_close） */
export function emittedAggregateTypes(): string[] {
  const types = EVENTS.filter((event) => event.status === "v1").flatMap((event) => [
    ...event.aggregates,
  ]);
  return [...new Set<string>(types)].sort();
}

/** types 里库里没有对应表的那些；空数组即都在。不给 types 即查契约登记的全部 */
export async function findMissingAggregateTables(
  db: RawReader,
  types: readonly string[] = emittedAggregateTypes(),
): Promise<string[]> {
  const existing = new Set(await selectExistingTables(db, types));
  return types.filter((type) => !existing.has(type)).sort();
}

/** 启动自检：有对不上的即抛错 */
export async function assertAggregateTables(
  db: RawReader,
  types?: readonly string[],
): Promise<void> {
  const missing = await findMissingAggregateTables(db, types);
  if (missing.length > 0) {
    throw new Error(`契约登记的聚合类型在库里没有对应的表：${missing.join("、")}`);
  }
}
