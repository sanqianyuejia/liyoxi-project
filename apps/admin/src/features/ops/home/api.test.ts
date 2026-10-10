import { describe, expect, it, vi } from "vitest";
import type { AppServices } from "../../../app/services";
import { createSiteApi, fieldErrors, SiteFailure } from "./api";

describe("站点真实客户端适配", () => {
  it("未结束 Banner 遍历所有分页，包含停用行", async () => {
    const first = Array.from({ length: 100 }, (_, index) => ({
      homeBannerId: `banner-${index}`,
      displayState: index === 2 ? "disabled" : "live",
    }));
    const second = [{ homeBannerId: "banner-100", displayState: "scheduled" }];
    const GET = vi
      .fn()
      .mockResolvedValueOnce({ data: { data: { items: first, total: 101 } } })
      .mockResolvedValueOnce({ data: { data: { items: second, total: 101 } } });
    const api = createSiteApi({ api: { client: { GET } } as unknown as AppServices["api"] });
    const result = await api.unended();
    expect(result).toHaveLength(101);
    expect(result[2]?.displayState).toBe("disabled");
    expect(GET.mock.calls[0]?.[1].params.query).toEqual({
      isEnded: false,
      sort: "position",
      page: 1,
      pageSize: 100,
    });
    expect(GET.mock.calls[1]?.[1].params.query.page).toBe(2);
  });
  it("分页过程中空页或重复行拒绝排序，不能提交缺少对象的集合", async () => {
    const GET = vi
      .fn()
      .mockResolvedValueOnce({ data: { data: { items: [{ homeBannerId: "a" }], total: 2 } } })
      .mockResolvedValueOnce({ data: { data: { items: [], total: 2 } } });
    const api = createSiteApi({ api: { client: { GET } } as unknown as AppServices["api"] });
    await expect(api.unended()).rejects.toThrow("列表已变化");
    GET.mockReset()
      .mockResolvedValueOnce({ data: { data: { items: [{ homeBannerId: "a" }], total: 2 } } })
      .mockResolvedValueOnce({ data: { data: { items: [{ homeBannerId: "a" }], total: 2 } } });
    await expect(api.unended()).rejects.toThrow("列表已变化");
  });
  it("消费 openapi-fetch 已读取的错误体，保留正式冲突符号", async () => {
    const GET = vi.fn().mockResolvedValue({
      response: new Response(null, { status: 409 }),
      error: {
        code: 47102,
        error: "BANNER_ORDER_STALE",
        message: "Banner 列表已变化",
        retryable: false,
        requestId: "w312-request",
        details: {},
      },
    });
    const api = createSiteApi({ api: { client: { GET } } as unknown as AppServices["api"] });
    await expect(api.banners({})).rejects.toMatchObject({
      failure: { symbol: "BANNER_ORDER_STALE" },
    });
  });
  it("引用失效 details.items 保留正式字段路径供表单定位", () => {
    const failure = new SiteFailure({
      symbol: "CONFIG_REF_INVALID",
      status: 409,
      message: "引用失效",
      requestId: null,
      disposition: "toast",
      body: {
        code: 47104,
        error: "CONFIG_REF_INVALID",
        message: "引用失效",
        retryable: false,
        requestId: "w312-request",
        details: {
          items: [
            { path: "categories.1.genreCodes.0", code: "disabled_genre", reason: "genre_disabled" },
          ],
        },
      },
    });
    expect(fieldErrors(failure)).toEqual({ "categories.1.genreCodes.0": "genre_disabled" });
  });
});
