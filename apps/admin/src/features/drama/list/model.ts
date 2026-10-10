import { DramaListQuerySchema } from "@liyoxi/contract";
import { readContractQuery } from "../../../lib/contract-query";
import { readTableSearch, toListQuery, type TableSearch } from "../../../lib/table-search";
const fields = [
  "status",
  "genreCode",
  "industryCode",
  "heatTier",
  "dramaClass",
  "isExpiringSoon",
  "isOrderable",
  "isArchived",
] as const;
export function dramaSearch(raw: Readonly<Record<string, unknown>>): TableSearch {
  const input = readTableSearch(raw, fields);
  const tab = ["all", "listed", "draft", "delisted"].includes(input.tab ?? "") ? input.tab : "all";
  const query: Record<string, string | number> = {
    ...toListQuery(input),
    ...(tab !== "all" ? { status: tab } : {}),
  };
  delete query.tab;
  const { wire } = readContractQuery(DramaListQuerySchema, query, {
    keys: ["q", "page", "pageSize", "sort", ...fields],
    defaults: { page: "1", pageSize: "20", sort: "-updatedAt" },
    keywordLimit: 20,
  });
  return { ...readTableSearch(wire, fields), tab };
}
export function dramaQuery(search: TableSearch) {
  const query = toListQuery(search);
  delete query.tab;
  if (search.tab && search.tab !== "all") query.status = search.tab;
  return query;
}
