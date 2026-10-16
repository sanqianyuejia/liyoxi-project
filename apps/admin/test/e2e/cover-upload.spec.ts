import { test, expect } from "@playwright/test";
test.beforeEach(async ({ page }) => {
  page.on("pageerror", (error) => console.error(error.message));
});
const oldId = "019a1111-1111-7111-8111-000000000001";
const newId = "019a1111-1111-7111-8111-000000000002";
test("封面替换：上传中阻止保存，失败保留旧引用，重试成功才替换，移除清理列表", async ({ page }) => {
  let finish: (() => void) | undefined;
  let attempt = 0;
  await page.route("**/cover-upload-target", async (route) => {
    attempt += 1;
    if (attempt === 1) {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      await route.abort("failed");
    } else await route.fulfill({ status: 204 });
  });
  try {
    await page.goto("/test/fixtures/cover-upload.html");
    const dialog = page.getByRole("dialog");
    const save = dialog.getByRole("button", { name: /^保\s*存$/ });
    const input = dialog.locator('input[type="file"]');
    await input.setInputFiles({
      name: "poster.png",
      mimeType: "image/png",
      buffer: Buffer.from("image"),
    });
    await expect(save).toBeDisabled();
    await expect(dialog.getByRole("status")).toContainText("封面上传中");
    await expect.poll(() => !!finish).toBe(true);
    finish!();
    await expect(dialog.getByRole("status")).toHaveText("新封面未上传成功，原封面已保留");
    await save.click();
    await expect(page.getByTestId("saved")).toHaveText(oldId);
    await dialog.getByRole("button", { name: "重试", exact: true }).click();
    await expect(dialog.getByRole("status")).toHaveText("已引用封面文件");
    await save.click();
    await expect(page.getByTestId("saved")).toHaveText(newId);
    await dialog.getByRole("button", { name: "移除封面引用" }).click();
    await expect(dialog.getByRole("status")).toHaveText("未选择封面");
    await expect(dialog.getByText("poster.png", { exact: true })).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "移除封面引用" })).toHaveCount(0);
  } finally {
    finish?.();
  }
});
test("非法文件不会清空原封面，也不发起直传", async ({ page }) => {
  let calls = 0;
  await page.route("**/cover-upload-target", async (route) => {
    calls++;
    await route.abort();
  });
  await page.goto("/test/fixtures/cover-upload.html");
  const dialog = page.getByRole("dialog");
  await dialog
    .locator('input[type="file"]')
    .setInputFiles({ name: "bad.txt", mimeType: "text/plain", buffer: Buffer.from("bad") });
  await expect(dialog.getByRole("status")).toContainText("原封面已保留");
  await dialog.getByRole("button", { name: /^保\s*存$/ }).click();
  await expect(page.getByTestId("saved")).toHaveText(oldId);
  expect(calls).toBe(0);
});

test("上传成功但保存被上架校验阻断时显示具体原因，保留封面与表单", async ({ page }) => {
  await page.route("**/cover-upload-target", (route) => route.fulfill({ status: 204 }));
  await page.goto("/test/fixtures/cover-upload.html?listingBlocked=1");
  const dialog = page.getByRole("dialog");
  await dialog
    .locator('input[type="file"]')
    .setInputFiles({ name: "poster.png", mimeType: "image/png", buffer: Buffer.from("image") });
  await expect(dialog.getByRole("button", { name: "重新上传（替换）" })).toBeVisible();
  await dialog.getByRole("textbox", { name: "剧名", exact: true }).fill("修改后的剧名");
  // 加载图标退出动画期间，accessible name 可能仍带 loading 前缀。
  const save = dialog.getByRole("button", { name: /保\s*存$/ });
  await save.click();
  await expect(dialog.getByRole("alert")).toContainText("L10：剧集和原片齐全");
  await expect(dialog.getByText(/本次修改未保存，表单内容已保留/)).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "剧名", exact: true })).toHaveValue(
    "修改后的剧名",
  );
  await expect(dialog.getByRole("button", { name: "重新上传（替换）" })).toBeVisible();
  await expect(save).toBeEnabled();
  await expect(save).not.toHaveClass(/ant-btn-loading/);
  await save.click();
  await expect(page.getByTestId("save-attempts")).toHaveText("2");
  await expect(page.getByTestId("saved")).toHaveText("未保存");
});
