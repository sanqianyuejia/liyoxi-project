import { describe, expect, it } from "vitest";
import { MallConfigSchema } from "@liyoxi/contract";
import { validateContent } from "../home/model";
import { reorderCategories } from "./model";

const content = MallConfigSchema.parse({
  categories: [
    { key: "all", name: "全部", genreCodes: [], visible: true, fixed: true },
    { key: "city", name: "都市", genreCodes: ["city"], visible: true, fixed: false },
    { key: "family", name: "家庭", genreCodes: ["family"], visible: false, fixed: false },
  ],
  hotWords: ["都市"],
  filters: {
    genre: true,
    industry: true,
    episodes: true,
    price: true,
    episodeBands: [{ key: "short", label: "短剧", min: 0, max: 30 }],
    priceBands: [{ key: "low", label: "低价", min: 0, max: 1000 }],
  },
  sorts: ["composite", "price_asc"],
  defaultSort: "composite",
  weights: { heat: 40, sales30d: 30, freshness: 20, manual: 10 },
});
describe("商城严格配置", () => {
  it("全部分类不能拖动或被其他分类挤到第二位", () => {
    expect(reorderCategories(content, "all", "family")).toBe(content);
    expect(reorderCategories(content, "family", "all")).toBe(content);
    expect(reorderCategories(content, "family", "city").categories.map((row) => row.key)).toEqual([
      "all",
      "family",
      "city",
    ]);
  });
  it("固定分类不能隐藏或附加题材，错误带字段路径", () => {
    const draft = structuredClone(content);
    draft.categories[0]!.visible = false;
    expect(validateContent("mall", draft)["categories.0"]).toBeDefined();
  });
  it("热词、分类题材、默认排序与权重均按正式 schema 校验", () => {
    const draft = structuredClone(content);
    draft.hotWords.push("都市");
    draft.categories[1]!.genreCodes = [];
    draft.defaultSort = "heat";
    draft.weights.manual = 11;
    const errors = validateContent("mall", draft);
    expect(errors.hotWords).toBeDefined();
    expect(errors["categories.1.genreCodes"]).toBeDefined();
    expect(errors.defaultSort).toBeDefined();
    expect(errors.weights).toBeDefined();
  });
  it("启用的分档不能为空，区间上下界错误定位到具体分档", () => {
    const draft = structuredClone(content);
    draft.filters.episodeBands = [];
    draft.filters.priceBands[0] = { key: "low", label: "低价", min: 2000, max: 1000 };
    const errors = validateContent("mall", draft);
    expect(errors["filters.episodeBands"]).toBeDefined();
    expect(errors["filters.priceBands.0"]).toBeDefined();
  });
  it("合法配置保持所有五种排序可配置", () => {
    expect(
      validateContent("mall", {
        ...content,
        sorts: ["composite", "heat", "price_asc", "price_desc", "newest"],
      }),
    ).toEqual({});
  });
});
