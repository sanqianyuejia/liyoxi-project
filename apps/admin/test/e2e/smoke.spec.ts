// 后台冒烟（任务书 第 7 节第 2、3、11 条）：一条用例走完
//   打开外壳 → 样例筛选表格页翻页、改筛选（URL 查询参数随之变）→ 样例审核工作台处理一条并自动跳到下一条 → 样例详情页。
// 另断言：1366 × 768 下三个样例页没有横向滚动；请求带齐约定的请求头；二次确认勾选前不能点；
// 规范写明数值的几处（双行数据行高 56、高 40 的按钮圆角 8、主按钮悬停加深、弹窗关闭按钮 32 × 32 且距边 24）。
// 滚得到底：筛选表格页一屏装不下时，只用鼠标滚轮滚到底，最后一行与分页条都要完整可见（规范 第 5.1 节“内容区纵向滚动”）。
// 截图（1440 × 900）写到 dist/e2e-shots，CI 当产物上传：01–04 是验收要的外壳与三种骨架（02b 是筛选表格滚到底的样子），
// 05–12 是顺路留的几个状态（空、出错、处理后、冲突、上传失败、二次确认、403、已处理的事项）。断言用角色与文字定位，不用样式类名。
import { mkdirSync } from "node:fs";

import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  createSampleBackend,
  SAMPLE_API_PREFIX,
  type SampleBackend,
} from "../../src/dev/sample-backend";

const SHOTS_DIR = "dist/e2e-shots";
const MIN_VIEWPORT = { width: 1366, height: 768 };
const SHOT_VIEWPORT = { width: 1440, height: 900 };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function serveSamples(page: Page, backend: SampleBackend): Promise<void> {
  await page.route(`**${SAMPLE_API_PREFIX}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const response = backend.handle({
      method: request.method(),
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      headers: request.headers(),
      body: request.postDataJSON() as unknown,
    });
    await route.fulfill({
      status: response.status,
      contentType: "application/json",
      headers: { "X-Request-Id": request.headers()["x-request-id"] ?? "" },
      body: JSON.stringify(response.body),
    });
  });
}

/** 没有横向滚动：整页与内容区都要满足 scrollWidth <= clientWidth */
async function expectNoHorizontalScroll(page: Page, name: string): Promise<void> {
  expect(page.viewportSize(), name).toEqual(MIN_VIEWPORT);
  const widths = await page.evaluate(() => {
    const root = document.documentElement;
    const content = document.querySelector('[data-testid="shell-content"]');
    return {
      root: [root.scrollWidth, root.clientWidth],
      content: content ? [content.scrollWidth, content.clientWidth] : null,
    };
  });
  expect(widths.root[0], `${name}：整页的 scrollWidth`).toBeLessThanOrEqual(widths.root[1] ?? 0);
  expect(widths.content, `${name}：找不到内容区`).not.toBeNull();
  expect(widths.content?.[0], `${name}：内容区的 scrollWidth`).toBeLessThanOrEqual(
    widths.content?.[1] ?? 0,
  );
}

interface Visibility {
  top: number;
  bottom: number;
  /** 整个矩形在视口内，且上沿、下沿各往里 1px 处点得到它（没有被谁裁掉或盖住） */
  visible: boolean;
}

/** 元素现在是不是完整可见。只读：不滚动，也不等它变得可见 */
async function visibilityOf(target: Locator): Promise<Visibility> {
  return target.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const hit = (y: number): boolean => {
      const node = document.elementFromPoint(x, y);
      return node !== null && (node === element || element.contains(node));
    };
    return {
      top: Math.round(rect.top),
      bottom: Math.round(rect.bottom),
      visible:
        rect.top >= 0 &&
        rect.bottom <= window.innerHeight &&
        hit(rect.top + 1) &&
        hit(rect.bottom - 1),
    };
  });
}

/**
 * 用鼠标滚轮把内容区滚到底，再看给出的几样东西是不是都完整可见。
 * 只发滚轮事件：不调 scrollIntoView，也不用点击、悬停这类会先把目标滚出来的动作，那样测不出“人滚不到”
 *（第二轮复审的阻断项：表格卡被压进可见高度，后面的行与分页条被裁掉，鼠标与键盘都滚不到，冒烟却是绿的）。
 */
async function expectWheelReaches(
  page: Page,
  name: string,
  targets: Readonly<Record<string, Locator>>,
): Promise<void> {
  const content = page.getByTestId("shell-content");
  const size = page.viewportSize() ?? MIN_VIEWPORT;
  // 这一屏本来就装不下，下面的断言才量得出东西
  const before = await Promise.all(Object.values(targets).map(visibilityOf));
  expect(
    before.some((entry) => !entry.visible),
    `${name}：滚动之前就全看得见，量不出滚动`,
  ).toBe(true);

  await page.mouse.move(Math.round(size.width / 2), Math.round(size.height / 2));
  let scrollTop = await content.evaluate((element) => element.scrollTop);
  for (let round = 0; round < 40; round += 1) {
    await page.mouse.wheel(0, 400);
    // 等这一下滚轮生效；400 毫秒内没动就是到底了（或者根本滚不动）
    const next = await content.evaluate(async (element, from) => {
      const deadline = performance.now() + 400;
      while (performance.now() < deadline && element.scrollTop === from) {
        await new Promise((done) => requestAnimationFrame(done));
      }
      return element.scrollTop;
    }, scrollTop);
    if (next === scrollTop) break;
    scrollTop = next;
  }
  for (const [label, target] of Object.entries(targets)) {
    await expect
      .poll(() => visibilityOf(target), {
        message: `${name}：滚轮滚到底后，${label}要完整可见`,
        timeout: 3_000,
      })
      .toMatchObject({ visible: true });
  }
  // 滚的是内容区（规范 第 5.1 节）：表格卡自己不滚，也没有滚出横向滚动
  expect(scrollTop, `${name}：鼠标滚轮滚的应当是内容区`).toBeGreaterThan(0);
  const overflow = await content.evaluate((element) => ({
    horizontal: element.scrollWidth > element.clientWidth,
    innerScrollers: [...element.querySelectorAll("*")].filter((node) => node.scrollTop > 0).length,
  }));
  expect(overflow, `${name}：滚到底之后`).toEqual({ horizontal: false, innerScrollers: 0 });
}

/** 截图一律 1440 × 900（原型的画板尺寸），截完换回最小视口 */
async function resize(page: Page, size: { width: number; height: number }): Promise<void> {
  await page.setViewportSize(size);
  // 等窗口真的换了尺寸并重排完一帧再往下走
  await page.waitForFunction(
    ({ width, height }) =>
      window.innerWidth === width &&
      window.innerHeight === height &&
      document.documentElement.clientHeight === height,
    size,
  );
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
}

async function shot(page: Page, name: string): Promise<void> {
  await resize(page, SHOT_VIEWPORT);
  await page.mouse.move(0, 0);
  await page.screenshot({ path: `${SHOTS_DIR}/${name}.png`, animations: "disabled" });
  await resize(page, MIN_VIEWPORT);
}

const searchOf = (page: Page): URLSearchParams => new URL(page.url()).searchParams;

/** 一个设计变量算出来的颜色（浏览器的写法）：用例里不写色值，拿它与元素的颜色比 */
async function tokenColor(page: Page, variable: string): Promise<string> {
  return page.evaluate((name) => {
    const probe = document.createElement("span");
    probe.style.color = `var(${name})`;
    document.body.appendChild(probe);
    const value = getComputedStyle(probe).color;
    probe.remove();
    return value;
  }, variable);
}

/** 元素的高、宽与圆角 */
async function boxOf(target: Locator): Promise<{ width: number; height: number; radius: string }> {
  return target.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      width: rect.width,
      height: rect.height,
      radius: getComputedStyle(element).borderRadius,
    };
  });
}

test("外壳 → 筛选表格 → 审核工作台 → 详情页", async ({ page }) => {
  mkdirSync(SHOTS_DIR, { recursive: true });
  const backend = createSampleBackend();
  await serveSamples(page, backend);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await test.step("打开外壳：菜单、面包屑、用户区；V1.1 的菜单与两个隐藏的入口不出现", async () => {
    await page.goto("/merchants");
    const nav = page.getByRole("navigation", { name: "主菜单" });
    await expect(nav.getByRole("menuitem", { name: "工作台" })).toBeVisible();
    for (const title of [
      "短剧库",
      "套餐与积分",
      "商家",
      "订单",
      "交付",
      "发布",
      "客服",
      "财务",
      "报表",
      "运营",
      "系统",
    ]) {
      await expect(nav.getByRole("menuitem", { name: title, exact: true })).toBeVisible();
    }
    // 渠道是 V1.1 的模块，默认不显示（规范 第 14 节第 9 项）
    await expect(nav.getByRole("menuitem", { name: "渠道" })).toHaveCount(0);
    // 当前分组展开，当前页选中
    await expect(nav.getByRole("menuitem", { name: "商家列表" })).toBeVisible();
    await expect(nav.getByRole("menuitem", { name: "资质审核" })).toBeVisible();
    await expect(nav.getByRole("menuitem", { name: "商家列表" })).toHaveClass(/selected/);
    const crumbs = page.getByRole("navigation", { name: "面包屑" });
    await expect(crumbs).toContainText("商家");
    await expect(crumbs.locator('[aria-current="page"]')).toHaveText("商家列表");
    await expect(page.getByTestId("shell-user")).toContainText("周航");
    await expect(page.getByTestId("shell-user")).toContainText("超级管理员");
    // 全局搜索与通知入口隐藏（规范 第 14 节第 12 项）
    await expect(page.getByRole("searchbox")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /通知/ })).toHaveCount(0);
    // 还没实现的页面显示“页面建设中”
    await expect(page.getByRole("heading", { name: "页面建设中" })).toBeVisible();
    await shot(page, "01-shell");

    // 同一时刻只展开当前所在的分组：点开“订单”，“商家”收起
    await nav.getByRole("menuitem", { name: "订单", exact: true }).click();
    await expect(nav.getByRole("menuitem", { name: "对公收款确认" })).toBeVisible();
    await expect(nav.getByRole("menuitem", { name: "资质审核" })).toBeHidden();
    await nav.getByRole("menuitem", { name: "对公收款确认" }).click();
    await expect(page).toHaveURL(/\/orders\/receipts$/);
    await expect(crumbs.locator('[aria-current="page"]')).toHaveText("对公收款确认");

    // 没登记的地址：页面不存在
    await page.goto("/no/such/page");
    await expect(page.getByRole("heading", { name: "页面不存在" })).toBeVisible();
  });

  await test.step("筛选表格：翻页、改筛选、换页签、排序都进 URL", async () => {
    await page.goto("/dev/table");
    const table = page.getByRole("region", { name: "商家列表" });
    await expect(table.getByText("共 46 条")).toBeVisible();
    // 缺省每页 20 条：表头 1 行 + 数据 20 行
    await expect(table.getByRole("row")).toHaveCount(21);
    await expect(table.getByRole("tab", { name: /全部/ })).toHaveAttribute("aria-selected", "true");
    await expect(table.getByText("/ 3 页")).toBeVisible();
    expect(searchOf(page).toString()).toBe("");
    await expectNoHorizontalScroll(page, "筛选表格");
    // 行高（规范 第 5.2 节“数据行”）：表头 40；样例的每一行都有双行单元格，取 56 那一档
    const rowHeights = await table
      .getByRole("row")
      .evaluateAll((rows) => rows.map((row) => row.getBoundingClientRect().height));
    expect(rowHeights[0]).toBe(40);
    expect([...new Set(rowHeights.slice(1))]).toEqual([56]);
    await shot(page, "02-query-table");

    // 滚得到底：每页 20 条一屏装不下，鼠标滚轮滚到底后最后一行与分页条都看得全（先于下面的点击：点击会自己把按钮滚出来）
    await expectWheelReaches(page, "筛选表格（每页 20 条）", {
      最后一行: table.getByRole("row").last(),
      "分页条左侧的“共 46 条”": table.getByText("共 46 条"),
      "分页条右侧的“下一页”": table.getByRole("button", { name: "下一页" }),
    });
    await shot(page, "02b-query-table-scrolled-end");

    await table.getByRole("button", { name: "下一页" }).click();
    await expect(page).toHaveURL(/[?&]page=2(&|$)/);
    await expect(table.getByLabel("第 2 页")).toBeVisible();
    await expect(table.getByRole("row")).toHaveCount(21);

    // 改筛选：回到第 1 页，筛选值进 URL
    await table.getByRole("combobox", { name: "全部来源" }).click();
    // antd 下拉：role=option 的那一份只给读屏用、不可见，点可见的那一项（title 是选项文字）
    await page.getByTitle("销售", { exact: true }).click();
    await expect(page).toHaveURL(/[?&]source=sales(&|$)/);
    expect(searchOf(page).get("page")).toBeNull();
    await expect(table.getByText("共 23 条")).toBeVisible();

    // 换页签
    await table.getByRole("tab", { name: /待审核/ }).click();
    await expect(page).toHaveURL(/[?&]tab=pending(&|$)/);
    expect(searchOf(page).get("source")).toBe("sales");

    // 每页条数：10、20、50 三档
    await table.getByRole("tab", { name: /全部/ }).click();
    await table.getByRole("combobox", { name: "每页条数" }).click();
    for (const size of ["10 条", "20 条", "50 条"]) {
      await expect(page.getByRole("option", { name: size })).toHaveCount(1);
    }
    await expect(page.getByRole("option", { name: /^\d+ 条$/ })).toHaveCount(3);
    await page.getByTitle("10 条", { exact: true }).click();
    await expect(page).toHaveURL(/[?&]pageSize=10(&|$)/);
    await expect(table.getByRole("row")).toHaveCount(11);

    // 排序
    await table.getByRole("columnheader", { name: "可用积分" }).click();
    await expect(page).toHaveURL(/[?&]sort=availablePoints(&|$)/);
    await table.getByRole("columnheader", { name: "可用积分" }).click();
    await expect(page).toHaveURL(/[?&]sort=-availablePoints(&|$)/);

    // 刷新不丢筛选
    await page.reload();
    await expect(table.getByText("共 23 条")).toBeVisible();
    await expect(table.getByRole("row")).toHaveCount(11);
    // 刷新后回到顶上；每页 10 条在最小视口里同样装不下，再量一遍滚轮
    await expectWheelReaches(page, "筛选表格（每页 10 条）", {
      最后一行: table.getByRole("row").last(),
      "分页条左侧的“共 23 条”": table.getByText("共 23 条"),
      "分页条右侧的“下一页”": table.getByRole("button", { name: "下一页" }),
    });

    // 重置筛选；空状态；出错重试
    await table.getByRole("button", { name: "重置筛选" }).click();
    expect(searchOf(page).get("source")).toBeNull();
    await table.getByRole("searchbox", { name: "商家、主体名称" }).fill("没有这家店");
    await table.getByRole("searchbox", { name: "商家、主体名称" }).press("Enter");
    await expect(table.getByText("没有符合条件的记录")).toBeVisible();
    await shot(page, "05-query-table-empty");
    await table.getByRole("searchbox", { name: "商家、主体名称" }).fill("出错");
    await table.getByRole("searchbox", { name: "商家、主体名称" }).press("Enter");
    await expect(table.getByRole("alert")).toContainText("加载失败");
    await expect(table.getByRole("button", { name: "重新加载" })).toBeVisible();
    // 5xx 的全局提示带请求编号后 8 位
    await expect(page.getByText(/请求编号 [0-9a-f]{8}/).first()).toBeVisible();
    await shot(page, "06-query-table-error");

    const listRequest = backend.received.find((request) => request.path.endsWith("/stores"));
    expect(listRequest?.headers["x-client-version"]).toBeTruthy();
    expect(listRequest?.headers["x-request-id"]).toMatch(UUID);
    expect(listRequest?.headers["x-lyx-admin"]).toBeUndefined();
  });

  await test.step("审核工作台：清单没勾完不能通过；处理一条后自动跳到下一条；别人先处理了也跳下一条", async () => {
    await page.goto("/dev/queue");
    const queue = page.getByRole("region", { name: "资质审核的队列" });
    const detail = page.getByRole("region", { name: "资质审核的详情" });
    await expect(queue.getByRole("tab", { name: /待审核/ })).toContainText("4");
    await expect(queue.locator('[aria-current="true"]')).toContainText("青柠茶饮");
    await expect(detail.getByRole("heading", { level: 2 })).toHaveText("青柠茶饮（春熙路店）");
    const approve = detail.getByRole("button", { name: "审核通过" });
    await expect(approve).toBeDisabled();
    await expect(detail.getByRole("button", { name: "驳回" })).toBeEnabled();
    await expectNoHorizontalScroll(page, "审核工作台");
    await shot(page, "03-queue-workbench");

    for (const box of await detail.getByRole("checkbox").all()) await box.check();
    await expect(approve).toBeEnabled();
    // 高 40 的按钮圆角 8（规范 第 5.3 节）；主按钮悬停时底加深为文字主色，不是变浅（规范 第 12 节）
    for (const button of [approve, detail.getByRole("button", { name: "驳回" })]) {
      expect(await boxOf(button)).toMatchObject({ height: 40, radius: "8px" });
    }
    await approve.hover();
    await expect
      .poll(() => approve.evaluate((element) => getComputedStyle(element).backgroundColor))
      .toBe(await tokenColor(page, "--lyx-color-primary-text"));
    await approve.click();

    // 处理成功的提示是右上角通知；自动选中下一条；选中项进 URL；计数变化
    await expect(page.getByText("青柠茶饮（春熙路店）：审核已通过")).toBeVisible();
    await expect(detail.getByRole("heading", { level: 2 })).toHaveText("好运来便利店");
    await expect(page).toHaveURL(/[?&]id=rv-2(&|$)/);
    await expect(queue.getByRole("tab", { name: /待审核/ })).toContainText("3");
    await expect(queue.getByRole("tab", { name: /今日已审核/ })).toContainText("1");
    // 清单不带到下一条
    await expect(detail.getByRole("button", { name: "审核通过" })).toBeDisabled();
    await shot(page, "07-queue-after-approve");

    const post = backend.received.find((request) => request.method === "POST");
    expect(post?.path).toBe(`${SAMPLE_API_PREFIX}/reviews/rv-1/approve`);
    expect(post?.headers["x-lyx-admin"]).toBe("1");
    expect(post?.headers["idempotency-key"]).toMatch(/^queue:[0-9a-f-]{36}$/);
    expect(post?.headers["x-request-id"]).toMatch(UUID);
    expect(post?.headers["x-client-version"]).toBeTruthy();
    expect(post?.body).toEqual({ lockVersion: 1, checked: ["name", "term", "address"] });

    // 第三条已被别人处理：提示并跳到下一条
    await queue.getByRole("button", { name: /晴天洗衣/ }).click();
    await expect(page).toHaveURL(/[?&]id=rv-3(&|$)/);
    await detail.getByRole("button", { name: "驳回" }).click();
    // 提示由请求层出（右上角通知），同一句话只出现一处
    await expect(page.getByText("该事项已被林晓处理")).toBeVisible();
    await expect(page.getByText("该事项已被林晓处理")).toHaveCount(1);
    await expect(detail.getByRole("heading", { level: 2 })).toHaveText("XX 火锅（春熙店）");
    await shot(page, "08-queue-conflict");

    // 换页签进 URL；已处理的事项只读：操作条换成处理结果条（通过为成功色调），没有动作按钮
    await queue.getByRole("tab", { name: /今日已审核/ }).click();
    await expect(page).toHaveURL(/[?&]tab=done(&|$)/);
    await expect(page.getByTestId("queue-result")).toContainText("审核已通过");
    await expect(detail.getByRole("button", { name: "审核通过" })).toHaveCount(0);
    await expect(detail.getByRole("button", { name: "驳回" })).toHaveCount(0);
    // 通知（规范 第 8 节）：成功的 4 秒后自己消失；失败的不自动消失，要手动关
    await expect(page.getByText("青柠茶饮（春熙路店）：审核已通过")).toHaveCount(0);
    const failure = page.getByRole("alert").filter({ hasText: "该事项已被林晓处理" });
    await expect(failure).toBeVisible();
    await failure.getByRole("button", { name: "关闭" }).click();
    await expect(failure).toHaveCount(0);
    await shot(page, "12-queue-settled");
  });

  await test.step("详情页：从列表进入；父列表的菜单项保持选中；页签进 URL；二次确认与上传", async () => {
    await page.goto("/dev/table");
    await page.getByRole("link", { name: "详情" }).first().click();
    await expect(page).toHaveURL(/\/dev\/detail\/st-01$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("晴天洗衣");
    const nav = page.getByRole("navigation", { name: "主菜单" });
    await expect(nav.getByRole("menuitem", { name: "商家列表" })).toHaveClass(/selected/);
    const crumbs = page.getByRole("navigation", { name: "面包屑" });
    await expect(crumbs.locator('[aria-current="page"]')).toHaveText("商家详情");
    await expect(crumbs.getByRole("button", { name: "商家列表" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "套餐与积分" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "跟进记录" })).toBeDisabled();
    await expectNoHorizontalScroll(page, "详情页");
    await shot(page, "04-detail-page");

    await page.getByRole("tab", { name: "操作日志" }).click();
    await expect(page).toHaveURL(/[?&]tab=logs(&|$)/);
    await expect(page.getByRole("tabpanel")).toContainText("资质审核通过");

    // 上传：类型不对当场拒收；失败可重试
    await page.getByRole("tab", { name: "资质" }).click();
    const input = page.locator('input[type="file"]');
    await input.setInputFiles({
      name: "说明.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("x"),
    });
    await expect(page.getByRole("alert")).toContainText("文件类型不支持");
    await input.setInputFiles({
      name: "执照-失败.png",
      mimeType: "image/png",
      buffer: Buffer.from("png"),
    });
    await expect(page.getByRole("alert")).toContainText("上传失败");
    await shot(page, "09-detail-upload-failed");
    await page.getByRole("button", { name: "重试" }).click();
    await expect(page.getByText(/已上传，文件编号/)).toBeVisible();

    // 敏感确认：勾选前、输入关键值前确认按钮都禁用；提交时带上操作人看到的关键值
    await page.getByRole("button", { name: "禁用账号" }).click();
    const dialog = page.getByRole("dialog", { name: "禁用商家账号" });
    const confirm = dialog.getByRole("button", { name: "确认禁用" });
    await expect(confirm).toBeDisabled();
    await dialog.getByRole("checkbox").check();
    await expect(confirm).toBeDisabled();
    await dialog.getByRole("textbox", { name: "请输入联系电话后 4 位" }).fill("5018");
    await expect(confirm).toBeEnabled();
    // 弹窗（规范 第 5.3 节）：关闭按钮 32 × 32、圆角 8，贴着 24 的内边距；底部按钮高 40、圆角 8
    // 弹窗打开有一段缩放动画，量出来的尺寸要等它停稳：用轮询
    const close = dialog.getByRole("button", { name: "关闭" });
    await expect.poll(() => boxOf(close)).toEqual({ width: 32, height: 32, radius: "8px" });
    await expect
      .poll(async () => {
        const outer = await dialog.boundingBox();
        const inner = await close.boundingBox();
        if (!outer || !inner) return null;
        return { top: inner.y - outer.y, right: outer.x + outer.width - (inner.x + inner.width) };
      })
      .toEqual({ top: 24, right: 24 });
    for (const button of [confirm, dialog.getByRole("button", { name: "取消" })]) {
      await expect.poll(() => boxOf(button)).toMatchObject({ height: 40, radius: "8px" });
    }
    await shot(page, "10-detail-confirm-dialog");
    await confirm.click();
    await expect(page.getByText("晴天洗衣：账号已禁用")).toBeVisible();
    await expect(dialog).toBeHidden();
    await expect(page.getByText("已禁用", { exact: true })).toBeVisible();
    const disable = backend.received.find((request) => request.path.endsWith("/disable"));
    expect(disable?.body).toEqual({ lockVersion: 1, confirm: { phoneTail: "5018" } });
    expect(disable?.headers["idempotency-key"]).toMatch(/^sample-store-disable:[0-9a-f-]{36}$/);
  });

  await test.step("权限：换成客服的权限后看不到财务菜单，直接访问财务的地址去 403 页", async () => {
    await page.evaluate(() => localStorage.setItem("lyx.dev.role", "service"));
    await page.goto("/finance/refunds");
    await expect(page).toHaveURL(/\/403$/);
    await expect(page.getByRole("heading", { name: "没有访问权限" })).toBeVisible();
    const nav = page.getByRole("navigation", { name: "主菜单" });
    await expect(nav.getByRole("menuitem", { name: "客服", exact: true })).toBeVisible();
    await expect(nav.getByRole("menuitem", { name: "财务", exact: true })).toHaveCount(0);
    await expect(nav.getByRole("menuitem", { name: "系统", exact: true })).toHaveCount(0);
    await expect(page.getByTestId("shell-user")).toContainText("客服");
    await shot(page, "11-forbidden-403");
    await page.evaluate(() => localStorage.removeItem("lyx.dev.role"));
  });

  expect(pageErrors, "页面没有未捕获的脚本错误").toEqual([]);
});
