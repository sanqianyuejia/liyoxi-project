import { randomUUID } from "node:crypto";
import { expect, test, type Browser, type Locator, type Page, type Route } from "@playwright/test";
import {
  AdminDramaDetailSchema,
  AdminDramaWriteResultSchema,
  DictItemListSchema,
  DramaPermitListResultSchema,
  ListingCheckResultSchema,
  MediaReadinessSchema,
  UploadBatchDetailSchema,
  DramaPricePageSchema,
  DramaPriceRevisionPageSchema,
  DramaPriceCreateResultSchema,
  RoleDetailSchema,
  RoleReplaceBodySchema,
  AuthNextSchema,
  StaffMeSchema,
  CopyrightRevisionCreateResultSchema,
  z,
} from "@liyoxi/contract";
import { addDays, calendarDate } from "@liyoxi/shared/time";
import { liveContext, recordErrors } from "./live-context";
import { recordExpectedConflictErrors } from "./w206-helpers";
import { contentFixture, contentVideo, syntheticImage, viewportShots } from "./w312-media";

function headers(action: string) {
  return {
    "X-LYX-Admin": "1",
    Origin: liveContext().origin,
    "Idempotency-Key": `${action}:${randomUUID()}`,
  };
}
async function detail(page: Page, id = contentFixture().dramaId) {
  const response = await page.request.get(`/api/v1/admin/dramas/${id}`);
  expect(response.status()).toBe(200);
  return AdminDramaDetailSchema.parse((await response.json()).data);
}
function writeResponse(page: Page, method: string, path: string) {
  return page.waitForResponse(
    (r) => r.request().method() === method && new URL(r.url()).pathname === path,
  );
}
async function saveDialog(
  page: Page,
  dialog: Locator,
  path: string,
  method: string,
  name = "保存",
) {
  const waiting = writeResponse(page, method, path);
  await dialog.getByRole("button", { name, exact: true }).click();
  const response = await waiting;
  expect(response.status()).toBe(200);
  expect(response.request().headers()["idempotency-key"]).toBeTruthy();
  await expect(dialog).toBeHidden();
  return response;
}
async function select(dialog: Locator, name: string, value: string) {
  await dialog.getByRole("combobox", { name, exact: true }).click();
  await dialog
    .page()
    .locator(".ant-select-dropdown:visible")
    .getByTitle(value, { exact: true })
    .click();
  await dialog.page().keyboard.press("Escape");
}

/** Only this case's real cloud IO is forwarded to its existing signed, owned receiver. */
async function routeContentCloud(page: Page) {
  const f = contentFixture();
  const bridge = z
    .object({
      fixtures: z.object({
        w302: z.object({ scope: z.object({ runId: z.string() }), bridgeOrigin: z.url() }),
      }),
    })
    .parse(liveContext().fixtures).fixtures.w302;
  const origin = new URL(bridge.bridgeOrigin);
  if (
    bridge.scope.runId !== f.scope.runId ||
    origin.protocol !== "http:" ||
    origin.hostname !== "127.0.0.1" ||
    !origin.port ||
    origin.pathname !== "/" ||
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash
  )
    throw new Error("Content cloud bridge is outside this exact owned run");
  const patterns = [
    "https://test-media-1250000000.cos.ap-test-1.myqcloud.com/**",
    "https://fake-storage.invalid/**",
  ];
  const forward = async (route: Route) => {
    const original = new URL(route.request().url()),
      target = new URL(origin);
    target.pathname =
      original.hostname === "fake-storage.invalid"
        ? `/fake-read${original.pathname}`
        : original.pathname;
    target.search = original.search;
    const response = await route.fetch({ url: target.toString() });
    await route.fulfill({ response });
  };
  for (const pattern of patterns) await page.route(pattern, forward);
  return async () => {
    for (const pattern of patterns) await page.unroute(pattern, forward);
  };
}

/** Real focus first; headless fallback only controls the visibility dependency, never query data. */
async function refreshVisibleDetail(page: Page, path: string, version: number) {
  const descriptor = await page.evaluateHandle(() =>
    Object.getOwnPropertyDescriptor(document, "visibilityState"),
  );
  const background = await page.context().newPage();
  let probed = false;
  const restore = async () => {
    if (probed)
      await page.evaluate((saved) => {
        if (saved) Object.defineProperty(document, "visibilityState", saved);
        else Reflect.deleteProperty(document, "visibilityState");
        document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));
      }, descriptor);
  };
  try {
    await background.goto("about:blank");
    await background.bringToFront();
    const hidden = await page.evaluate(() => document.visibilityState === "hidden");
    if (!hidden) {
      probed = true;
      await page.evaluate(() => {
        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          get: () => "hidden",
        });
        document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));
      });
    }
    test.info().annotations.push({
      type: "w312-focus-mode",
      description: hidden
        ? "browser tab hidden/restored"
        : "headless visibility dependency probe; not physical tab switching",
    });
    const pending = page.waitForResponse(
      (response) =>
        response.request().method() === "GET" && new URL(response.url()).pathname === path,
    );
    await page.bringToFront();
    await restore();
    const response = await pending;
    expect(response.status()).toBe(200);
    expect(AdminDramaDetailSchema.parse((await response.json()).data).lockVersion).toBe(version);
  } finally {
    await restore();
    await descriptor.dispose();
    await background.close();
  }
}
async function contentViewerContext(browser: Browser) {
  const live = liveContext();
  const credentials = z
    .object({
      fixtures: z.object({
        w207: z.object({
          viewer: z.object({
            phone: z.string(),
            password: z.string(),
            w312RecoveryCode: z.string(),
          }),
        }),
      }),
    })
    .parse(live.fixtures).fixtures.w207.viewer;
  // Synthetic source through the existing trusted loopback chain, not a physical client IP.
  const source = { "X-Forwarded-For": "192.0.2.212" };
  const requestHeaders = {
    ...source,
    "Content-Type": "application/json",
    "X-LYX-Admin": "1",
    Origin: live.origin,
  };
  // Native fetch keeps this isolated fake credential out of browser traces and screenshots.
  const login = await fetch(`${live.origin}/api/v1/admin/auth/login`, {
    method: "POST",
    headers: requestHeaders,
    body: JSON.stringify({ phone: credentials.phone, password: credentials.password }),
  });
  expect(login.status).toBe(200);
  const next = AuthNextSchema.parse((await login.json()).data);
  expect(next.ticket).toBeTruthy();
  const verified = await fetch(`${live.origin}/api/v1/admin/auth/verify-mfa`, {
    method: "POST",
    headers: {
      ...requestHeaders,
      Cookie: login.headers
        .getSetCookie()
        .map((value) => value.split(";")[0])
        .join("; "),
    },
    body: JSON.stringify({
      ticket: next.ticket,
      method: "recovery",
      code: credentials.w312RecoveryCode,
    }),
  });
  expect(verified.status).toBe(200);
  const cookies = verified.headers.getSetCookie().map((header) => {
    const pair = header.split(";")[0]!,
      at = pair.indexOf("=");
    return {
      name: pair.slice(0, at),
      value: pair.slice(at + 1),
      domain: new URL(live.origin).hostname,
      path: "/",
      expires: -1,
      httpOnly: /httponly/i.test(header),
      secure: /;\s*secure/i.test(header),
      sameSite: "Lax" as const,
    };
  });
  return browser.newContext({
    baseURL: live.origin,
    viewport: { width: 1366, height: 768 },
    extraHTTPHeaders: source,
    storageState: { cookies, origins: [] },
  });
}

test("W312 短剧库真实分页URL、返回状态与创建草稿", async ({ page }, info) => {
  const f = contentFixture(),
    errors = recordErrors(page);
  await page.goto(`/dramas?q=${encodeURIComponent(f.query)}&pageSize=10&tab=draft`);
  await expect(page.getByRole("heading", { name: "短剧库", exact: true })).toBeVisible();
  const table = page.getByRole("region", { name: "短剧列表", exact: true }).getByRole("table");
  await expect(table.locator("tbody tr")).toHaveCount(10);
  await viewportShots(page, info, "w312-drama-list");
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(table.locator("tbody tr")).toHaveCount(3);
  const firstVisibleTitle = await table
    .locator("tbody tr")
    .nth(0)
    .locator(".drama-list-title strong")
    .textContent();
  expect(firstVisibleTitle).toBeTruthy();
  await table
    .locator("tbody tr")
    .filter({ hasText: firstVisibleTitle! })
    .getByRole("button", { name: "编辑 / 查看", exact: true })
    .click();
  await expect(page.getByRole("button", { name: "返回短剧列表", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "返回短剧列表", exact: true }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(table.locator("tbody tr")).toHaveCount(3);
  await page.getByRole("button", { name: "新建短剧", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "新建短剧", exact: true });
  await dialog
    .getByRole("textbox", { name: "剧名", exact: true })
    .fill(`页面${f.scope.runId.slice(0, 6)}-新增`);
  await page.keyboard.press("Tab");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await page.getByRole("button", { name: "新建短剧", exact: true }).click();
  const fresh = page.getByRole("dialog", { name: "新建短剧", exact: true });
  await fresh
    .getByRole("textbox", { name: "剧名", exact: true })
    .fill(`页面${f.scope.runId.slice(0, 6)}-新增`);
  const response = await saveDialog(page, fresh, "/api/v1/admin/dramas", "POST", "创建草稿");
  const created = AdminDramaWriteResultSchema.parse((await response.json()).data);
  await expect(page).toHaveURL(new RegExp(`/dramas/${created.dramaId}`));
  expect((await detail(page, created.dramaId)).status).toBe("draft");
  expect(errors).toEqual([]);
});

test("W312 五页内容主流程：真实原片批次、许可版权源文件、预告片、十四检查与上下架", async ({
  page,
}, info) => {
  test.setTimeout(180_000);
  const f = contentFixture(),
    errors = recordErrors(page),
    base = `/api/v1/admin/dramas/${f.dramaId}`;
  const stopCloud = await routeContentCloud(page);
  try {
    await page.goto(`/dramas/${f.dramaId}?tab=basic`);
    await page.getByRole("button", { name: "编辑基础信息", exact: true }).click();
    const basic = page.getByRole("dialog", { name: "编辑基础信息", exact: true });
    await basic.locator('input[type="file"]').setInputFiles(syntheticImage("虚构封面.png"));
    await expect(basic.getByText("已引用封面文件", { exact: true })).toBeVisible({
      timeout: 120_000,
    });
    const dictResponse = await page.request.get("/api/v1/admin/dict-items?typeKey=genre");
    expect(dictResponse.status()).toBe(200);
    const genre = DictItemListSchema.parse((await dictResponse.json()).data).items.find(
      (v) => v.isEnabled,
    );
    expect(genre).toBeDefined();
    await select(basic, "题材", genre!.name);
    await basic.getByRole("textbox", { name: "出品方", exact: true }).fill("隔离虚构出品方");
    await viewportShots(page, info, "w312-drama-basic-dialog");
    await saveDialog(page, basic, `${base}/basic`, "PATCH");
    await viewportShots(page, info, "w312-drama-edit");

    await page.getByRole("tab", { name: "原片 / 剧集", exact: true }).click();
    await page.getByRole("button", { name: "上传 / 替换原片", exact: true }).click();
    const batchDialog = page.getByRole("dialog", { name: "上传 / 替换原片", exact: true });
    await batchDialog
      .getByLabel("选择原片文件", { exact: true })
      .setInputFiles([contentVideo("第1集.mp4"), contentVideo("第2集.mp4")]);
    const createdWait = writeResponse(page, "POST", "/api/v1/admin/upload-batches");
    await batchDialog.getByRole("button", { name: "建立批次并核对集号", exact: true }).click();
    const createdResponse = await createdWait;
    expect(createdResponse.status()).toBe(200);
    const created = UploadBatchDetailSchema.parse((await createdResponse.json()).data);
    expect(created).toMatchObject({
      purpose: "drama_master",
      targetId: f.dramaId,
      expectedCount: 2,
    });
    expect(created.coverage.missingEpisodeNos).toEqual([]);
    expect(created.coverage.duplicateEpisodeNos).toEqual([]);
    const sequence = batchDialog.getByRole("checkbox", {
      name: "我已逐集核对顺序建议",
      exact: true,
    });
    if (await sequence.count()) await sequence.check();
    await batchDialog.getByRole("button", { name: "确认匹配并开始", exact: true }).click();
    await batchDialog.getByRole("button", { name: "上传 / 继续上传", exact: true }).click();
    await expect
      .poll(
        async () => {
          const response = await page.request.get(
            `/api/v1/admin/upload-batches/${created.uploadBatchId}`,
          );
          expect(response.status()).toBe(200);
          return UploadBatchDetailSchema.parse((await response.json()).data).counts.uploaded;
        },
        { timeout: 120_000 },
      )
      .toBe(2);
    await batchDialog
      .locator(".lyx-confirm__footer")
      .getByRole("button", { name: "关闭", exact: true })
      .click();
    await page.reload();
    await page.getByRole("button", { name: "上传 / 替换原片", exact: true }).click();
    const reopened = page.getByRole("dialog", { name: "上传 / 替换原片", exact: true });
    await reopened.getByRole("combobox", { name: "恢复已有原片批次", exact: true }).click();
    const dropdown = page.locator(".ant-select-dropdown:visible");
    const batchOption = dropdown.getByRole("option").filter({ hasText: created.uploadBatchId });
    await expect(batchOption).toHaveText(created.uploadBatchId);
    const accessibleName = await batchOption.getAttribute("aria-label");
    expect(accessibleName).toBeTruthy();
    await expect(dropdown.getByRole("option", { name: accessibleName!, exact: true })).toHaveText(
      created.uploadBatchId,
    );
    const visibleOption = dropdown.getByTitle(accessibleName!, { exact: true });
    await expect(visibleOption).toHaveCount(1);
    await expect(visibleOption).toBeVisible();
    const recoveredWait = writeResponse(
      page,
      "GET",
      `/api/v1/admin/upload-batches/${created.uploadBatchId}`,
    );
    await visibleOption.click();
    const recoveredResponse = await recoveredWait;
    expect(recoveredResponse.status()).toBe(200);
    const recovered = UploadBatchDetailSchema.parse((await recoveredResponse.json()).data);
    expect(recovered.uploadBatchId).toBe(created.uploadBatchId);
    expect(recovered.expectedCount).toBe(2);
    expect(recovered.counts.uploaded).toBe(2);
    expect(recovered.items.map((item) => item.episodeNo).sort()).toEqual([1, 2]);
    await expect(reopened.getByRole("button", { name: "提交原片批次", exact: true })).toBeVisible({
      timeout: 120_000,
    });
    await viewportShots(page, info, "w312-master-ready");
    const committedWait = writeResponse(
      page,
      "POST",
      `/api/v1/admin/upload-batches/${created.uploadBatchId}/commit`,
    );
    await reopened.getByRole("button", { name: "提交原片批次", exact: true }).click();
    expect((await committedWait).status()).toBe(200);
    await expect(reopened).toBeHidden();
    const readinessResponse = await page.request.get(`${base}/media-readiness`);
    expect(readinessResponse.status()).toBe(200);
    expect(
      MediaReadinessSchema.parse((await readinessResponse.json()).data).masters.withCurrentMaster,
    ).toBe(2);

    await page.getByRole("tab", { name: "许可信息", exact: true }).click();
    await page.getByRole("button", { name: "新增许可", exact: true }).click();
    const permit = page.getByRole("dialog", { name: "新增许可", exact: true });
    await select(permit, "编号类型", "节目编号");
    await permit
      .getByRole("textbox", { name: "许可编号", exact: true })
      .fill(`W312TEST${f.scope.runId.slice(0, 6)}`);
    await permit.locator('input[type="file"]').setInputFiles(syntheticImage("虚构许可扫描件.png"));
    await expect(permit.getByRole("button", { name: "本次上传扫描件", exact: true })).toBeVisible({
      timeout: 120_000,
    });
    await saveDialog(page, permit, `${base}/drama-permits`, "POST");
    const permitsResponse = await page.request.get(`${base}/drama-permits`);
    expect(permitsResponse.status()).toBe(200);
    const permits = DramaPermitListResultSchema.parse((await permitsResponse.json()).data);
    expect(permits.items).toHaveLength(1);
    expect(permits.items[0]!.scanFiles).toHaveLength(1);
    await page.getByRole("tab", { name: "版权信息", exact: true }).click();
    await page.getByRole("button", { name: "编辑版权信息", exact: true }).click();
    const copyright = page.getByRole("dialog", { name: "保存版权信息", exact: true });
    await copyright.locator('input[type="file"]').setInputFiles(syntheticImage("虚构版权证明.png"));
    await expect(copyright.getByRole("button", { name: "本次上传证明", exact: true })).toBeVisible({
      timeout: 120_000,
    });
    await saveDialog(page, copyright, `${base}/copyright`, "PUT");
    await page.getByRole("tab", { name: "基础信息", exact: true }).click();
    await page.getByRole("button", { name: "上传预告片", exact: true }).click();
    const trailer = page.getByRole("dialog", { name: "上传目标预告片", exact: true });
    await trailer.locator('input[type="file"]').setInputFiles(contentVideo("虚构预告片.mp4"));
    await expect(trailer.getByRole("button", { name: "设置并转换", exact: true })).toBeEnabled({
      timeout: 120_000,
    });
    await saveDialog(page, trailer, `${base}/trailer`, "PUT", "设置并转换");
    await expect
      .poll(async () => (await detail(page)).trailer?.state, { timeout: 120_000 })
      .toBe("ready");
    await page.getByRole("button", { name: "刷新详情", exact: true }).click();
    await page.getByRole("button", { name: "预览目标源文件", exact: true }).click();
    await expect(page.locator(".content-source-preview video")).toBeVisible();
    await page.getByRole("button", { name: "刷新播放签名", exact: true }).click();
    const checksResponse = await page.request.get(`${base}/listing-checks`);
    expect(checksResponse.status()).toBe(200);
    const checks = ListingCheckResultSchema.parse((await checksResponse.json()).data);
    expect(checks.items).toHaveLength(14);
    expect(checks.isShelvable).toBe(true);
    await page.getByRole("button", { name: "上架", exact: true }).click();
    const listing = page.getByRole("dialog", { name: "核对并上架", exact: true });
    await expect(listing.locator(".content-checks li")).toHaveCount(14);
    await listing.getByRole("checkbox").check();
    await saveDialog(page, listing, `${base}/shelve`, "POST", "确认上架");
    expect((await detail(page)).status).toBe("listed");
    await page.getByRole("button", { name: "下架", exact: true }).click();
    const delisting = page.getByRole("dialog", { name: "下架短剧", exact: true });
    await delisting.getByRole("checkbox").check();
    await saveDialog(page, delisting, `${base}/delist`, "POST", "确认下架");
    expect((await detail(page)).status).toBe("delisted");
    expect(errors).toEqual([]);
  } finally {
    await stopCloud();
  }
});

test("W312 基础编辑固定CAS：真实刷新不把旧草稿变成新版本覆盖", async ({ page }, info) => {
  const f = contentFixture(),
    id = f.scope.dramaIds[1]!,
    path = `/api/v1/admin/dramas/${id}/basic`;
  const errors = recordExpectedConflictErrors(page),
    original = await detail(page, id);
  await page.goto(`/dramas/${id}?tab=basic`);
  await page.getByRole("button", { name: "编辑基础信息", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "编辑基础信息", exact: true });
  await dialog.getByRole("textbox", { name: "剧名", exact: true }).fill(`${f.query}旧草稿`);
  const concurrent = await page.request.patch(path, {
    headers: headers("w312-concurrent-basic"),
    data: { lockVersion: original.lockVersion, title: `${f.query}并发新值` },
  });
  expect(concurrent.status()).toBe(200);
  await refreshVisibleDetail(page, `/api/v1/admin/dramas/${id}`, original.lockVersion + 1);
  await expect(page.getByRole("heading", { name: `${f.query}并发新值`, exact: true })).toHaveText(
    `${f.query}并发新值`,
  );
  const responseWait = writeResponse(page, "PATCH", path);
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  const conflict = await responseWait;
  errors.allow(conflict, path);
  await expect(
    dialog.getByText(
      "当前资料已经变化。草稿保留；请另存核对后关闭并重新打开，不能直接用新版本覆盖。",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "剧名", exact: true })).toHaveValue(
    `${f.query}旧草稿`,
  );
  expect((await detail(page, id)).title).toBe(`${f.query}并发新值`);
  await viewportShots(page, info, "w312-drama-version-conflict");
  await dialog
    .locator(".lyx-confirm__footer")
    .getByRole("button", { name: "取消", exact: true })
    .click();
  await page.getByRole("button", { name: "编辑基础信息", exact: true }).click();
  await expect(
    page.getByRole("dialog").getByRole("textbox", { name: "剧名", exact: true }),
  ).toHaveValue(`${f.query}并发新值`);
  await page.keyboard.press("Escape");
  expect(errors.unexpected()).toEqual([]);
});

test("W312 单剧积分价真实P确认、指定明日、记录与撤销，模板只读", async ({ page }, info) => {
  const f = contentFixture(),
    errors = recordErrors(page);
  await page.goto(`/billing/pricing?q=${encodeURIComponent(f.title)}`);
  await expect(page.getByRole("heading", { name: "单剧积分价", exact: true })).toBeVisible();
  const rowsResponse = await page.request.get(
    `/api/v1/admin/drama-prices?q=${encodeURIComponent(f.title)}`,
  );
  expect(rowsResponse.status()).toBe(200);
  const row = DramaPricePageSchema.parse((await rowsResponse.json()).data).items.find(
    (v) => v.dramaId === f.dramaId,
  );
  expect(row).toBeDefined();
  const table = page.getByRole("region", { name: "单剧积分价", exact: true }).getByRole("table");
  await table.getByRole("button", { name: "调价", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: `调整积分价 · ${f.title}`, exact: true });
  await dialog
    .getByRole("spinbutton", { name: "新积分价（整数，至少100）", exact: true })
    .fill(String(Math.max(100, (row!.listPricePoints ?? 100) + 100)));
  await dialog.getByRole("radio", { name: "指定日期 00:00（北京时间）", exact: true }).check();
  const date = dialog.getByRole("textbox", { name: "生效日期", exact: true });
  await date.fill(addDays(calendarDate(new Date()), 1));
  await date.press("Enter");
  await dialog.getByRole("checkbox").check();
  await viewportShots(page, info, "w312-pricing-dialog");
  const response = await saveDialog(
    page,
    dialog,
    `/api/v1/admin/dramas/${f.dramaId}/drama-price-revisions`,
    "POST",
    "确认提交调价",
  );
  const result = DramaPriceCreateResultSchema.parse((await response.json()).data);
  expect(result.revision.prevPoints).toBe(row!.listPricePoints);
  await viewportShots(page, info, "w312-pricing");
  await page.getByRole("tab", { name: "调价记录", exact: true }).click();
  const historyResponse = await page.request.get(
    `/api/v1/admin/drama-price-revisions?dramaId=${f.dramaId}`,
  );
  expect(historyResponse.status()).toBe(200);
  const history = DramaPriceRevisionPageSchema.parse((await historyResponse.json()).data);
  expect(
    history.items.some((v) => v.dramaPriceRevisionId === result.revision.dramaPriceRevisionId),
  ).toBe(true);
  const historyRow = page
    .locator("tbody tr")
    .filter({ hasText: f.title })
    .filter({ hasText: "待生效" });
  await historyRow.getByRole("button", { name: "撤销", exact: true }).click();
  const withdraw = page.getByRole("dialog", { name: "撤销待生效调价", exact: true });
  await saveDialog(
    page,
    withdraw,
    `/api/v1/admin/drama-price-revisions/${result.revision.dramaPriceRevisionId}/withdraw`,
    "POST",
    "确认撤销",
  );
  await expect(page.locator("tbody tr").filter({ hasText: f.title })).toContainText("已撤销");
  await page.getByRole("tab", { name: "等级模板（只读）", exact: true }).click();
  await expect(
    page.getByText("模板仅查看。模板批量管理随 M4 开放，本页不提供伪执行入口。", { exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("W312 上过架版权走独立修订锁、原止日确认与真实新证明", async ({ page }, info) => {
  const f = contentFixture(),
    errors = recordErrors(page),
    original = await detail(page);
  expect(original.copyright.proofFiles).toHaveLength(1);
  expect(original.copyright.editMode).toBe("revision");
  await page.goto(`/dramas/${f.dramaId}?tab=copyright`);
  await page.getByRole("button", { name: "提交版权变更", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "提交版权变更", exact: true });
  await expect(dialog).toContainText(`原授权止日 ${original.copyright.licenseEndDate}`);
  await select(dialog, "变更类型", "资料更正");
  await dialog.getByRole("textbox", { name: "地域", exact: true }).fill("中国大陆（虚构验收更正）");
  await dialog
    .getByRole("textbox", { name: "变更原因", exact: true })
    .fill("本轮虚构权属资料更正，不涉及真实内容发布");
  await dialog.locator('input[type="file"]').setInputFiles(syntheticImage("虚构版权修订依据.png"));
  await expect(dialog.getByRole("button", { name: "本次上传证明", exact: true })).toBeVisible({
    timeout: 120_000,
  });
  await dialog
    .getByRole("checkbox", {
      name: `已核对原止日 ${original.copyright.licenseEndDate}；确认以当前草稿提交新版权快照`,
      exact: true,
    })
    .check();
  await viewportShots(page, info, "w312-copyright-revision");
  const response = await saveDialog(
    page,
    dialog,
    `/api/v1/admin/dramas/${f.dramaId}/drama-copyright-revisions`,
    "POST",
  );
  const result = CopyrightRevisionCreateResultSchema.parse((await response.json()).data);
  expect(result.revision.changeKind).toBe("correction");
  expect(result.revision.prevEndDate).toBe(original.copyright.licenseEndDate);
  expect(result.revision.newEndDate).toBe(original.copyright.licenseEndDate);
  expect(result.revision.snapshot.territory).toBe("中国大陆（虚构验收更正）");
  expect(result.revision.proofFiles).toHaveLength(1);
  expect(result.drama.copyright.lockVersion).toBeGreaterThan(original.copyright.lockVersion);
  expect(result.drama.copyright.currentRevisionId).toBe(result.revision.dramaCopyrightRevisionId);
  expect(errors).toEqual([]);
});

test("W312 真实财务身份v只读与e独立权限关闭，服务端拒绝且finally恢复完整角色", async ({
  browser,
  page,
}, info) => {
  const f = contentFixture(),
    rolePath = "/api/v1/admin/roles/finance";
  const readRole = async () => {
    const response = await page.request.get(rolePath);
    expect(response.status()).toBe(200);
    return RoleDetailSchema.parse((await response.json()).data);
  };
  const original = await readRole();
  const replaceRole = async (level: "v" | "e") => {
    const current = await readRole();
    const body = RoleReplaceBodySchema.parse({
      moduleLevels: { ...original.moduleLevels, drama: level, billing: level, ops: level },
      actions: Object.fromEntries(
        Object.entries(original.actions).map(([key, value]) => [key, { ...value, on: false }]),
      ),
      dataScope: original.dataScope,
      lockVersion: current.lockVersion,
    });
    const response = await page.request.put(rolePath, {
      headers: headers("w312-permission-role"),
      data: body,
    });
    expect(response.status()).toBe(200);
  };
  let context: Awaited<ReturnType<typeof contentViewerContext>> | undefined;
  try {
    await replaceRole("v");
    context = await contentViewerContext(browser);
    const viewer = await context.newPage(),
      errors = recordErrors(viewer);
    const readMe = async () => {
      const response = await viewer.request.get("/api/v1/admin/auth/me");
      expect(response.status()).toBe(200);
      return StaffMeSchema.parse((await response.json()).data);
    };
    expect((await readMe()).moduleLevels.drama).toBe("v");
    await viewer.goto(`/dramas/${f.dramaId}?tab=basic`);
    await expect(viewer.getByRole("button", { name: "编辑基础信息", exact: true })).toHaveCount(0);
    await viewer.goto(`/billing/pricing?q=${encodeURIComponent(f.title)}`);
    await expect(viewer.getByRole("heading", { name: "单剧积分价", exact: true })).toBeVisible();
    await expect(viewer.getByRole("button", { name: "调价", exact: true })).toHaveCount(0);
    await viewportShots(viewer, info, "w312-pricing-readonly");
    await replaceRole("e");
    const me = await readMe();
    expect(me.moduleLevels.drama).toBe("e");
    expect(me.permissions).not.toContain("drama.copyright.revise");
    expect(me.permissions).not.toContain("billing.price.edit");
    await viewer.goto(`/dramas/${f.dramaId}?tab=basic`);
    await expect(viewer.getByRole("button", { name: "编辑基础信息", exact: true })).toBeVisible();
    await viewer.getByRole("tab", { name: "版权信息", exact: true }).click();
    await expect(viewer.getByRole("button", { name: "提交版权变更", exact: true })).toHaveCount(0);
    const current = await detail(viewer),
      copyright = current.copyright;
    expect(copyright.proofFiles).toHaveLength(1);
    const denied = await viewer.request.post(
      `/api/v1/admin/dramas/${f.dramaId}/drama-copyright-revisions`,
      {
        headers: headers("w312-denied-copyright"),
        data: {
          lockVersion: copyright.lockVersion,
          changeKind: "correction",
          copyright: {
            source: copyright.source,
            platforms: copyright.platforms,
            territory: copyright.territory,
            hasNetworkRight: copyright.hasNetworkRight,
            canSublicense: copyright.canSublicense,
            canEditEmbed: copyright.canEditEmbed,
            canAdapt: copyright.canAdapt,
            licenseStartDate: copyright.licenseStartDate,
            licenseEndDate: copyright.licenseEndDate,
            proofFileIds: copyright.proofFiles.map((file) => file.fileId),
          },
          reason: "虚构未授权请求必须拒绝",
          revisionProofFileIds: [copyright.proofFiles[0]!.fileId],
          confirm: { prevEndDate: copyright.licenseEndDate },
        },
      },
    );
    expect(denied.status()).toBe(403);
    const deniedPrice = await viewer.request.post(
      `/api/v1/admin/dramas/${f.dramaId}/drama-price-revisions`,
      {
        headers: headers("w312-denied-price"),
        data: {
          mode: "custom",
          customPoints: 100,
          effectiveDate: null,
          reasonCode: "quality",
          confirm: { currentPoints: current.pricing.listPricePoints },
        },
      },
    );
    expect(deniedPrice.status()).toBe(403);
    await viewer.goto(`/billing/pricing?q=${encodeURIComponent(f.title)}`);
    await expect(viewer.getByRole("button", { name: "调价", exact: true })).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    try {
      const current = await readRole();
      const body = RoleReplaceBodySchema.parse({
        moduleLevels: original.moduleLevels,
        actions: original.actions,
        dataScope: original.dataScope,
        lockVersion: current.lockVersion,
      });
      const restored = await page.request.put(rolePath, {
        headers: headers("w312-restore-role"),
        data: body,
      });
      expect(restored.status()).toBe(200);
      const actual = await readRole();
      expect(actual.moduleLevels).toEqual(original.moduleLevels);
      expect(actual.actions).toEqual(original.actions);
      expect(actual.dataScope).toBe(original.dataScope);
    } finally {
      await context?.close();
    }
  }
});
