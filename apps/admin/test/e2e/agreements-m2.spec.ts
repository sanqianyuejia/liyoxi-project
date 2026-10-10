// Explicit UI samples only. The separate live spec uses actual handlers and stored bytes.
import { expect, test, type Page, type Route } from "@playwright/test";
import type {
  AgreementDetail,
  ConsentDetail,
  Version,
} from "../../src/features/ops/agreements/api";
import { AGREEMENT_KEYS } from "../../src/features/ops/agreements/model";
import { createSampleBackend } from "../../src/dev/sample-backend";
import { shot } from "./w206-helpers";

const id = "01910000-0000-7000-8000-000000000216";
const fileId = "01910000-0000-7000-8000-000000000217";
const names = [
  "用户协议",
  "隐私政策",
  "成员使用协议",
  "积分规则",
  "定制剧许可协议",
  "广告服务协议",
];
function version(patch: Partial<Version> = {}): Version {
  return {
    agreementVersionId: id,
    agreementKey: "user",
    major: 1,
    minor: 1,
    versionLabel: "v1.1",
    status: "draft",
    displayStatus: "draft",
    effectiveAt: "2026-12-01T01:00:00.000Z",
    summary: "虚构测试变更",
    isReconsentRequired: true,
    isLegalApproved: true,
    sourceFile: null,
    pdfFile: null,
    hasContentHtml: true,
    contentSha256: "a".repeat(64),
    siteNoticeId: null,
    shortNoticeReason: null,
    expectedConsents: null,
    activatedAt: null,
    createdBy: {
      staffId: id,
      name: "虚构员工",
      staffNo: 1001,
      roleKey: "super_admin",
      isLead: false,
      status: "active",
    },
    publishedBy: null,
    lockVersion: 4,
    createdAt: "2026-10-09T00:00:00.000Z",
    updatedAt: "2026-10-09T00:00:00.000Z",
    actions: ["edit", "schedule"],
    ...patch,
  };
}
function detail(key = "user", draft = false): AgreementDetail {
  const v = version({ agreementKey: key });
  return {
    agreementKey: key,
    name: names[AGREEMENT_KEYS.findIndex((k) => k === key)] ?? "未来协议",
    subjectKind: "user",
    consentMode: "checkbox",
    scenes: ["login"],
    signSceneLabel: "登录时签署",
    audienceLabel: "平台用户",
    sinceVersion: "V1.0",
    currentVersion: null,
    pendingVersion: null,
    draftVersion: draft ? v : null,
    versions: draft ? [v] : [],
    currentContentHtml: null,
    draftContentHtml: draft ? "<p>虚构草稿正文</p>" : null,
    reconsentProgress: null,
  };
}
function evidence(): ConsentDetail {
  return {
    agreementConsentId: id,
    consentNo: "216",
    agreementKey: "user",
    agreementName: "用户协议",
    agreementVersionId: id,
    versionLabel: "v1.1",
    scene: "login",
    method: "checkbox",
    merchantUserId: id,
    entityId: null,
    storeId: null,
    entityName: null,
    storeName: null,
    role: null,
    operatorNameMask: "虚*",
    phoneMask: "138****0216",
    usccMask: null,
    bizType: null,
    bizId: null,
    bizNo: null,
    consentedAt: "2026-10-09T00:00:00.000Z",
    createdAt: "2026-10-09T00:00:00.000Z",
    contentSha256: "a".repeat(64),
    ipMask: "127.0.*.*",
    appid: null,
    hasOpenidSnapshot: true,
    userAgent: "fictional 13800130216 Bearer must-not-display",
    device: { model: "虚构设备", appVersion: "1.0.0" },
    requestId: id,
    isContentHashConsistent: false,
    revealableFields: ["phone"],
  };
}
async function ok(route: Route, data: unknown) {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ code: 0, message: "ok", data }),
  });
}
async function serve(page: Page, own: (route: Route, path: string) => Promise<boolean>) {
  const backend = createSampleBackend();
  await page.route("**/api/v1/admin/**", async (route) => {
    const r = route.request(),
      url = new URL(r.url());
    if (await own(route, url.pathname)) return;
    if (url.pathname === "/api/v1/admin/agreements") {
      await ok(route, {
        items: [...AGREEMENT_KEYS.map((k) => detail(k)), detail("partner")],
        page: 1,
        pageSize: 20,
        total: 7,
      });
      return;
    }
    const key = url.pathname.match(/^\/api\/v1\/admin\/agreements\/([^/]+)$/)?.[1];
    if (key && r.method() === "GET") {
      await ok(route, detail(key));
      return;
    }
    const response = backend.handle({
      method: r.method(),
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      headers: r.headers(),
      body: r.postDataJSON(),
    });
    await route.fulfill({
      status: response.status,
      contentType: "application/json",
      body: JSON.stringify(response.body),
    });
  });
}

test("W216 六协议主从、服务器生效phase和安全正文，不显示未来partner", async ({ page }) => {
  await serve(page, async (route, path) => {
    if (path !== "/api/v1/admin/agreements/user") return false;
    const v = version({ status: "pending", displayStatus: "active", actions: [], pdfFile: null });
    await ok(route, {
      ...detail(),
      currentVersion: v,
      versions: [v],
      currentContentHtml: "<p>服务器当前正文</p><script>parent.__unsafe=true</script>",
    });
    return true;
  });
  await page.goto("/ops/agreements?agreementKey=user&unknown=drop");
  await expect(page.getByRole("heading", { name: "协议管理", exact: true })).toBeVisible();
  await expect(page.locator(".lyx-agreement-card")).toHaveCount(6);
  await expect(page.getByText("未来协议", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "版本历史" })).toContainText("生效中");
  await expect(page.getByRole("button", { name: "撤回", exact: true })).toHaveCount(0);
  const frame = page.locator('iframe[title="协议正文预览"]');
  await expect(frame).toHaveAttribute("sandbox", "");
  await expect(frame.contentFrame().getByText("服务器当前正文")).toBeVisible();
  expect(await page.evaluate(() => "__unsafe" in window)).toBe(false);
  await shot(page, "agreements-01-master-detail");
});

test("W216 草稿默认法务off、日期Tab/Esc与真实锁版本字段，转换警告保留", async ({ page }) => {
  const writes: { key: string | undefined; body: unknown }[] = [];
  await serve(page, async (route, path) => {
    if (path === "/api/v1/admin/agreements/user") {
      await ok(route, detail("user", true));
      return true;
    }
    if (path === `/api/v1/admin/agreement-versions/${id}`) {
      writes.push({
        key: route.request().headers()["idempotency-key"],
        body: route.request().postDataJSON(),
      });
      await ok(route, {
        version: version({ lockVersion: 4 + writes.length }),
        contentHtml: "<p>转换后的虚构正文</p>",
        conversion: {
          state: "converted",
          warnings: [{ code: "text_mismatch", similarityBp: 7500 }],
        },
      });
      return true;
    }
    return false;
  });
  await page.goto("/ops/agreements?agreementKey=user");
  await page.getByRole("button", { name: "编辑草稿", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "编辑草稿 v1.1", exact: true });
  await expect(
    dialog.getByRole("checkbox", { name: "我确认本次正文已完成法务审核", exact: true }),
  ).not.toBeChecked();
  const date = dialog.getByRole("textbox", { name: "生效日期（北京时间）", exact: true });
  await expect(dialog.getByText("当前生效日期：2026-12-01", { exact: true })).toBeVisible();
  await date.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".ant-picker-dropdown:visible")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page.locator(".ant-picker-dropdown:visible")).toHaveCount(0);
  await page.keyboard.press("Tab");
  await expect(dialog.getByLabel("生效时刻（北京时间）", { exact: true })).toBeFocused();
  await dialog.getByRole("textbox", { name: "变更摘要", exact: true }).fill("仅样例编辑测试");
  await shot(page, "agreements-02-editor-legal-off", "编辑草稿 v1.1");
  await dialog.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(
    dialog.getByText("Word 与 PDF 的文本相似度为 75.00%，请人工核对差异。", { exact: true }),
  ).toBeVisible();
  expect(writes).toHaveLength(1);
  expect(writes[0]?.body).toMatchObject({
    lockVersion: 4,
    summary: "仅样例编辑测试",
    isLegalApproved: false,
  });
  expect(writes[0]?.key).toMatch(/^agreement:/);
  // Existing values must be truly clearable, rather than only a visual placeholder.
  await date.fill("");
  await date.press("Enter");
  await date.press("Tab");
  await dialog.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect.poll(() => writes.length).toBe(2);
  expect(writes[1]?.body).toMatchObject({ lockVersion: 5, effectiveAt: null });
  await date.fill("2026-12-02");
  await date.press("Enter");
  await date.press("Tab");
  await dialog.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect.poll(() => writes.length).toBe(3);
  expect(writes[2]?.body).toMatchObject({
    lockVersion: 6,
    effectiveAt: "2026-12-02T01:00:00.000Z",
  });
  await dialog.getByRole("button", { name: "清除生效日期", exact: true }).click();
  await expect(dialog.getByText("当前生效日期：未设置", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect.poll(() => writes.length).toBe(4);
  expect(writes[3]?.body).toMatchObject({ lockVersion: 7, effectiveAt: null });
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(
    page.getByText("Word 与 PDF 的文本相似度为 75.00%，请人工核对差异。", { exact: true }),
  ).toBeVisible();
});

test("W216 同意分页/筛选、历史摘要告警及脱敏证据，PDF每次现签", async ({ page }) => {
  let signatures = 0;
  const queries: URLSearchParams[] = [];
  await page.addInitScript(() => {
    window.open = () => null;
  });
  await serve(page, async (route, path) => {
    if (path === "/api/v1/admin/agreement-consents") {
      const qs = new URL(route.request().url()).searchParams;
      queries.push(qs);
      await ok(route, {
        items: [evidence()],
        total: 21,
        page: Number(qs.get("page") ?? 1),
        pageSize: 20,
      });
      return true;
    }
    if (path === `/api/v1/admin/agreement-consents/${id}`) {
      await ok(route, evidence());
      return true;
    }
    if (path === "/api/v1/admin/agreements/user") {
      const v = version({
        pdfFile: {
          fileId,
          originalName: "虚构历史.pdf",
          mime: "application/pdf",
          sizeBytes: "123",
        },
      });
      await ok(route, { ...detail(), versions: [v] });
      return true;
    }
    if (path === `/api/v1/admin/files/${fileId}/download-urls`) {
      signatures++;
      await ok(route, {
        url: `http://127.0.0.1/fictional.pdf?signature=${signatures}`,
        expiresAt: "2026-10-10T00:00:00.000Z",
        fileName: "虚构历史.pdf",
      });
      return true;
    }
    return false;
  });
  await page.goto("/ops/agreements?tab=evidence");
  const area = page.getByRole("region", { name: "协议同意记录", exact: true });
  await expect(area).toContainText("138****0216");
  const start = page.getByPlaceholder("开始日期"),
    end = page.getByPlaceholder("结束日期");
  await start.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Tab");
  await expect(end).toBeFocused();
  await area.getByRole("button", { name: "下一页", exact: true }).click();
  await expect.poll(() => queries.at(-1)?.get("page")).toBe("2");
  await area.locator(`tr[data-row-key="${id}"]`).click();
  const drawer = page.getByRole("dialog", { name: "同意记录证据", exact: true });
  await expect(drawer).toContainText("正文摘要不一致，请联系管理员核查");
  await expect(drawer).toContainText("OpenID 快照（不展示明文）");
  await expect(drawer).not.toContainText("13800130216");
  await expect(drawer).not.toContainText("must-not-display");
  await shot(page, "agreements-03-consent-evidence", "同意记录证据");
  const download = drawer.getByRole("button", { name: "下载该签署版本PDF", exact: true });
  await download.click();
  await expect.poll(() => signatures).toBe(1);
  await expect(download).not.toBeDisabled();
  await download.click();
  await expect.poll(() => signatures).toBe(2);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain("signature=");
  await drawer.getByRole("button", { name: "关闭", exact: true }).click();
  const beforeInvalid = queries.length;
  await page.getByRole("textbox", { name: "协议版本ID", exact: true }).fill("bad-id");
  await page.getByRole("button", { name: "查询", exact: true }).click();
  await expect(
    page.getByText("筛选条件无效，请核对编号、对象ID与日期", { exact: true }),
  ).toBeVisible();
  expect(queries).toHaveLength(beforeInvalid);
  await expect(page.getByRole("textbox", { name: "协议版本ID", exact: true })).toHaveValue(
    "bad-id",
  );
});

for (const state of ["loading", "empty", "error"] as const) {
  test(`W216 协议${state}状态截图`, async ({ page }) => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await serve(page, async (route, path) => {
      if (path !== "/api/v1/admin/agreements") return false;
      if (state === "loading") await gate;
      if (state === "error")
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({
            code: 50300,
            error: "PROVIDER_UNAVAILABLE",
            message: "协议读取暂不可用",
            retryable: false,
            requestId: id,
          }),
        });
      else await ok(route, { items: [], page: 1, pageSize: 20, total: 0 });
      return true;
    });
    await page.goto("/ops/agreements");
    await expect(
      page
        .getByRole("region", { name: "协议清单与版本", exact: true })
        .getByText(
          state === "loading" ? "协议加载中…" : state === "empty" ? "暂无协议" : "协议读取暂不可用",
          { exact: true },
        ),
    ).toBeVisible();
    await shot(page, `agreements-04-${state}`);
    release();
  });
}
