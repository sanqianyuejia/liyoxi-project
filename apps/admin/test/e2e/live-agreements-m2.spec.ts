// Real local API/Storage/converter chain. No route fulfillment, direct file-state writes or legal claim.
import { createHash } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import type { AgreementApi } from "../../src/features/ops/agreements/api";
import { liveContext, noHorizontalScroll, recordErrors } from "./live-context";
import { shot } from "./w206-helpers";

interface Fixture {
  agreementKey: string;
  noticeAgreementKey: string;
  files: { name: string; mime: string; base64: string; size: number; sha256: string }[];
  receipts: {
    agreementConsentId: string;
    agreementVersionId: string;
    agreementKey: string;
    phoneMask: string;
  }[];
  current: { agreementVersionId: string };
  legalStatus: "fictional_only";
}
const fixture = () =>
  (liveContext().fixtures as { fixtures: { "x-agreements-m2": Fixture } }).fixtures[
    "x-agreements-m2"
  ];
function response(page: Page, method: string, path: string) {
  return page.waitForResponse(
    (r) => r.request().method() === method && new URL(r.url()).pathname === `/api/v1/admin/${path}`,
  );
}
function futureDate() {
  const date = new Date(Date.now() + 35 * 86400000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
async function draftFields(page: Page) {
  const dialog = page
    .getByRole("dialog")
    .filter({ has: page.getByRole("button", { name: "保存草稿", exact: true }) });
  await expect(
    dialog.getByRole("checkbox", { name: "我确认本次正文已完成法务审核", exact: true }),
  ).not.toBeChecked();
  await dialog
    .getByRole("textbox", { name: "变更摘要", exact: true })
    .fill("仅本地虚构正文生命周期验收");
  const date = dialog.getByRole("textbox", { name: "生效日期（北京时间）", exact: true });
  await date.fill(futureDate());
  await date.press("Enter");
  await date.press("Tab");
  await dialog.getByLabel("生效时刻（北京时间）", { exact: true }).fill("09:00");
  await dialog.getByRole("checkbox", { name: "我确认本次正文已完成法务审核", exact: true }).check();
  return dialog;
}
async function confirm(page: Page, title: string, checkbox: string) {
  const dialog = page.getByRole("dialog", { name: title, exact: true });
  const submit = dialog.getByRole("button", { name: "确认", exact: true });
  await expect(submit).toBeDisabled();
  await dialog.getByRole("checkbox", { name: checkbox, exact: true }).check();
  await submit.click();
}

test("W216 真实legal_doc入库→真实转换草稿→安排→撤回另id，服务器phase和引用", async ({ page }) => {
  const data = fixture(),
    errors = recordErrors(page),
    registeredIds: string[] = [];
  expect(data.legalStatus).toBe("fictional_only");
  const me = await page.request.get("/api/v1/admin/auth/me");
  expect(me.status()).toBe(200);
  const ownStaffId = (await me.json()).data.staff.staffId;
  expect(ownStaffId).toEqual(expect.any(String));
  await page.goto(`/ops/agreements?agreementKey=${data.agreementKey}`);
  await expect(page.locator(".lyx-agreement-card")).toHaveCount(6);
  await page.getByRole("button", { name: "新建草稿", exact: true }).click();
  const dialog = await draftFields(page);
  for (const [index, file] of data.files.entries()) {
    const bytes = Buffer.from(file.base64, "base64");
    expect(bytes.byteLength).toBe(file.size);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(file.sha256);
    const registered = response(page, "POST", "files");
    await dialog
      .locator('input[type="file"]')
      .nth(index)
      .setInputFiles({ name: file.name, mimeType: file.mime, buffer: bytes });
    const result = await registered;
    expect(result.status()).toBe(200);
    // Chrome streamed Requests may omit postData; persisted file facts remain mandatory below.
    const requestBody = result.request().postDataJSON();
    if (requestBody) expect(requestBody).toMatchObject({ category: "legal_doc" });
    const registration = (await result.json()).data;
    expect(registration.fileId).toEqual(expect.any(String));
    registeredIds.push(registration.fileId);
    await expect(
      dialog.getByRole("button", {
        name: index === 0 ? "清除 Word 引用" : "清除 PDF 引用",
        exact: true,
      }),
    ).toBeVisible();
    const read = await page.request.get(`/api/v1/admin/files/${registeredIds[index]}`);
    expect(read.status()).toBe(200);
    expect((await read.json()).data).toMatchObject({
      fileId: registeredIds[index],
      status: "stored",
      category: "legal_doc",
      originalName: file.name,
      declaredSizeBytes: String(file.size),
      sizeBytes: String(file.size),
      uploader: { actorType: "staff", actorId: ownStaffId, client: "admin" },
    });
  }
  await shot(page, "agreements-05-real-uploaded", "新建协议草稿");
  const created = response(page, "POST", `agreements/${data.agreementKey}/agreement-versions`);
  await dialog.getByRole("button", { name: "保存草稿", exact: true }).click();
  const createdResponse = await created;
  expect(createdResponse.status()).toBe(200);
  expect(createdResponse.headers()["cache-control"]).toBe("no-store");
  const createBody = createdResponse.request().postDataJSON();
  if (createBody)
    expect(createBody).toMatchObject({
      sourceFileId: registeredIds[0],
      pdfFileId: registeredIds[1],
      isLegalApproved: true,
    });
  const saved = (await createdResponse.json()).data;
  expect(saved.version).toMatchObject({
    status: "draft",
    sourceFile: { fileId: registeredIds[0] },
    pdfFile: { fileId: registeredIds[1] },
    isLegalApproved: true,
  });
  expect(saved.conversion.state).toBe("converted");
  expect(saved.contentHtml).toContain("狸有戏虚构协议");
  const preview = page.locator('iframe[title="保存后转换正文"]');
  await expect(preview).toBeVisible();
  await expect(preview).toHaveAttribute("sandbox", "");
  await expect(preview).toHaveAttribute("referrerpolicy", "no-referrer");
  const srcdoc = await preview.getAttribute("srcdoc");
  expect(srcdoc).toContain(saved.contentHtml);
  expect(srcdoc).toContain(
    "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
  );
  const frame = await (await preview.elementHandle())?.contentFrame();
  if (!frame) throw new Error("保存后正文缺少实际预览 Frame");
  // Child locators inject Playwright's target/listener events, which this sandbox rejects.
  // Read the actual rendered text and its geometry without installing that child script.
  await expect
    .poll(() =>
      frame.evaluate(() => {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let node: Node | null;
        while ((node = walker.nextNode())) {
          if (!node.textContent?.includes("狸有戏虚构协议")) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          const rect = range.getBoundingClientRect();
          let visible = rect.width > 0 && rect.height > 0;
          for (let element = node.parentElement; element; element = element.parentElement) {
            const style = getComputedStyle(element);
            visible &&=
              style.display !== "none" &&
              style.visibility === "visible" &&
              Number(style.opacity) > 0;
          }
          return { text: node.textContent, visible };
        }
        return { text: null, visible: false };
      }),
    )
    .toMatchObject({ text: expect.stringContaining("狸有戏虚构协议"), visible: true });
  await shot(page, "agreements-06-real-converted", `编辑草稿 ${saved.version.versionLabel}`);
  const scheduled = response(
    page,
    "POST",
    `agreement-versions/${saved.version.agreementVersionId}/schedule`,
  );
  await dialog.getByRole("button", { name: "保存并安排", exact: true }).click();
  await confirm(page, "安排协议生效", "我已核对文件、法务记录与安排信息");
  const scheduledResponse = await scheduled;
  expect(scheduledResponse.status()).toBe(200);
  const pending = (await scheduledResponse.json()).data;
  expect(pending.version).toMatchObject({
    agreementVersionId: saved.version.agreementVersionId,
    displayStatus: "pending",
    status: "pending",
  });
  expect(pending.siteNotice).toBeNull();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "版本历史" })).toContainText("待生效");
  await shot(page, "agreements-07-real-pending");
  const row = page.locator(`tr[data-row-key="${saved.version.agreementVersionId}"]`);
  await row.getByRole("button", { name: "撤回", exact: true }).click();
  await page
    .getByRole("textbox", { name: "原因（选填，最多100字）", exact: true })
    .fill("虚构演练完毕");
  await page.getByRole("button", { name: "继续核对", exact: true }).click();
  const withdrawn = response(
    page,
    "POST",
    `agreement-versions/${saved.version.agreementVersionId}/withdraw`,
  );
  await confirm(page, "撤回待生效协议", "我已核对版本与撤回影响");
  const withdrawnResponse = await withdrawn;
  expect(withdrawnResponse.status()).toBe(200);
  const result = (await withdrawnResponse.json()).data;
  expect(result.withdrawn.status).toBe("withdrawn");
  expect(result.newDraft.agreementVersionId).not.toBe(saved.version.agreementVersionId);
  expect(result.newDraft).toMatchObject({
    status: "draft",
    sourceFile: { fileId: registeredIds[0] },
    pdfFile: { fileId: registeredIds[1] },
  });
  await expect(
    page.getByText("已撤回，并另建草稿；请在版本表中核对新草稿后编辑", { exact: true }),
  ).toBeVisible();
  await expect(row.getByRole("button", { name: "编辑", exact: true })).toHaveCount(0);
  await shot(page, "agreements-08-real-withdrawn");
  expect(errors).toEqual([]);
});

test("W216 已有草稿时撤回返回null，保留当前草稿和原撤回版本", async ({ page }) => {
  const data = fixture(),
    errors = recordErrors(page);
  await page.goto(`/ops/agreements?agreementKey=${data.agreementKey}`);
  await page.getByRole("button", { name: "编辑草稿", exact: true }).click();
  const dialog = await draftFields(page);
  const scheduled = page.waitForResponse(
    (r) => r.request().method() === "POST" && new URL(r.url()).pathname.endsWith("/schedule"),
  );
  await dialog.getByRole("button", { name: "保存并安排", exact: true }).click();
  await confirm(page, "安排协议生效", "我已核对文件、法务记录与安排信息");
  const scheduledResponse = await scheduled;
  expect(scheduledResponse.status()).toBe(200);
  const pendingId = (await scheduledResponse.json()).data.version.agreementVersionId;
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "新建草稿", exact: true }).click();
  const create = response(page, "POST", `agreements/${data.agreementKey}/agreement-versions`);
  await page
    .getByRole("dialog", { name: "新建协议草稿", exact: true })
    .getByRole("button", { name: "保存草稿", exact: true })
    .click();
  const created = await create;
  expect(created.status()).toBe(200);
  const keptId = (await created.json()).data.version.agreementVersionId;
  await page.getByRole("dialog").getByRole("button", { name: "取消", exact: true }).click();
  await page
    .locator(`tr[data-row-key="${pendingId}"]`)
    .getByRole("button", { name: "撤回", exact: true })
    .click();
  await page.getByRole("button", { name: "继续核对", exact: true }).click();
  const withdraw = response(page, "POST", `agreement-versions/${pendingId}/withdraw`);
  await confirm(page, "撤回待生效协议", "我已核对版本与撤回影响");
  const result = await withdraw;
  expect(result.status()).toBe(200);
  expect((await result.json()).data.newDraft).toBeNull();
  await expect(
    page.getByText("已撤回；已有草稿保留，请刷新后选择实际草稿", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(`tr[data-row-key="${keptId}"]`)).toContainText("草稿");
  await expect(page.locator(`tr[data-row-key="${pendingId}"]`)).toContainText("已撤回");
  expect(errors).toEqual([]);
});

test("W216 真实同意记录分页/筛选与历史脱敏证据；已生效有同意版本不可撤回", async ({ page }) => {
  const data = fixture(),
    errors = recordErrors(page);
  const initial = response(page, "GET", "agreement-consents");
  await page.goto("/ops/agreements?tab=evidence&agreementKey=user&scene=reconsent&pageSize=10");
  const first = await initial;
  expect(first.status()).toBe(200);
  expect(first.headers()["cache-control"]).toBe("no-store");
  const firstData: Awaited<ReturnType<AgreementApi["consents"]>> = (await first.json()).data;
  expect(firstData.total).toBe(12);
  expect(firstData.items).toHaveLength(10);
  const area = page.getByRole("region", { name: "协议同意记录", exact: true });
  await expect(area.getByRole("table").getByRole("row")).toHaveCount(11);
  const next = response(page, "GET", "agreement-consents");
  await area.getByRole("button", { name: "下一页", exact: true }).click();
  const second: Awaited<ReturnType<AgreementApi["consents"]>> = (await (await next).json()).data;
  expect(second.items).toHaveLength(2);
  expect(new Set([...firstData.items, ...second.items].map((v) => v.agreementConsentId))).toEqual(
    new Set(
      data.receipts.filter((v) => v.agreementKey === "user").map((v) => v.agreementConsentId),
    ),
  );
  const selected = second.items[0];
  if (!selected) throw new Error("第二页缺少真实签署记录");
  await area.locator(`tr[data-row-key="${selected.agreementConsentId}"]`).click();
  const drawer = page.getByRole("dialog", { name: "同意记录证据", exact: true });
  await expect(drawer).toContainText(selected.phoneMask);
  await expect(drawer).toContainText("未取得 OpenID 快照");
  await expect(drawer).not.toContainText(/\b1\d{10}\b/);
  await shot(page, "agreements-10-real-consent", "同意记录证据");
  await noHorizontalScroll(page, "真实协议同意证据");
  await page.goto("/ops/agreements?agreementKey=user");
  await expect(
    page
      .locator(`tr[data-row-key="${data.current.agreementVersionId}"]`)
      .getByRole("button", { name: "撤回", exact: true }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});
