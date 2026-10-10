// W1-02②：生产后台连真实 API，复用登录态与专属库的员工造数。
import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { liveContext, noHorizontalScroll, recordErrors } from "./live-context";

interface StaffFixture {
  staff: { id: string; name: string; roleKey: string; status: string; phoneLast4: string }[];
  newStaff: { name: string; phone: string };
}
async function shot(page: Page, name: string) {
  await noHorizontalScroll(page, name);
  mkdirSync("dist/e2e-shots", { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: `dist/e2e-shots/${name}.png`, animations: "disabled" });
  await page.setViewportSize({ width: 1366, height: 768 });
}
async function select(page: Page, label: string, value: string) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  // antd 的 option 仅用于读屏；可见选项用既有样例相同的 title 定位。
  await page.getByTitle(value, { exact: true }).click();
  await expect(page.locator(".ant-select-dropdown:visible")).toHaveCount(0);
}

test("员工筛选、分页URL与新增manual一次性激活码，同步双提交只建一行", async ({ page }) => {
  const context = liveContext();
  const fixture = (context.fixtures as { fixtures: { staff: StaffFixture } }).fixtures.staff;
  expect(fixture.staff).toHaveLength(10);
  const errors = recordErrors(page);
  const firstList = page.waitForRequest(
    (request) =>
      request.method() === "GET" && new URL(request.url()).pathname === "/api/v1/admin/staff",
  );
  await page.goto("/sys/staff?sort=unsupported&roleKey=unknown&page=0&pageSize=13&uiOnly=x");
  const firstQuery = new URL((await firstList).url()).searchParams;
  expect(firstQuery.get("page")).toBe("1");
  expect(firstQuery.get("pageSize")).toBe("20");
  for (const key of ["roleKey", "sort", "uiOnly"]) expect(firstQuery.has(key)).toBe(false);
  await expect(page.getByRole("heading", { name: "员工账号", exact: true })).toBeVisible();
  const table = page.getByRole("table");
  await expect(table.getByRole("columnheader")).toHaveCount(8);
  await expect(table.getByRole("columnheader", { name: /手机号.*已脱敏/ })).toBeVisible();
  await expect(table).toContainText("****");
  await expect(table.getByRole("row")).toHaveCount(14);
  await expect(table.getByText("演练交付", { exact: true })).toBeVisible();
  await expect(table.getByText("演练渠道", { exact: true })).toBeVisible();
  await expect(table.getByText("已禁用", { exact: true })).toBeVisible();
  await select(page, "每页条数", "10 条");
  await expect(table.getByRole("row")).toHaveCount(11);
  await shot(page, "staff-01-list");

  await select(page, "全部角色", "交付经理");
  await expect(page).toHaveURL(/roleKey=delivery_manager/);
  await expect(table.getByRole("row")).toHaveCount(2);
  await expect(table.getByText("演练交付", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "重置筛选", exact: true }).click();
  await select(page, "全部状态", "已禁用");
  await expect(page).toHaveURL(/status=disabled/);
  await expect(table.getByRole("row")).toHaveCount(2);
  await expect(table.getByText("演练剪辑", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "重置筛选", exact: true }).click();
  const keyword = page.getByRole("searchbox", { name: "搜索姓名或手机号后 4 位" });
  await keyword.fill(fixture.staff[0]!.phoneLast4);
  await keyword.press("Enter");
  await expect(page).toHaveURL(new RegExp(`q=${fixture.staff[0]!.phoneLast4}`));
  await expect(table.getByRole("row")).toHaveCount(2);
  await expect(table.getByText(fixture.staff[0]!.name, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "重置筛选", exact: true }).click();
  await expect(page).toHaveURL(/pageSize=10/);
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(table.getByRole("row")).toHaveCount(4);
  await page.reload();
  await expect(page.getByLabel("第 2 页", { exact: true })).toBeVisible();
  await expect(table.getByRole("row")).toHaveCount(4);
  await page.getByRole("button", { name: "上一页", exact: true }).click();
  await noHorizontalScroll(page, "员工分页");

  await page.getByRole("button", { name: "＋ 新增员工", exact: true }).click();
  const form = page.getByRole("form", { name: "新增员工", exact: true });
  await form.getByRole("textbox", { name: "姓名", exact: true }).fill(fixture.newStaff.name);
  await form.getByRole("textbox", { name: "手机号", exact: true }).fill(fixture.newStaff.phone);
  await select(page, "角色", "交付经理");
  await expect(form.getByRole("textbox", { name: "数据范围", exact: true })).toHaveValue(
    "本人负责",
  );
  await expect(form.getByText("11/11", { exact: true })).toBeVisible();
  await expect(form.getByRole("checkbox", { name: "立即启用并生成激活码" })).toBeChecked();
  await shot(page, "staff-02-create");
  let creates = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/v1/admin/staff")
      creates++;
  });
  // 两次同一事件循环的真实表单提交，验证React渲染禁用按钮前的同步锁。
  await form.evaluate((element) => {
    (element as HTMLFormElement).requestSubmit();
    (element as HTMLFormElement).requestSubmit();
  });
  const code = page.getByRole("dialog", { name: "员工激活码", exact: true }).locator("code");
  await expect(code).toHaveText(/^[A-Z0-9]{8}$/);
  await shot(page, "staff-03-activation");
  expect(creates).toBe(1);
  await page.getByRole("button", { name: "我已记下，关闭", exact: true }).click();
  await expect(code).toHaveCount(0);
  await expect(page).toHaveURL(`${context.origin}/sys/staff`);
  const row = table.getByRole("row").filter({ hasText: fixture.newStaff.name });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("待激活");
  await expect(row.getByRole("button")).toHaveCount(1);
  await row.getByRole("button", { name: "查看 / 操作", exact: true }).click();
  const details = page.getByRole("dialog", { name: "员工详情", exact: true });
  await expect(details).toContainText(fixture.newStaff.name);
  await expect(details.getByRole("button", { name: "编辑员工", exact: true })).toBeVisible();
  await expect(details.getByRole("button", { name: "禁用员工", exact: true })).toBeVisible();
  await expect(details.getByRole("button", { name: "启用员工", exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(details).toHaveCount(0);
  const response = await page.request.get(
    `/api/v1/admin/staff?q=${fixture.newStaff.phone.slice(-4)}`,
  );
  expect(response.status()).toBe(200);
  const result = (await response.json()).data;
  expect(result.total).toBe(1);
  expect(result.items[0]).toMatchObject({
    name: fixture.newStaff.name,
    status: "active",
    isActivated: false,
    actions: [
      "update",
      "unlock",
      "handover",
      "reissue-activation-code",
      "disable",
      "reset-password",
      "reset-mfa",
      "bind-wecom",
      "invite-wecom",
    ],
  });
  await page.getByRole("button", { name: "＋ 新增员工", exact: true }).click();
  await expect(form.getByRole("textbox", { name: "姓名", exact: true })).toHaveValue("");
  await expect(form.getByRole("textbox", { name: "手机号", exact: true })).toHaveValue("");
  await expect(page.getByText(/^[A-Z0-9]{8}$/)).toHaveCount(0);
  await form.getByRole("button", { name: "取消", exact: true }).click();
  await noHorizontalScroll(page, "员工创建完成");
  expect(errors).toEqual([]);
});

// W223 后置：原员工验收全部完成后才创建自己的只读员工；不污染旧数量/筛选事实。
import { registerFlowOpsReadonlyTest } from "./w223-flow-ops-readonly";
registerFlowOpsReadonlyTest();

import { registerW206CreatedActivationTest } from "./w206-created-activation";
registerW206CreatedActivationTest();

// W216 own identities are created only after the original staff cases and existing postlude.
import { registerAgreementPermissionsTest } from "./w216-agreements-readonly";
registerAgreementPermissionsTest();
