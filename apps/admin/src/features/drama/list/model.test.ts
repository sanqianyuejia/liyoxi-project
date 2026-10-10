import { expect, it } from "vitest";
import { writeTableSearch } from "../../../lib/table-search";
import { dramaQuery, dramaSearch } from "./model";

it("剧目筛选分页排序进入URL且刷新往返一致，UI页签不发给API", () => {
  const value = dramaSearch({
    tab: "listed",
    q: " 虚构剧目 ",
    page: "2",
    pageSize: "10",
    sort: "-updatedAt",
    genreCode: "romance",
    industryCode: "food",
  });
  expect(dramaSearch(writeTableSearch(value))).toEqual(value);
  expect(dramaQuery(value)).toMatchObject({
    status: "listed",
    page: 2,
    pageSize: 10,
    q: "虚构剧目",
    genreCode: "romance",
    industryCode: "food",
  });
  expect(dramaQuery(value)).not.toHaveProperty("tab");
});
it("不可信枚举/排序/分页被正式schema收窄，未知筛选不传出", () => {
  const value = dramaSearch({
    tab: "unknown",
    status: "invented",
    heatTier: "huge",
    page: -2,
    pageSize: 500,
    sort: "secret",
    leaked: "value",
  });
  expect(value).toMatchObject({ tab: "all", page: 1, pageSize: 20 });
  expect(dramaQuery(value)).not.toHaveProperty("leaked");
  expect(dramaQuery(value)).not.toHaveProperty("heatTier");
  expect(dramaQuery(value)).not.toHaveProperty("status");
});
