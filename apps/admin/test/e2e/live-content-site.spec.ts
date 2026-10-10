import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { addDays, atMinuteOfDay, calendarDate } from "@liyoxi/shared/time";
import { expect, test, type Page, type Response } from "@playwright/test";
import {
  HomeBannerMutationSchema,
  HomeBannerPageSchema,
  HomeBannerReorderResultSchema,
  HomeBannerReorderBodySchema,
  SiteConfigViewSchema,
  type HomeBannerCreateBody,
  type HomeBannerItem,
  type SiteConfigView,
} from "@liyoxi/contract";
import { liveContext, recordErrors } from "./live-context";
import {
  contentFixture,
  syntheticImage,
  viewportShots,
  startSiteWriteObserver,
  siteWriteBody,
  stopSiteWriteObserver,
} from "./w312-media";

type ConfigKey = "home_recommend" | "mall";
function headers(action: string) {
  return {
    "X-LYX-Admin": "1",
    Origin: liveContext().origin,
    "Idempotency-Key": `${action}:${randomUUID()}`,
  };
}
async function config(page: Page, key: ConfigKey): Promise<SiteConfigView> {
  const response = await page.request.get(`/api/v1/admin/site-configs/${key}`);
  expect(response.status()).toBe(200);
  return SiteConfigViewSchema.parse((await response.json()).data);
}
function writeResponse(page: Page, key: ConfigKey, phase: "draft" | "publish") {
  return page.waitForResponse(
    (response) =>
      response.request().method() === (phase === "draft" ? "PUT" : "POST") &&
      new URL(response.url()).pathname === `/api/v1/admin/site-configs/${key}/${phase}`,
  );
}
async function successful(response: Response) {
  expect(response.status()).toBe(200);
  return SiteConfigViewSchema.parse((await response.json()).data);
}
async function restore(
  page: Page,
  key: ConfigKey,
  original: SiteConfigView["published"]["content"],
) {
  const current = await config(page, key);
  if (!current.draft && JSON.stringify(current.published.content) === JSON.stringify(original))
    return;
  const saved = await page.request.put(`/api/v1/admin/site-configs/${key}/draft`, {
    headers: headers("w312-site-cleanup-draft"),
    data: {
      content: original,
      baseRevNo: current.published.revNo,
      lockVersion: current.draft?.lockVersion ?? null,
      note: "恢复隔离验收前配置",
    },
  });
  expect(saved.status()).toBe(200);
  const draft = SiteConfigViewSchema.parse((await saved.json()).data).draft;
  expect(draft).not.toBeNull();
  const published = await page.request.post(`/api/v1/admin/site-configs/${key}/publish`, {
    headers: headers("w312-site-cleanup-publish"),
    data: { lockVersion: draft!.lockVersion, baseRevNo: current.published.revNo },
  });
  expect(published.status()).toBe(200);
}
async function unendedBanners(page: Page) {
  const items: HomeBannerItem[] = [];
  let total: number | undefined;
  for (let number = 1; ; number++) {
    const response = await page.request.get(
      `/api/v1/admin/home-banners?page=${number}&pageSize=100&isEnded=false&sort=position`,
    );
    expect(response.status()).toBe(200);
    const data = HomeBannerPageSchema.parse((await response.json()).data);
    total ??= data.total;
    expect(data.total, "排序快照读取期间集合应稳定").toBe(total);
    items.push(...data.items);
    if (items.length >= total) break;
    expect(data.items.length, "完整排序集合不得截断分页").toBeGreaterThan(0);
  }
  expect(new Set(items.map((row) => row.homeBannerId)).size).toBe(items.length);
  return items;
}
function bannerResponse(page: Page, method: "POST" | "PATCH", suffix = "") {
  return page.waitForResponse(
    (response) =>
      response.request().method() === method &&
      new URL(response.url()).pathname === `/api/v1/admin/home-banners${suffix}`,
  );
}
async function createBanner(page: Page, body: HomeBannerCreateBody) {
  const response = await page.request.post("/api/v1/admin/home-banners", {
    headers: headers("w312-banner-setup"),
    data: body,
  });
  expect(response.status()).toBe(200);
  return HomeBannerMutationSchema.parse((await response.json()).data);
}
async function orderBanners(page: Page, ids: string[]) {
  const response = await page.request.post("/api/v1/admin/home-banners/reorder", {
    headers: headers("w312-banner-order-setup"),
    data: { homeBannerIds: ids },
  });
  expect(response.status()).toBe(200);
  return HomeBannerReorderResultSchema.parse((await response.json()).data);
}
async function cleanupBanners(page: Page, owned: string[], baseline: HomeBannerItem[]) {
  if (!owned.length) return;
  const current = await unendedBanners(page);
  for (const row of current.filter((item) => owned.includes(item.homeBannerId) && item.isEnabled)) {
    const response = await page.request.patch(`/api/v1/admin/home-banners/${row.homeBannerId}`, {
      headers: headers("w312-banner-cleanup"),
      data: { lockVersion: row.lockVersion, isEnabled: false },
    });
    expect(response.status()).toBe(200);
  }
  const baselineIds = baseline.map((row) => row.homeBannerId),
    currentIds = current.map((row) => row.homeBannerId);
  await orderBanners(page, [
    ...baselineIds.filter((id) => currentIds.includes(id)),
    ...currentIds.filter((id) => !baselineIds.includes(id)),
  ]);
}
test.beforeEach(async ({ page }) => {
  mkdirSync("dist/e2e-shots", { recursive: true });
  await startSiteWriteObserver(page);
});
test.afterEach(async ({ page }) => {
  await stopSiteWriteObserver(page);
});

test("W312 首页真实草稿与发布分离、独立键、历史复制为新发布版", async ({ page }, info) => {
  contentFixture();
  const errors = recordErrors(page),
    original = await config(page, "home_recommend");
  if (!("recommendCount" in original.published.content))
    throw new Error("Unexpected home config content");
  const initial = original.published.content,
    nextCount = initial.recommendCount === 12 ? 11 : initial.recommendCount + 1;
  try {
    await page.goto("/ops/home");
    await expect(page.getByRole("heading", { name: "首页配置", exact: true })).toBeVisible();
    const form = page.getByRole("form", { name: "推荐位", exact: true });
    await expect(
      form.getByRole("spinbutton", { name: "展示数量（3–12 部）", exact: true }),
    ).toBeEnabled();
    await form
      .getByRole("spinbutton", { name: "展示数量（3–12 部）", exact: true })
      .fill(String(nextCount));
    await form
      .getByRole("textbox", { name: "版本说明（选填）", exact: true })
      .fill(`首页验收 ${contentFixture().scope.runId}`);
    const saveWait = writeResponse(page, "home_recommend", "draft");
    await page.getByRole("button", { name: "保存草稿", exact: true }).click();
    const savedResponse = await saveWait,
      saved = await successful(savedResponse);
    expect(saved.published.revNo).toBe(original.published.revNo);
    expect(saved.draft?.content).toMatchObject({ recommendCount: nextCount });
    expect((await config(page, "home_recommend")).published.content).toEqual(initial);
    await expect(page.getByText("草稿已保存，尚未发布", { exact: true })).toBeVisible();
    const publishWait = writeResponse(page, "home_recommend", "publish");
    await page.getByRole("button", { name: "仅发布已存草稿", exact: true }).click();
    const publishResponse = await publishWait,
      published = await successful(publishResponse);
    expect(await siteWriteBody(page, publishResponse)).toEqual({
      lockVersion: saved.draft!.lockVersion,
      baseRevNo: original.published.revNo,
    });
    expect(publishResponse.request().headers()["idempotency-key"]).not.toBe(
      savedResponse.request().headers()["idempotency-key"],
    );
    expect(published.published.revNo).toBe(original.published.revNo + 1);
    expect(published.draft).toBeNull();
    await expect(
      page.getByText(`已发布版本 ${published.published.revNo}`, { exact: true }),
    ).toBeVisible();
    await page.getByRole("heading", { name: "首页配置", exact: true }).scrollIntoViewIfNeeded();
    await viewportShots(page, info, "w312-home-published");
    const historyButton = page.getByRole("button", { name: "版本记录", exact: true });
    await historyButton.focus();
    await page.keyboard.press("Enter");
    const history = page.getByRole("dialog", { name: "推荐位版本记录", exact: true });
    await expect(history).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(history).not.toBeVisible();
    await expect(historyButton).toBeFocused();
    await historyButton.press("Enter");
    const old = history.getByRole("row").filter({
      has: page.getByRole("cell", { name: `${original.published.revNo} · 已归档`, exact: true }),
    });
    await old.getByRole("button", { name: "复制到编辑区", exact: true }).click();
    await expect(
      form.getByRole("spinbutton", { name: "展示数量（3–12 部）", exact: true }),
    ).toHaveValue(String(initial.recommendCount));
    const rollbackSave = writeResponse(page, "home_recommend", "draft"),
      rollbackPublish = writeResponse(page, "home_recommend", "publish");
    const submit = form.locator(".lyx-config-page__footer").getByRole("button");
    await expect(submit).toHaveText("保存并发布");
    await expect(submit).toBeEnabled();
    await expect(form).toHaveAttribute("aria-busy", "false");
    await submit.click();
    const rollbackSavedResponse = await rollbackSave,
      rollbackSaved = await successful(rollbackSavedResponse);
    const rollbackResponse = await rollbackPublish,
      rollback = await successful(rollbackResponse);
    expect(await siteWriteBody(page, rollbackResponse)).toEqual({
      lockVersion: rollbackSaved.draft!.lockVersion,
      baseRevNo: published.published.revNo,
    });
    expect(rollback.published.revNo).toBe(published.published.revNo + 1);
    expect(rollback.published.content).toEqual(initial);
    const revisions = await page.request.get(
      "/api/v1/admin/site-configs/home_recommend/revisions?pageSize=100",
    );
    expect(revisions.status()).toBe(200);
    expect(
      (await revisions.json()).data.items.find(
        (row: { revNo: number }) => row.revNo === original.published.revNo,
      ).content,
    ).toEqual(initial);
    expect(errors).toEqual([]);
  } finally {
    await restore(page, "home_recommend", initial);
  }
});

test("W312 商城严格权重路径、合法热词、真实草稿发布与三视口", async ({ page }, info) => {
  const f = contentFixture(),
    errors = recordErrors(page),
    original = await config(page, "mall");
  if (!("weights" in original.published.content)) throw new Error("Unexpected mall config content");
  const initial = original.published.content;
  try {
    await page.goto("/ops/mall");
    await expect(
      page.getByRole("heading", { name: "商城配置", exact: true, level: 1 }),
    ).toBeVisible();
    const form = page.getByRole("form", { name: "商城配置", exact: true });
    const writes: string[] = [];
    page.on("request", (request) => {
      if (request.method() !== "GET" && request.url().includes("/site-configs/mall/"))
        writes.push(request.url());
    });
    const heat = form.getByRole("spinbutton", { name: "热度等级权重（%）", exact: true });
    await heat.fill(String(initial.weights.heat === 100 ? 99 : initial.weights.heat + 1));
    await form.getByRole("button", { name: "保存并发布", exact: true }).click();
    await expect(form.getByRole("button", { name: /weights.*四项权重合计须为 100/ })).toBeVisible();
    expect(writes).toEqual([]);
    await heat.fill(String(initial.weights.heat));
    for (let remove = Math.max(0, initial.hotWords.length - 6); remove > 0; remove--)
      await form
        .getByRole("button", { name: /^移除搜索词 / })
        .first()
        .click();
    const word = `验收${f.scope.runId.slice(0, 4)}`;
    await form.getByRole("textbox", { name: "新搜索词", exact: true }).fill(word);
    await form.getByRole("button", { name: "添加热词", exact: true }).click();
    await form.getByRole("textbox", { name: "新搜索词", exact: true }).fill(word);
    await form.getByRole("button", { name: "添加热词", exact: true }).click();
    await expect(form.getByText("热词不能重复", { exact: true })).toBeVisible();
    const saveWait = writeResponse(page, "mall", "draft");
    await page.getByRole("button", { name: "保存草稿", exact: true }).click();
    const savedResponse = await saveWait,
      saved = await successful(savedResponse);
    expect(saved.published.revNo).toBe(original.published.revNo);
    expect(saved.draft?.content).toMatchObject({ hotWords: expect.arrayContaining([word]) });
    const publishWait = writeResponse(page, "mall", "publish");
    await page.getByRole("button", { name: "仅发布已存草稿", exact: true }).click();
    const publishedResponse = await publishWait,
      published = await successful(publishedResponse);
    expect(await siteWriteBody(page, publishedResponse)).toEqual({
      lockVersion: saved.draft!.lockVersion,
      baseRevNo: original.published.revNo,
    });
    expect(publishedResponse.request().headers()["idempotency-key"]).not.toBe(
      savedResponse.request().headers()["idempotency-key"],
    );
    expect(published.published.revNo).toBe(original.published.revNo + 1);
    await page
      .getByRole("heading", { name: "商城配置", exact: true, level: 1 })
      .scrollIntoViewIfNeeded();
    await viewportShots(page, info, "w312-mall-published");
    await page.getByRole("region", { name: "排序方式", exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({
      path: "dist/e2e-shots/w312-mall-sort-1366.png",
      animations: "disabled",
    });
    await page.getByRole("button", { name: "版本记录", exact: true }).click();
    const history = page.getByRole("dialog", { name: "商城配置版本记录", exact: true });
    await expect(
      history.getByRole("cell", { name: `${original.published.revNo} · 已归档`, exact: true }),
    ).toBeVisible();
    await history
      .locator(".lyx-confirm__footer")
      .getByRole("button", { name: "关闭", exact: true })
      .click();
    expect(errors).toEqual([]);
  } finally {
    await restore(page, "mall", initial);
  }
});

test("W312 未上架引用保留为草稿，真实发布拒绝并定位失效路径", async ({ page }) => {
  const f = contentFixture(),
    errors = recordErrors(page),
    original = await config(page, "home_recommend");
  if (!("pins" in original.published.content)) throw new Error("Unexpected home config content");
  const initial = original.published.content;
  try {
    const drama = await page.request.get(`/api/v1/admin/dramas/${f.dramaId}`);
    expect(drama.status()).toBe(200);
    expect((await drama.json()).data.status).not.toBe("listed");
    const dictionaries = await page.request.get("/api/v1/admin/dict-items?typeKey=industry");
    expect(dictionaries.status()).toBe(200);
    const industry = (await dictionaries.json()).data.items.find(
      (row: { isEnabled: boolean; parentCode: string | null }) =>
        row.isEnabled && row.parentCode === null,
    );
    if (!industry) throw new Error("Missing enabled industry for the real reference guard");
    const savedResponse = await page.request.put(
      "/api/v1/admin/site-configs/home_recommend/draft",
      {
        headers: headers("w312-invalid-ref-draft"),
        data: {
          content: { ...initial, pins: [{ industryCode: industry.code, dramaId: f.dramaId }] },
          baseRevNo: original.published.revNo,
          lockVersion: original.draft?.lockVersion ?? null,
          note: "隔离验收：未上架引用拒绝",
        },
      },
    );
    expect(savedResponse.status()).toBe(200);
    const saved = SiteConfigViewSchema.parse((await savedResponse.json()).data);
    expect(saved.refs.invalidRefs).toEqual(
      expect.arrayContaining([
        { path: "pins.0.dramaId", code: f.dramaId, reason: "drama_not_listed" },
      ]),
    );
    await page.goto("/ops/home");
    await expect(page.locator(".lyx-site-invalid").filter({ hasText: f.title })).toBeVisible();
    const refusedWait = writeResponse(page, "home_recommend", "publish");
    await page.getByRole("button", { name: "仅发布已存草稿", exact: true }).click();
    const refused = await refusedWait;
    expect(refused.status()).toBe(409);
    expect(await refused.json()).toMatchObject({
      error: "CONFIG_REF_INVALID",
      details: {
        items: expect.arrayContaining([
          { path: "pins.0.dramaId", code: f.dramaId, reason: "drama_not_listed" },
        ]),
      },
    });
    const errorPath = page.getByRole("button", { name: /pins\.0\.dramaId.*drama_not_listed/ });
    await expect(errorPath).toBeVisible();
    await errorPath.click();
    await expect(
      page.getByRole("button", { name: `移除 ${industry.code} 置顶`, exact: true }),
    ).toBeFocused();
    const current = await config(page, "home_recommend");
    expect(current.published.revNo).toBe(original.published.revNo);
    expect(current.draft?.lockVersion).toBe(saved.draft?.lockVersion);
    expect(current.draft?.content).toMatchObject({
      pins: [{ industryCode: industry.code, dramaId: f.dramaId }],
    });
    await page.screenshot({
      path: "dist/e2e-shots/w312-home-invalid-reference-1366.png",
      animations: "disabled",
    });
    expect(errors).toEqual([
      "Failed to load resource: the server responded with a status of 409 (Conflict)",
    ]);
  } finally {
    await restore(page, "home_recommend", initial);
  }
});

test("W312 Banner 真实图片上传、编辑停用、完整排序与过期集合重试", async ({ page }, info) => {
  test.setTimeout(180_000);
  const f = contentFixture(),
    errors = recordErrors(page),
    baseline = await unendedBanners(page);
  const owned: string[] = [],
    title = `验收 Banner ${f.scope.runId.slice(0, 8)} A`,
    editedTitle = `${title}改`;
  const day = addDays(calendarDate(new Date()), 1);
  try {
    await page.goto("/ops/home?bannerPageSize=50");
    const banners = page.getByRole("region", { name: "Banner", exact: true });
    await banners.getByRole("button", { name: "新增 Banner", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "新增 Banner", exact: true });
    await editor.getByRole("textbox", { name: "标题", exact: true }).fill(title);
    const registrationWait = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/api/v1/admin/files",
    );
    // 合成 PNG 仅是隔离环境输入；登记、直传、确认及入库均走正式链路。
    await editor.locator('input[type="file"]').setInputFiles(syntheticImage("w312-banner.png"));
    const registration = await registrationWait;
    expect(registration.status()).toBe(200);
    expect(await siteWriteBody(page, registration)).toMatchObject({
      category: "banner",
      fileName: "w312-banner.png",
    });
    const imageFileId = (await registration.json()).data.fileId as string;
    await expect(editor.getByRole("button", { name: "重新上传（替换）", exact: true })).toBeVisible(
      { timeout: 120_000 },
    );
    const jump = editor.getByRole("combobox", { name: "跳转类型", exact: true });
    await jump.focus();
    await jump.press("Enter");
    await expect(page.locator(".ant-select-dropdown:visible")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(page.locator(".ant-select-dropdown:visible")).toHaveCount(0);
    await expect(jump).toBeFocused();
    await jump.click();
    await page
      .locator(".ant-select-dropdown:visible")
      .getByTitle("不跳转", { exact: true })
      .click();
    const start = editor.locator(".ant-picker-input input").nth(0),
      end = editor.locator(".ant-picker-input input").nth(1);
    await start.focus();
    await start.press("Enter");
    await expect(page.locator(".ant-picker-dropdown:visible")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(page.locator(".ant-picker-dropdown:visible")).toHaveCount(0);
    await start.press("Tab");
    await expect(end).toBeFocused();
    await start.fill(`${day} 09:00`);
    await start.press("Tab");
    await end.fill(`${day} 10:00`);
    await end.press("Enter");
    await end.press("Tab");
    await expect(page.locator(".ant-picker-dropdown:visible")).toHaveCount(0);
    await expect(editor.getByText(/当前时间窗：.*09:00.*10:00/)).toBeVisible();
    await page.screenshot({
      path: "dist/e2e-shots/w312-banner-create-1366.png",
      animations: "disabled",
    });
    const createWait = bannerResponse(page, "POST");
    await editor.getByRole("button", { name: "新增 Banner", exact: true }).click();
    const createResponse = await createWait;
    expect(createResponse.status()).toBe(200);
    const first = HomeBannerMutationSchema.parse((await createResponse.json()).data);
    owned.push(first.homeBannerId);
    expect(first).toMatchObject({
      title,
      imageFileId,
      jumpKind: "none",
      jumpTarget: null,
      isEnabled: true,
      startAt: atMinuteOfDay(day, 540).toISOString(),
      endAt: atMinuteOfDay(day, 600).toISOString(),
    });
    await expect(editor).not.toBeVisible();
    const nextBody: HomeBannerCreateBody = {
      title: `${title.slice(0, -1)}B`,
      imageFileId,
      startAt: first.startAt,
      endAt: first.endAt,
      jumpKind: "none",
      jumpTarget: null,
      isEnabled: false,
    };
    const second = await createBanner(page, nextBody);
    owned.push(second.homeBannerId);
    // 将本次两行放在可见页；保留原有完整集合及相对顺序，finally 用正式 API 恢复。
    const beforeOrder = await unendedBanners(page);
    await orderBanners(page, [
      first.homeBannerId,
      second.homeBannerId,
      ...beforeOrder
        .filter((row) => !owned.includes(row.homeBannerId))
        .map((row) => row.homeBannerId),
    ]);
    await page.reload();
    const row = (name: string) =>
      banners.getByRole("row").filter({ has: page.getByText(name, { exact: true }) });
    await row(title).getByRole("button", { name: "编辑", exact: true }).click();
    const edit = page.getByRole("dialog", { name: "编辑 Banner", exact: true });
    await expect(edit.getByRole("img", { name: title, exact: true })).toBeVisible();
    await edit.getByRole("textbox", { name: "标题", exact: true }).fill(editedTitle);
    const editWait = bannerResponse(page, "PATCH", `/${first.homeBannerId}`);
    await edit.getByRole("button", { name: "保存 Banner", exact: true }).click();
    const editedResponse = await editWait;
    expect(editedResponse.status()).toBe(200);
    const edited = HomeBannerMutationSchema.parse((await editedResponse.json()).data);
    expect(await siteWriteBody(page, editedResponse)).toMatchObject({
      lockVersion: first.lockVersion,
      imageFileId,
      title: editedTitle,
    });
    await expect(edit).not.toBeVisible();
    await row(editedTitle).getByRole("button", { name: "停用", exact: true }).click();
    const confirmation = page.getByRole("dialog", { name: "停用 Banner", exact: true });
    await confirmation
      .getByRole("checkbox", { name: "我已核对 Banner 与生效时间", exact: true })
      .check();
    await page.keyboard.press("Tab");
    await expect(confirmation.getByRole("button", { name: "取消", exact: true })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(confirmation.getByRole("button", { name: "确认", exact: true })).toBeFocused();
    const disableWait = bannerResponse(page, "PATCH", `/${first.homeBannerId}`);
    await page.keyboard.press("Enter");
    const disabledResponse = await disableWait;
    expect(disabledResponse.status()).toBe(200);
    expect(await siteWriteBody(page, disabledResponse)).toEqual({
      lockVersion: edited.lockVersion,
      isEnabled: false,
    });
    expect(HomeBannerMutationSchema.parse((await disabledResponse.json()).data).isEnabled).toBe(
      false,
    );
    await expect(confirmation).not.toBeVisible();
    await expect(row(editedTitle).getByText("已停用", { exact: true })).toBeVisible();
    await expect(row(second.title).getByText("已停用", { exact: true })).toBeVisible();
    const allBefore = await unendedBanners(page),
      firstOrderWait = bannerResponse(page, "POST", "/reorder");
    await banners
      .getByRole("button", { name: `拖动排序 ${second.title}`, exact: true })
      .dragTo(banners.getByRole("button", { name: `拖动排序 ${editedTitle}`, exact: true }));
    const orderedResponse = await firstOrderWait;
    expect(orderedResponse.status()).toBe(200);
    const submitted = HomeBannerReorderBodySchema.parse(
      await siteWriteBody(page, orderedResponse),
    ).homeBannerIds;
    expect([...submitted].sort()).toEqual(allBefore.map((item) => item.homeBannerId).sort());
    expect(submitted.slice(0, 2)).toEqual([second.homeBannerId, first.homeBannerId]);
    expect(
      HomeBannerReorderResultSchema.parse((await orderedResponse.json()).data).items.map(
        (item) => item.homeBannerId,
      ),
    ).toEqual(submitted);
    await expect(banners.getByText("Banner 顺序已保存", { exact: true })).toBeVisible();
    // page.request 真实新增，不触碰页面 query cache，以形成真实旧集合。
    const third = await createBanner(page, { ...nextBody, title: `${title.slice(0, -1)}C` });
    owned.push(third.homeBannerId);
    const staleWait = bannerResponse(page, "POST", "/reorder");
    await banners
      .getByRole("button", { name: `拖动排序 ${editedTitle}`, exact: true })
      .dragTo(banners.getByRole("button", { name: `拖动排序 ${second.title}`, exact: true }));
    const stale = await staleWait;
    expect(stale.status()).toBe(409);
    expect(await stale.json()).toMatchObject({
      error: "BANNER_ORDER_STALE",
      details: { missingHomeBannerIds: [third.homeBannerId], unknownHomeBannerIds: [] },
    });
    await expect(
      banners.getByText("排序集合已变化，已重新读取。请核对当前完整列表后重新排序。", {
        exact: true,
      }),
    ).toBeVisible();
    const current = await unendedBanners(page),
      retryWait = bannerResponse(page, "POST", "/reorder");
    await banners
      .getByRole("button", { name: `拖动排序 ${editedTitle}`, exact: true })
      .dragTo(banners.getByRole("button", { name: `拖动排序 ${second.title}`, exact: true }));
    const retry = await retryWait;
    expect(retry.status()).toBe(200);
    expect(retry.request().headers()["idempotency-key"]).not.toBe(
      stale.request().headers()["idempotency-key"],
    );
    const retryIds = HomeBannerReorderBodySchema.parse(
      await siteWriteBody(page, retry),
    ).homeBannerIds;
    expect([...retryIds].sort()).toEqual(current.map((item) => item.homeBannerId).sort());
    expect(retryIds).toEqual(expect.arrayContaining(owned));
    await expect(banners.getByText("Banner 顺序已保存", { exact: true })).toBeVisible();
    await banners.getByRole("heading", { name: "Banner", exact: true }).scrollIntoViewIfNeeded();
    await viewportShots(page, info, "w312-banner-list");
    expect(errors).toEqual([
      "Failed to load resource: the server responded with a status of 409 (Conflict)",
    ]);
  } finally {
    await cleanupBanners(page, owned, baseline);
  }
});
