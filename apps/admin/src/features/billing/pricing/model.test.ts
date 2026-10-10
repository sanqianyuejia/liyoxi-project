import { expect, it } from "vitest";
import { writeTableSearch } from "../../../lib/table-search";
import {
  priceBody,
  pricingQuery,
  pricingSearch,
  priceSummaryQuery,
  tomorrowBeijing,
} from "./model";
const now = new Date("2026-10-09T16:00:00.000Z");
const draft = {
  mode: "custom" as const,
  points: 500,
  effectiveDate: null,
  reason: "quality",
  note: "虚构调价原因",
};
it("北京时间跨零点使用明天，不用本机UTC日历", () => {
  expect(tomorrowBeijing(new Date("2026-10-09T15:59:59.999Z"))).toBe("2026-10-10");
  expect(tomorrowBeijing(now)).toBe("2026-10-11");
  expect(() =>
    priceBody({ listPricePoints: 300 }, { ...draft, effectiveDate: "2026-10-10" }, now),
  ).toThrow("明天");
  expect(
    priceBody({ listPricePoints: 300 }, { ...draft, effectiveDate: "2026-10-11" }, now)
      .effectiveDate,
  ).toBe("2026-10-11");
});
it("只发送当前P确认；模板模式发送null，不将展示的套餐实扣重算成价格", () => {
  expect(priceBody({ listPricePoints: 300 }, draft, now)).toMatchObject({
    mode: "custom",
    customPoints: 500,
    confirm: { currentPoints: 300 },
  });
  expect(
    priceBody({ listPricePoints: 300 }, { ...draft, mode: "template", points: 999 }, now),
  ).toMatchObject({
    mode: "template",
    customPoints: null,
    reasonCode: "restore_template",
    confirm: { currentPoints: 300 },
  });
  expect(() => priceBody({ listPricePoints: 300 }, { ...draft, points: 99 }, now)).toThrow();
});
it("历史页签独立筛选，返回刷新保留URL且summary不携带分页排序", () => {
  const search = pricingSearch({
    tab: "history",
    state: "pending",
    heatTier: "S",
    page: 2,
    pageSize: 10,
    sort: "-effectiveAt",
  });
  expect(pricingSearch(writeTableSearch(search))).toEqual(search);
  expect(pricingQuery(search)).toMatchObject({ state: "pending", page: 2, pageSize: 10 });
  expect(pricingQuery(search)).not.toHaveProperty("heatTier");
  expect(priceSummaryQuery(pricingSearch({ heatTier: "S", page: 2 }))).toEqual({ heatTier: "S" });
});
