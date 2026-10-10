import {
  DramaPriceListQuerySchema,
  DramaPriceRevisionListQuerySchema,
  DramaPriceCreateBodySchema,
} from "@liyoxi/contract";
import { addDays, calendarDate } from "@liyoxi/shared/time";
import { readTableSearch, toListQuery, type TableSearch } from "../../../lib/table-search";
import { readContractQuery } from "../../../lib/contract-query";
import type { PriceBody, PriceRow } from "./api";
const listFilters = ["dramaId", "heatTier", "priceMode", "status", "isArchived"];
export function pricingSearch(raw: Readonly<Record<string, unknown>>) {
  const search = readTableSearch(raw, [...listFilters, "state"]);
  const tab = raw.tab === "history" ? "history" : raw.tab === "templates" ? "templates" : "dramas";
  const keys =
    tab === "history"
      ? ["page", "pageSize", "dramaId", "state", "sort"]
      : ["q", "page", "pageSize", ...listFilters, "sort"];
  const query = {
    ...search.filters,
    q: search.q,
    page: search.page,
    pageSize: search.pageSize,
    sort: search.sort,
  };
  const options = { keys, keywordLimit: 20, defaults: { page: "1", pageSize: "20" } };
  const { wire } =
    tab === "history"
      ? readContractQuery(DramaPriceRevisionListQuerySchema, query, options)
      : readContractQuery(DramaPriceListQuerySchema, query, options);
  const filters = Object.fromEntries(
    Object.entries(wire).filter(([key]) => !["q", "page", "pageSize", "sort"].includes(key)),
  );
  return {
    ...search,
    tab,
    q: wire.q,
    sort: wire.sort,
    page: Number(wire.page),
    pageSize: Number(wire.pageSize),
    filters,
  };
}
export function pricingQuery(search: TableSearch) {
  const { tab: _tab, ...query } = toListQuery(search);
  return query;
}
export function priceSummaryQuery(search: TableSearch) {
  const { page: _page, pageSize: _size, sort: _sort, ...query } = pricingQuery(search);
  return query;
}
export const PRICE_REASONS = [
  { value: "quality", label: "内容质量" },
  { value: "genre_fit", label: "题材适配" },
  { value: "release_timing", label: "发行时机" },
  { value: "license_remaining", label: "授权剩余期" },
  { value: "restore_template", label: "恢复模板价" },
];
export function tomorrowBeijing(now = new Date()) {
  return addDays(calendarDate(now), 1);
}
/** 只构造意图，不计算任何套餐实扣或模板价格。 */
export function priceBody(
  row: Pick<PriceRow, "listPricePoints">,
  draft: {
    mode: "template" | "custom";
    points: number | null;
    effectiveDate: string | null;
    reason: string;
    note: string;
  },
  now = new Date(),
): PriceBody {
  if (draft.effectiveDate && draft.effectiveDate < tomorrowBeijing(now))
    throw new Error("指定生效日不得早于北京时间明天");
  return DramaPriceCreateBodySchema.parse({
    mode: draft.mode,
    customPoints: draft.mode === "template" ? null : draft.points,
    effectiveDate: draft.effectiveDate,
    reasonCode: draft.mode === "template" ? "restore_template" : draft.reason,
    note: draft.note || null,
    confirm: { currentPoints: row.listPricePoints },
  });
}
