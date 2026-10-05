// 后台陈列页（看样页，W0-29）的冒烟：打得开，照规范分的每一组都渲染出来并标着节号，弹层点得开，页面没有报错；
// 逐组截图写到 dist/e2e-shots（CI 当产物上传），业主看样时可以先翻图：
//   showcase-00-top             页面顶部：外壳、页头、目录（1440 × 900）
//   showcase-<序号>-<组的 id>   每组一张，截整组（序号照 src/dev/showcase/sections.ts 的先后）
//   showcase-9x-…               弹窗、二次确认（勾选前后）、敏感确认、抽屉、成功与失败的轻提示
// 组数与名单不写在这里：登记里有什么就截什么。断言用角色与文字定位，不用样式类名。
import { mkdirSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

import { SHOWCASE_PATH, SHOWCASE_SECTIONS } from "../../src/dev/showcase/sections";

const SHOTS_DIR = "dist/e2e-shots";
const MIN_VIEWPORT = { width: 1366, height: 768 };
const SHOT_VIEWPORT = { width: 1440, height: 900 };

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `${SHOTS_DIR}/${name}.png`, animations: "disabled" });
}

test("陈列页：每组都在、标着规范的节号，逐组截图；弹层点得开", async ({ page }) => {
  mkdirSync(SHOTS_DIR, { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto(SHOWCASE_PATH);
  await expect(page.getByRole("heading", { level: 1, name: "组件陈列" })).toBeVisible();

  // 最小支持的视口下没有横向滚动（规范 第 5.1 节）
  expect(page.viewportSize()).toEqual(MIN_VIEWPORT);
  const content = page.getByTestId("shell-content");
  const widths = await content.evaluate((element) => [element.scrollWidth, element.clientWidth]);
  expect(widths[0], "内容区的 scrollWidth").toBeLessThanOrEqual(widths[1] ?? 0);

  await page.setViewportSize(SHOT_VIEWPORT);
  await shot(page, "showcase-00-top");

  // 目录里每组一条链接
  const toc = page.getByRole("navigation", { name: "陈列的分组" });
  await expect(toc.getByRole("link")).toHaveCount(SHOWCASE_SECTIONS.length);

  for (const [index, section] of SHOWCASE_SECTIONS.entries()) {
    const block = page.getByTestId(`showcase-${section.id}`);
    await expect(block.getByRole("heading", { level: 2, name: section.title })).toBeVisible();
    await expect(block.getByText(`规范 ${section.spec}`, { exact: true })).toBeVisible();
    // 滚的是内容区不是整页：把视口撑到比这一组高，整组才截得全
    const height = await block.evaluate((element) =>
      Math.ceil(element.getBoundingClientRect().height),
    );
    await page.setViewportSize({
      width: SHOT_VIEWPORT.width,
      height: Math.max(SHOT_VIEWPORT.height, height + 160),
    });
    await block.scrollIntoViewIfNeeded();
    const order = String(index + 1).padStart(2, "0");
    await block.screenshot({
      path: `${SHOTS_DIR}/showcase-${order}-${section.id}.png`,
      animations: "disabled",
    });
  }

  // 弹层与反馈：逐个点开
  await page.setViewportSize(SHOT_VIEWPORT);
  const overlays = page.getByTestId("showcase-overlays");
  await overlays.scrollIntoViewIfNeeded();

  await overlays.getByRole("button", { name: "打开弹窗" }).click();
  const modal = page.getByRole("dialog", { name: "分配服务经理" });
  await expect(modal).toBeVisible();
  await shot(page, "showcase-90-modal");
  await modal.getByRole("button", { name: "取消" }).click();
  await expect(modal).toBeHidden();

  await overlays.getByRole("button", { name: "打开二次确认" }).click();
  const confirm = page.getByRole("dialog", { name: "确认收款" });
  const confirmButton = confirm.getByRole("button", { name: "确认收款" });
  await expect(confirmButton).toBeDisabled();
  await shot(page, "showcase-91-confirm");
  await confirm.getByRole("checkbox", { name: "我已核对付款方与金额" }).check();
  await expect(confirmButton).toBeEnabled();
  await shot(page, "showcase-92-confirm-checked");
  await confirm.getByRole("button", { name: "取消" }).click();
  await expect(confirm).toBeHidden();

  await overlays.getByRole("button", { name: "打开敏感确认（危险实心）" }).click();
  const refund = page.getByRole("dialog", { name: "执行退款" });
  await refund.getByRole("checkbox", { name: "我已核对退款金额与收款账户" }).check();
  // 勾了还不够：敏感确认另要照着输入关键值
  await expect(refund.getByRole("button", { name: "确认退款" })).toBeDisabled();
  await refund.getByPlaceholder("如：1280.50").fill("1280.50");
  await expect(refund.getByRole("button", { name: "确认退款" })).toBeEnabled();
  await shot(page, "showcase-93-confirm-danger");
  await refund.getByRole("button", { name: "取消" }).click();
  await expect(refund).toBeHidden();

  await overlays.getByRole("button", { name: "打开抽屉" }).click();
  const drawer = page.getByRole("dialog", { name: "付款单详情" });
  await expect(drawer).toBeVisible();
  await shot(page, "showcase-94-drawer");
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();

  await overlays.getByRole("button", { name: "成功的提示" }).click();
  await overlays.getByRole("button", { name: "失败的提示" }).click();
  await expect(page.getByText("收款已确认，已通知商家")).toBeVisible();
  await expect(page.getByText("没有保存成功，请稍后重试")).toBeVisible();
  await shot(page, "showcase-95-notices");

  expect(errors, "页面报错").toEqual([]);
});
