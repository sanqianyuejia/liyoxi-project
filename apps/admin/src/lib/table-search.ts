// 筛选表格页的地址参数（D7 第 5.3 节；约定 C43–C45）：筛选条件、页码、排序、当前页签全部进 URL 查询参数，
// 刷新、分享链接、浏览器后退都不丢。参数名照约定：tab、q、page（从 1 起）、pageSize、sort（-字段 表示降序），
// 其余筛选按 DTO 字段名。
// 每页条数缺省 20，可选 10、20、50（计划 第 4.2 节 Q5 的默认；规范 第 5.2 节的原型示例是 10）。

export const DEFAULT_PAGE_SIZE = 20;
export const PAGE_SIZE_OPTIONS = [10, 20, 50] as const;

export interface TableSearch {
  tab?: string;
  q?: string;
  page: number;
  pageSize: number;
  sort?: string;
  /** 其余筛选：字段名 → 取值（多值用逗号分隔） */
  filters: Readonly<Record<string, string>>;
}

const RESERVED = new Set(["tab", "q", "page", "pageSize", "sort"]);

const text = (value: unknown): string | undefined => {
  if (typeof value === "string") return value.trim() === "" ? undefined : value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return String(value);
  return undefined;
};

const positiveInt = (value: unknown): number | undefined => {
  const parsed = typeof value === "number" ? value : Number(text(value));
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : undefined;
};

/**
 * 把地址里的查询参数读成筛选状态。不认识的页码、条数回到缺省值；filterKeys 之外的参数丢掉。
 * 路由的 validateSearch 调它：地址被人手改坏了页面也能打开。
 */
export function readTableSearch(
  raw: Readonly<Record<string, unknown>>,
  filterKeys: readonly string[] = [],
): TableSearch {
  const pageSize = positiveInt(raw.pageSize);
  const filters: Record<string, string> = {};
  for (const key of filterKeys) {
    if (RESERVED.has(key)) throw new Error(`筛选字段不能叫 ${key}：与页码、排序等参数重名`);
    const value = text(raw[key]);
    if (value !== undefined) filters[key] = value;
  }
  return {
    tab: text(raw.tab),
    q: text(raw.q),
    page: positiveInt(raw.page) ?? 1,
    pageSize:
      pageSize !== undefined && (PAGE_SIZE_OPTIONS as readonly number[]).includes(pageSize)
        ? pageSize
        : DEFAULT_PAGE_SIZE,
    sort: text(raw.sort),
    filters,
  };
}

/** 写回地址：缺省值不写（第 1 页、每页 20 条），地址保持干净 */
export function writeTableSearch(search: TableSearch): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  if (search.tab) out.tab = search.tab;
  if (search.q) out.q = search.q;
  for (const [key, value] of Object.entries(search.filters)) if (value) out[key] = value;
  if (search.sort) out.sort = search.sort;
  if (search.page > 1) out.page = search.page;
  if (search.pageSize !== DEFAULT_PAGE_SIZE) out.pageSize = search.pageSize;
  return out;
}

/** 给列表接口的查询参数：页码与条数总是带上 */
export function toListQuery(search: TableSearch): Record<string, string | number> {
  return { ...writeTableSearch(search), page: search.page, pageSize: search.pageSize };
}

/** 换页签：回到第 1 页 */
export function withTab(search: TableSearch, tab: string | undefined): TableSearch {
  return { ...search, tab, page: 1 };
}

/** 改关键词：回到第 1 页 */
export function withKeyword(search: TableSearch, q: string | undefined): TableSearch {
  return { ...search, q: q?.trim() || undefined, page: 1 };
}

/** 改一个筛选：回到第 1 页；值为空即去掉这一项 */
export function withFilter(
  search: TableSearch,
  key: string,
  value: string | undefined,
): TableSearch {
  const filters = { ...search.filters };
  if (value) filters[key] = value;
  else delete filters[key];
  return { ...search, filters, page: 1 };
}

/** 重置筛选：关键词与筛选清空，页签、排序、每页条数保留 */
export function withFiltersReset(search: TableSearch): TableSearch {
  return { ...search, q: undefined, filters: {}, page: 1 };
}

export function withPage(search: TableSearch, page: number): TableSearch {
  return { ...search, page: Math.max(1, Math.trunc(page)) };
}

/** 改每页条数：回到第 1 页 */
export function withPageSize(search: TableSearch, pageSize: number): TableSearch {
  if (!(PAGE_SIZE_OPTIONS as readonly number[]).includes(pageSize)) {
    throw new Error(`每页条数只有 ${PAGE_SIZE_OPTIONS.join("、")} 三档`);
  }
  return { ...search, pageSize, page: 1 };
}

export type SortOrder = "asc" | "desc";

/** 只支持单字段排序的写法：field 或 -field（约定 C44）；具名排序值（如 urgency）按升序读 */
export function readSort(sort: string | undefined): { field: string; order: SortOrder } | null {
  const first = sort?.split(",")[0]?.trim();
  if (!first) return null;
  return first.startsWith("-")
    ? { field: first.slice(1), order: "desc" }
    : { field: first, order: "asc" };
}

/** 改排序：回到第 1 页；order 为空即去掉排序 */
export function withSort(
  search: TableSearch,
  field: string,
  order: SortOrder | undefined,
): TableSearch {
  const sort = order === undefined ? undefined : order === "desc" ? `-${field}` : field;
  return { ...search, sort, page: 1 };
}

export function hasActiveFilters(search: TableSearch): boolean {
  return Boolean(search.q) || Object.keys(search.filters).length > 0;
}

export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}
