import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { calendarDate } from "@liyoxi/shared/time";
import { liveContext, noHorizontalScroll, recordErrors } from "./live-context";
interface AuditFixture {
  records: { id: string; logNo: string }[];
  entityId: string;
  storeId: string;
  staffId: string;
  phone: string;
  password: string;
  recoveryCode: string;
  piiSubjectId: string;
  piiPhone: string;
  privateMarker: string;
}
const fixture = () =>
  (liveContext().fixtures as { fixtures: { w208: AuditFixture } }).fixtures.w208;
async function shot(page: Page, name: string) {
  await noHorizontalScroll(page, name);
  mkdirSync("dist/e2e-shots", { recursive: true });
  await expect(page.locator(".lyx-shell")).toHaveCount(1);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await page.screenshot({ path: `dist/e2e-shots/${name}.png`, animations: "disabled" });
  await page.setViewportSize({ width: 1366, height: 768 });
}
async function totals(page: Page) {
  const result = [];
  for (const stream of ["ops", "access"]) {
    const response = await page.request.get(`/api/v1/admin/audit-logs?stream=${stream}&limit=1`);
    expect(response.status()).toBe(200);
    result.push((await response.json()).data.totalApprox);
  }
  return result;
}
// 原生 Node fetch 不受浏览器/Playwright API tracing 包装。明文响应只在此函数内检查，返回唯一 auditLogId。
async function revealOutsideTrace(page: Page): Promise<string> {
  const item = fixture(),
    origin = liveContext().origin;
  const cookies = (await page.context().cookies(origin))
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
  const response = await fetch(`${origin}/api/v1/admin/pii-reveals`, {
    method: "POST",
    headers: {
      Cookie: cookies,
      Origin: origin,
      "X-LYX-Admin": "1",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      subjectType: "merchant_user",
      subjectId: item.piiSubjectId,
      field: "phone",
      purpose: "verify_identity",
      note: "日志演练访问核验",
    }),
  });
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const data = (await response.json()).data as { value: unknown; auditLogId: string };
  // 失败也只输出布尔判据，不把 value 放入断言的展示/附件。
  expect(data.value === item.piiPhone).toBe(true);
  return data.auditLogId;
}
function listResponse(page: Page) {
  return page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      new URL(response.url()).pathname === "/api/v1/admin/audit-logs",
  );
}
test("W208 ops真实多条件、游标无重漏、脱敏详情和日期键盘，查询零新增审计", async ({ page }) => {
  const item = fixture(),
    errors = recordErrors(page),
    writes: string[] = [];
  page.on("request", (request) => {
    if (
      new URL(request.url()).pathname.startsWith("/api/") &&
      !["GET", "HEAD", "OPTIONS"].includes(request.method())
    )
      writes.push(request.method());
  });
  const before = await totals(page),
    first = listResponse(page);
  await page.goto(
    `/sys/logs?q=日志演练&limit=10&targetId=${item.staffId}&targetKey=bad&createdFrom=2026-10-08&createdTo=2026-10-07&id=bad&uiOnly=x`,
  );
  const initial = await first;
  expect(initial.status()).toBe(200);
  const qs = new URL(initial.url()).searchParams;
  for (const key of ["targetId", "targetKey", "createdFrom", "createdTo", "id", "uiOnly"])
    expect(qs.has(key)).toBe(false);
  await expect(page.getByRole("heading", { name: "操作日志", exact: true })).toBeVisible();
  const table = page.getByRole("table");
  await expect(table.getByRole("row")).toHaveCount(11);
  const ids: string[] = (await initial.json()).data.items.map(
    (row: { auditLogId: string }) => row.auditLogId,
  );
  for (let index = 0; index < 2; index++) {
    const next = listResponse(page);
    await page.getByRole("button", { name: "下一页", exact: true }).click();
    const result = (await (await next).json()).data;
    ids.push(...result.items.map((row: { auditLogId: string }) => row.auditLogId));
  }
  expect(ids).toHaveLength(24);
  expect(new Set(ids).size).toBe(24);
  expect(new Set(ids)).toEqual(new Set(item.records.map((row) => row.id)));
  await expect(page.getByRole("button", { name: "下一页", exact: true })).toBeDisabled();
  await page.goBack();
  await expect(table.getByRole("row")).toHaveCount(11);
  await page.getByRole("button", { name: "上一页", exact: true }).click();
  await expect(page).not.toHaveURL(/cursor=/);
  const selected = listResponse(page);
  await page.goto(
    `/sys/logs?q=日志演练&category=param,staff_authz&actorType=staff&actorId=${item.staffId}&targetType=staff&targetId=${item.staffId}&entityId=${item.entityId}&storeId=${item.storeId}&limit=10`,
  );
  await selected;
  await expect(table.getByRole("row")).toHaveCount(11);
  await shot(page, "audit-01-filtered-ops");
  await table.getByRole("row").nth(1).click();
  await expect(page).toHaveURL(/id=/);
  const detail = page.getByRole("complementary", { name: "日志详情" });
  await expect(detail).toContainText("变更前后 · 已脱敏");
  await expect(detail).toContainText("139****8881");
  await expect(detail).toContainText("198.51.**.23");
  await expect(detail).toContainText("复杂内容已裁剪");
  await expect(detail).not.toContainText(item.privateMarker);
  expect(await page.content()).not.toContain("13900008881");
  expect(await page.content()).not.toContain("198.51.100.23");
  await expect(detail.getByRole("link")).toHaveAttribute("href", "/sys/staff");
  await shot(page, "audit-02-masked-detail");
  await detail.getByRole("heading", { name: "变更前后 · 已脱敏" }).scrollIntoViewIfNeeded();
  await shot(page, "audit-02-masked-diff");
  await page.reload();
  await expect(detail).toContainText("变更前后 · 已脱敏");
  const systemRequest = listResponse(page);
  await page.goto(
    "/sys/logs?q=日志演练&actorType=system&targetType=billing_param&targetKey=demo.w208&limit=10",
  );
  const systemRows = (await (await systemRequest).json()).data.items;
  expect(systemRows).toHaveLength(1);
  expect(systemRows[0].actor).toMatchObject({ actorType: "system", actorId: null, client: null });
  await table.getByRole("row").nth(1).click();
  await expect(detail).toContainText("系统任务");
  await expect(detail).toContainText("lyxtest.w208");
  await expect(detail).toContainText("日志演练参数");
  await page.getByRole("button", { name: "重置筛选", exact: true }).click();
  await expect(page).not.toHaveURL(/id=|cursor=/);
  await expect(detail).toContainText("请选择一条记录");
  const form = page.getByRole("form", { name: "审计日志筛选" }),
    start = form.getByPlaceholder("开始日期"),
    end = form.getByPlaceholder("结束日期");
  await form.getByRole("button", { name: "更多筛选" }).focus();
  await page.keyboard.press("Tab");
  await expect(start).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator(".ant-picker-dropdown:visible")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page.locator(".ant-picker-dropdown:visible")).toHaveCount(0);
  await page.keyboard.press("Tab");
  await expect(end).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(form.getByRole("button", { name: "近 7 天" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(end).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(start).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(form.getByRole("button", { name: "更多筛选" })).toBeFocused();
  const today = calendarDate(new Date());
  await start.fill(today);
  await page.keyboard.press("Tab");
  await end.fill(today);
  const dateRequest = listResponse(page);
  await page.keyboard.press("Tab");
  const dateResult = (await (await dateRequest).json()).data;
  expect(dateResult.items.length).toBeGreaterThan(0);
  for (const row of dateResult.items) expect(calendarDate(new Date(row.createdAt))).toBe(today);
  await expect(page.getByLabel("当前有效日期范围")).toHaveText(
    `${today} 至 ${today}（北京时间，两端含）`,
  );
  await expect(page).toHaveURL(new RegExp(`createdFrom=${today}.*createdTo=${today}`));
  await page.getByRole("button", { name: "近 7 天" }).click();
  await expect(page.getByLabel("当前有效日期范围")).toContainText("（北京时间，两端含）");
  await form.getByRole("searchbox", { name: "搜索标题或日志编号" }).fill("日志演练没有结果");
  await form.getByRole("button", { name: "查询", exact: true }).click();
  await expect(page.getByText("没有符合条件的日志", { exact: true })).toBeVisible();
  await shot(page, "audit-04-empty");
  expect(await totals(page)).toEqual(before);
  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
});
test("W208 PII真实POST先留痕再查询，明文不进页面或浏览器trace边界", async ({ page }) => {
  const errors = recordErrors(page),
    requests: string[] = [];
  page.on("request", (request) => requests.push(new URL(request.url()).pathname));
  await page.goto("/sys/logs");
  await expect(page.getByRole("heading", { name: "操作日志", exact: true })).toBeVisible();
  const before = await totals(page),
    id = await revealOutsideTrace(page);
  const response = await page.request.get(`/api/v1/admin/audit-logs/${id}`);
  expect(response.status()).toBe(200);
  const record = (await response.json()).data;
  expect(record).toMatchObject({
    auditLogId: id,
    stream: "access",
    category: "pii_reveal",
    action: "pii.phone.reveal",
    target: { id: fixture().piiSubjectId },
    meta: { purpose: "verify_identity", note: "日志演练访问核验" },
  });
  expect(JSON.stringify(record).includes(fixture().piiPhone)).toBe(false);
  expect(record).not.toHaveProperty("value");
  await page.goto(`/sys/logs?stream=access&q=${record.logNo}&id=${id}`);
  const table = page.getByRole("table");
  await expect(table.getByRole("row")).toHaveCount(2);
  const detail = page.getByRole("complementary", { name: "日志详情" });
  await expect(detail).toContainText(record.logNo);
  await expect(detail).toContainText("核验身份");
  await expect(detail).toContainText("pii.phone.reveal");
  await expect(detail).toContainText("访问留痕不包含被查看的值");
  expect((await page.content()).includes(fixture().piiPhone)).toBe(false);
  await shot(page, "audit-03-access-pii");
  await detail.getByRole("heading", { name: "访问用途与备注" }).scrollIntoViewIfNeeded();
  await shot(page, "audit-03-access-purpose");
  expect(requests).not.toContain("/api/v1/admin/pii-reveals");
  expect(await totals(page)).toEqual([before[0], before[1] + 1]);
  await page.getByRole("tab", { name: "操作日志", exact: true }).click();
  await expect(page).not.toHaveURL(/id=|cursor=/);
  await expect(detail).toContainText("请选择一条记录");
  expect(errors).toEqual([]);
});
test("W208 非超管真实ops可读，access直链403/详情404且无切换入口", async ({ page, browser }) => {
  await page.goto("/sys/logs");
  const id = await revealOutsideTrace(page),
    item = fixture();
  const context = await browser.newContext({
    baseURL: liveContext().origin,
    storageState: { cookies: [], origins: [] },
    viewport: { width: 1366, height: 768 },
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
  });
  try {
    const limited = await context.newPage();
    await limited.goto(`/login?redirect=${encodeURIComponent("/sys/logs?q=日志演练")}`);
    await limited.getByLabel("手机号", { exact: true }).fill(item.phone);
    await limited.getByLabel("密码", { exact: true }).fill(item.password);
    await limited.getByRole("button", { name: "下一步", exact: true }).click();
    await limited.getByRole("radio", { name: "恢复码", exact: true }).check();
    await limited.getByRole("textbox", { name: "恢复码", exact: true }).fill(item.recoveryCode);
    await limited.getByRole("button", { name: "登录", exact: true }).click();
    await expect(limited.getByRole("heading", { name: "操作日志", exact: true })).toBeVisible();
    await expect(limited.getByRole("table")).toContainText("日志演练");
    await expect(limited.getByRole("tab", { name: "PII / 敏感签发留痕" })).toHaveCount(0);
    const ops = await limited.request.get("/api/v1/admin/audit-logs?stream=ops");
    expect(ops.status()).toBe(200);
    const denied = await limited.request.get("/api/v1/admin/audit-logs?stream=access");
    expect(denied.status()).toBe(403);
    const hidden = await limited.request.get(`/api/v1/admin/audit-logs/${id}`);
    expect(hidden.status()).toBe(404);
    await limited.getByRole("table").getByRole("row").nth(1).click();
    await expect(limited).toHaveURL(/id=/);
    const opsId = new URL(limited.url()).searchParams.get("id")!;
    await limited.goto(`/sys/logs?stream=access&id=${opsId}`);
    await expect(limited.getByText("无权查看访问留痕", { exact: true })).toBeVisible();
    await expect(limited).not.toHaveURL(/id=/);
    await expect(limited.getByRole("complementary", { name: "日志详情" })).toContainText(
      "请选择一条记录",
    );
    await limited.goto(`/sys/logs?stream=access&id=${id}`);
    await expect(limited.getByText("无权查看访问留痕", { exact: true })).toBeVisible();
    await expect(limited).not.toHaveURL(/id=/);
    await expect(limited.getByRole("complementary", { name: "日志详情" })).toContainText(
      "请选择一条记录",
    );
    expect((await limited.content()).includes(item.piiPhone)).toBe(false);
    await shot(limited, "audit-05-permission-denied");
  } finally {
    await context.close();
  }
});
