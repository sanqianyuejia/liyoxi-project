import { describe, expect, it, vi } from "vitest";
import { HomeRecommendConfigSchema, type SiteConfigView } from "@liyoxi/contract";
import { createSiteModel, createSiteIntent, homeSearch, moveId } from "./model";
import { SiteFailure, type SiteApi } from "./api";

const content = HomeRecommendConfigSchema.parse({
  recommendCount: 6,
  pins: [],
  defaultTab: "hot",
  newDays: 30,
});
function view(revNo = 4, lockVersion: number | null = null): SiteConfigView {
  return {
    configKey: "home_recommend",
    published: {
      siteConfigRevisionId: "019a0000-0000-7000-8000-000000000001",
      revNo,
      status: "published",
      content,
      note: null,
      publishedAt: "2026-10-10T00:00:00Z",
      publishedBy: null,
    },
    draft:
      lockVersion === null
        ? null
        : {
            siteConfigRevisionId: "019a0000-0000-7000-8000-000000000002",
            baseRevNo: revNo,
            content,
            note: null,
            lockVersion,
            createdBy: null,
            updatedAt: "2026-10-10T00:00:00Z",
          },
    refs: { categoryStats: [], pins: [], invalidRefs: [], affectedBanners: [] },
  };
}
function api(initial = view()) {
  return {
    get: vi.fn<SiteApi["get"]>().mockResolvedValue(initial),
    save: vi.fn<SiteApi["save"]>().mockResolvedValue(view(4, 12)),
    publish: vi.fn<SiteApi["publish"]>().mockResolvedValue(view(5)),
  };
}
describe("站点草稿与发布", () => {
  it("保存与发布使用独立键，发布使用保存返回的锁与本页基础版", async () => {
    const remote = api(view(4, 2)),
      model = createSiteModel(remote, "home_recommend");
    await model.load();
    await model.submit();
    expect(remote.save.mock.calls[0]?.[1]).toMatchObject({ baseRevNo: 4, lockVersion: 2 });
    expect(remote.publish.mock.calls[0]?.[1]).toEqual({ baseRevNo: 4, lockVersion: 12 });
    expect(remote.publish.mock.calls[0]?.[2]).not.toBe(remote.save.mock.calls[0]?.[2]);
    expect(model.getSnapshot().view?.published.revNo).toBe(5);
    model.dispose();
  });
  it("发布失败保留已存草稿，重试只调用发布并复用发布键", async () => {
    const remote = api(),
      model = createSiteModel(remote, "home_recommend");
    remote.publish.mockRejectedValueOnce(new Error("网络超时"));
    await model.load();
    await model.submit();
    expect(model.getSnapshot()).toMatchObject({ saved: true, dirty: false });
    expect(model.getSnapshot().message).toContain("草稿已保存");
    const key = remote.publish.mock.calls[0]?.[2];
    await model.retryPublish();
    expect(remote.save).toHaveBeenCalledTimes(1);
    expect(remote.publish.mock.calls[1]?.[2]).toBe(key);
    model.dispose();
  });
  it("保存期间发布版变化也不替旧草稿自动更新基础版", async () => {
    const remote = api(),
      model = createSiteModel(remote, "home_recommend");
    const saved = view(5, 12);
    saved.draft!.baseRevNo = 4;
    remote.save.mockResolvedValue(saved);
    remote.publish.mockRejectedValue(
      new SiteFailure({
        symbol: "CONFIG_REV_CONFLICT",
        status: 409,
        message: "发布版已变化",
        body: null,
        requestId: null,
        disposition: "toast",
      }),
    );
    await model.load();
    await model.submit();
    expect(remote.publish.mock.calls[0]?.[1]).toEqual({ baseRevNo: 4, lockVersion: 12 });
    expect(model.getSnapshot()).toMatchObject({ conflict: true, saved: true });
    await model.retryPublish();
    expect(remote.publish).toHaveBeenCalledTimes(1);
    model.dispose();
  });
  it("草稿版本冲突保留内容与原锁，不自动 GET 或重发", async () => {
    const remote = api(view(4, 2)),
      model = createSiteModel(remote, "home_recommend");
    remote.save.mockRejectedValue(
      new SiteFailure({
        symbol: "VERSION_CONFLICT",
        status: 409,
        message: "版本冲突",
        body: null,
        requestId: null,
        disposition: "invalidate",
      }),
    );
    await model.load();
    model.edit({ ...content, newDays: 40 });
    await model.submit();
    expect(model.getSnapshot()).toMatchObject({
      conflict: true,
      content: { newDays: 40 },
      dirty: true,
    });
    expect(remote.save.mock.calls[0]?.[1].lockVersion).toBe(2);
    await model.submit();
    await model.retryPublish();
    expect(remote.save).toHaveBeenCalledTimes(1);
    expect(remote.get).toHaveBeenCalledTimes(1);
    expect(remote.publish).not.toHaveBeenCalled();
    model.dispose();
  });
  it("同一草稿失败重试沿用键，内容改变后必须换键", async () => {
    const remote = api(),
      model = createSiteModel(remote, "home_recommend");
    remote.save.mockRejectedValue(new Error("网络断开"));
    await model.load();
    await model.submit(false);
    await model.submit(false);
    expect(remote.save.mock.calls[1]?.[2]).toBe(remote.save.mock.calls[0]?.[2]);
    model.edit({ ...content, newDays: 45 });
    await model.submit(false);
    expect(remote.save.mock.calls[2]?.[2]).not.toBe(remote.save.mock.calls[0]?.[2]);
    model.dispose();
  });
  it("历史内容先复制，保存时仍使用本页当前草稿锁，历史对象不变", async () => {
    const remote = api(view(4, 9)),
      model = createSiteModel(remote, "home_recommend");
    const historical = { ...content, newDays: 14 };
    await model.load();
    model.restore(historical, 1);
    expect(remote.save).not.toHaveBeenCalled();
    expect(remote.publish).not.toHaveBeenCalled();
    model.edit({ ...historical, recommendCount: 8 });
    await model.submit(false);
    expect(remote.save.mock.calls[0]?.[1]).toMatchObject({
      lockVersion: 9,
      baseRevNo: 4,
      content: { newDays: 14, recommendCount: 8 },
    });
    expect(historical.recommendCount).toBe(6);
    model.dispose();
  });
  it("离开页面后旧保存响应不再触发发布", async () => {
    const remote = api(),
      model = createSiteModel(remote, "home_recommend");
    let resolve!: (value: SiteConfigView) => void;
    remote.save.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    await model.load();
    const pending = model.submit();
    model.dispose();
    resolve(view(4, 99));
    await pending;
    expect(remote.publish).not.toHaveBeenCalled();
  });
  it("真实卸载先同步暂停，迟到保存不会在清理微任务前串行发布", async () => {
    const remote = api(),
      model = createSiteModel(remote, "home_recommend");
    let resolve!: (value: SiteConfigView) => void;
    remote.save.mockImplementation(
      () =>
        new Promise<SiteConfigView>((done) => {
          resolve = done;
        }),
    );
    await model.load();
    const pending = model.submit();
    model.suspend();
    resolve(view(4, 99));
    await pending;
    expect(remote.publish).not.toHaveBeenCalled();
    model.dispose();
  });
  it("StrictMode 同步暂停再恢复仍可使用当前编辑快照", async () => {
    const remote = api(),
      model = createSiteModel(remote, "home_recommend");
    await model.load();
    model.suspend();
    model.resume();
    model.edit({ ...content, newDays: 45 });
    await model.submit(false);
    expect(remote.save.mock.calls[0]?.[1]).toMatchObject({
      content: { newDays: 45 },
      lockVersion: null,
      baseRevNo: 4,
    });
    model.dispose();
  });
  it("编辑版本说明后不能仅发布旧说明的草稿", async () => {
    const model = createSiteModel(api(view(4, 9)), "home_recommend");
    await model.load();
    model.note("新的说明");
    model.edit({ ...content });
    expect(model.getSnapshot()).toMatchObject({ saved: false, dirty: true });
    model.dispose();
  });
});
describe("排序与地址状态", () => {
  it("拖动保留全部集合，包括停用行", () => {
    expect(moveId(["live", "disabled", "scheduled"], "scheduled", "live")).toEqual([
      "scheduled",
      "live",
      "disabled",
    ]);
    expect(moveId(["a", "b"], "missing", "a")).toEqual(["a", "b"]);
  });
  it("地址参数规范化并保留筛选与两类分页", () => {
    expect(
      homeSearch({
        bannerState: "disabled",
        bannerPage: "3",
        bannerPageSize: "50",
        historyPage: "2",
      }),
    ).toEqual({ bannerState: "disabled", bannerPage: 3, bannerPageSize: 50, historyPage: 2 });
    expect(
      homeSearch({ bannerState: "unknown", bannerPage: -1, bannerPageSize: 100 }),
    ).toMatchObject({ bannerState: "current", bannerPage: 1, bannerPageSize: 20 });
  });
  it("不同请求内容不共享幂等键", () => {
    const intent = createSiteIntent("test-site");
    const first = intent.key({ lockVersion: 1 });
    expect(intent.key({ lockVersion: 1 })).toBe(first);
    expect(intent.key({ lockVersion: 2 })).not.toBe(first);
  });
});
