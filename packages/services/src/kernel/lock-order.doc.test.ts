import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { LOCK_ORDER } from "./lock-order.js";

// 验收第 2 条：常量与 06 第 5 节的表逐行一致（次序号与表名，连行序）。首版 44 行。
// 文档是依据，常量是执行：新增一张要排序的表，两边同一个 PR 改；这里读文档现比，不另抄一份名单。

const DOC = new URL("../../../../docs/06-data-model.md", import.meta.url);

/** 06 第 5 节那张表的数据行：| 次序 | `表名` | 中文名 | */
function documentedOrder(): Array<[table: string, rank: number]> {
  const text = readFileSync(DOC, "utf8");
  const start = text.indexOf("\n## 5. 加锁顺序");
  const end = text.indexOf("\n## 6. ", start);
  if (start < 0 || end < 0) throw new Error("06 里找不到“## 5. 加锁顺序”一节");
  return [...text.slice(start, end).matchAll(/^\| (\d+) \| `([a-z0-9_]+)` \| [^|]+ \|$/gm)].map(
    (row) => [row[2] as string, Number(row[1])],
  );
}

describe("LOCK_ORDER 与 06 第 5 节一致", () => {
  const documented = documentedOrder();
  const declared = Object.entries(LOCK_ORDER);

  it("逐行一致：表名、次序号、行序", () => {
    expect(declared).toEqual(documented);
  });

  it("首版 44 行；以后只增不减", () => {
    expect(documented.length).toBeGreaterThanOrEqual(44);
    expect(declared).toHaveLength(documented.length);
  });

  it("次序号严格递增、表名不重复；计费账户排在最后", () => {
    const ranks = declared.map(([, rank]) => rank);
    expect(ranks).toEqual([...new Set(ranks)].sort((a, b) => a - b));
    expect(new Set(declared.map(([table]) => table)).size).toBe(declared.length);
    expect(declared.at(-1)?.[0]).toBe("billing_account");
  });
});
