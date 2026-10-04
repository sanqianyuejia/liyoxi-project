// 审核工作台的地址参数与选中逻辑（D7 第 5.3 节“行为约定”）：当前页签、选中项、搜索词进 URL（?tab=&id=&q=）。

export interface QueueSearch {
  tab?: string;
  id?: string;
  q?: string;
}

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;

export function readQueueSearch(raw: Readonly<Record<string, unknown>>): QueueSearch {
  return { tab: text(raw.tab), id: text(raw.id), q: text(raw.q) };
}

export function writeQueueSearch(search: QueueSearch): Record<string, string> {
  const out: Record<string, string> = {};
  if (search.tab) out.tab = search.tab;
  if (search.id) out.id = search.id;
  if (search.q) out.q = search.q;
  return out;
}

/** 当前该显示哪一条：地址里的 id 在队列里就用它，不在（已被处理、换了页签）就落到第一条 */
export function currentKey(keys: readonly string[], id: string | undefined): string | undefined {
  return id !== undefined && keys.includes(id) ? id : keys[0];
}

/** 处理完一条后自动选中的下一条：它后面那条；它是最后一条时取前面那条；队列只有它时没有下一条 */
export function nextKey(keys: readonly string[], handled: string): string | undefined {
  const index = keys.indexOf(handled);
  if (index < 0) return keys[0];
  return keys[index + 1] ?? keys[index - 1];
}

/** 清单是否勾完：要求全部勾选时，每一项都在已勾里 */
export function checklistDone(itemKeys: readonly string[], checked: readonly string[]): boolean {
  return itemKeys.every((key) => checked.includes(key));
}
