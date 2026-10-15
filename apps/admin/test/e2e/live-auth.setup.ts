// W1-02①：一次真实激活与两步登录，保存浏览器登录态供 live 项目及后续页面包复用。
import { createHmac } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { liveContext, noHorizontalScroll, recordErrors } from "./live-context";

function totp(secret: string): string {
  let bits = "";
  for (const char of secret.replace(/=|\s/g, "").toUpperCase()) {
    const value = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".indexOf(char);
    if (value < 0) throw new Error("手输密钥不是 Base32");
    bits += value.toString(2).padStart(5, "0");
  }
  const key = Buffer.from(bits.match(/.{8}/g)!.map((byte) => Number.parseInt(byte, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const hash = createHmac("sha1", key).update(counter).digest();
  const at = hash[hash.length - 1]! & 15;
  return String((hash.readUInt32BE(at) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}
async function shot(page: Page, name: string) {
  await noHorizontalScroll(page, name);
  mkdirSync("dist/e2e-shots", { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: `dist/e2e-shots/${name}.png`, animations: "disabled" });
  await page.setViewportSize({ width: 1366, height: 768 });
}

test("激活设密 → 绑定口令 → 保存恢复码 → 菜单 → 退出 → 密码加恢复码回 redirect", async ({
  page,
}) => {
  const context = liveContext();
  const errors = recordErrors(page);
  const destination = "/orders?live=redirect";
  await page.goto(`/login?redirect=${encodeURIComponent(destination)}`);
  await expect(page.getByRole("heading", { name: "登录后台" })).toBeVisible();
  await shot(page, "auth-01-login");
  await page.getByRole("button", { name: "首次登录，激活账号" }).click();
  await expect(page.getByRole("heading", { name: "激活账号" })).toBeVisible();
  await page.getByLabel("手机号", { exact: true }).fill(context.phone);
  await page.getByLabel("激活码", { exact: true }).fill(context.activationCode);
  await page.getByLabel("新密码", { exact: true }).fill(context.password);
  await shot(page, "auth-03-activation");
  await page.getByRole("button", { name: "设置密码并继续" }).click();
  await expect(page.getByRole("heading", { name: "绑定动态口令" })).toBeVisible();
  const key = page.getByLabel("手输密钥", { exact: true });
  await expect(key).not.toHaveValue("");
  await shot(page, "auth-04-enroll-totp");
  const secret = await key.inputValue();
  await page.getByLabel("6 位动态口令", { exact: true }).fill(totp(secret));
  await page.getByRole("button", { name: "验证并绑定" }).click();
  await expect(page.getByRole("heading", { name: "保存恢复码" })).toBeVisible();
  const list = page.getByLabel("恢复码清单").locator("code");
  await expect(list).toHaveCount(10);
  const recoveryCodes = await list.allTextContents();
  expect(new Set(recoveryCodes).size).toBe(10);
  for (const code of recoveryCodes) expect(code).toMatch(/^[A-Z0-9]{5}-[A-Z0-9]{5}$/);
  await expect(page.getByRole("button", { name: "进入后台" })).toBeDisabled();
  await shot(page, "auth-05-recovery-codes");
  await page.getByRole("checkbox", { name: "我已保存恢复码" }).check();
  await page.getByRole("button", { name: "进入后台" }).click();
  await expect(page).toHaveURL(`${context.origin}${destination}`);
  const menu = page.getByRole("button", { name: "用户菜单" });
  await expect(menu).toContainText(context.name);
  const response = await page.request.get("/api/v1/admin/auth/me");
  expect(response.status()).toBe(200);
  const me = (await response.json()).data;
  expect(me).toMatchObject({
    staff: { name: context.name, roleKey: "super_admin" },
    moduleLevels: { system: "e" },
    dataScope: "all",
    flags: { "release.partner": false },
  });
  await expect(menu).toContainText(me.roleName);
  await page.getByRole("menuitem", { name: "系统", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "员工账号", exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "渠道", exact: true })).toHaveCount(0);
  await noHorizontalScroll(page, "真实菜单");
  await menu.click();
  await expect(page.getByRole("menuitem", { name: "修改密码" })).toBeVisible();
  expect(me.permissions).toContain("self.mfa.reset");
  await expect(page.getByRole("menuitem", { name: "动态口令设置" })).toBeVisible();
  await page.getByRole("menuitem", { name: "退出登录" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto(`/login?redirect=${encodeURIComponent(destination)}`);
  await page.getByLabel("手机号", { exact: true }).fill(context.phone);
  await page.getByLabel("密码", { exact: true }).fill(context.password);
  await page.getByRole("button", { name: "下一步", exact: true }).click();
  await expect(page.getByRole("heading", { name: "验证动态口令" })).toBeVisible();
  await shot(page, "auth-02-mfa");
  await page.getByRole("radio", { name: "恢复码", exact: true }).check();
  await page.getByRole("textbox", { name: "恢复码", exact: true }).fill(recoveryCodes[0]!);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(`${context.origin}${destination}`);
  await expect(page.getByRole("button", { name: "用户菜单" })).toContainText(context.name);
  await noHorizontalScroll(page, "恢复码登录后");
  expect(errors).toEqual([]);
  await page.context().storageState({ path: context.storageState });
  // 整轮可能超过再验证的十分钟；只交接一枚未用的本轮假账号恢复码。
  writeFileSync(
    process.env.LYX_ADMIN_LIVE_CONTEXT!,
    `${JSON.stringify({ ...context, stepUpRecoveryCode: recoveryCodes[1]! })}\n`,
    { mode: 0o600 },
  );
});
