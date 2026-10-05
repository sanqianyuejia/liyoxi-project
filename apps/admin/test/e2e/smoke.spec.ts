// 后台冒烟（任务书 第 7 节第 2、3、11 条）：一条用例走完
//   打开外壳 → 样例筛选表格页翻页、改筛选（URL 查询参数随之变）→ 样例审核工作台处理一条并自动跳到下一条 → 样例详情页。
// 另断言：1366 × 768 下三个样例页没有横向滚动；请求带齐约定的请求头；二次确认勾选前不能点；
// 规范写明数值的几处（双行数据行高 56、高 40 的按钮圆角 8、主按钮悬停加深、弹窗关闭按钮 32 × 32 且距边 24）。
// 滚得到底：筛选表格页一屏装不下时，只用鼠标滚轮滚到底，最后一行与分页条都要完整可见（规范 第 5.1 节“内容区纵向滚动”）。
// 另有一步不经样例页最外层那层容器：直接放进内容区的高区块同样滚得到底（钉住外壳那条“直接子项不压缩”）。
// 弹窗两个方向居中（规范 第 5.3 节）；按钮、文字链、弹窗关闭键用键盘走到时是主色聚焦环（规范 第 12 节），没有 antd 缺省的浅色描边。
// 截图（1440 × 900）写到 dist/e2e-shots，CI 当产物上传：01–04 是验收要的外壳与三种骨架（02b 是筛选表格滚到底的样子），
// 05–12 是顺路留的几个状态（空、出错、处理后、冲突、上传失败、二次确认、403、已处理的事项）。断言用角色与文字定位，不用样式类名。
// 第四轮复审之后加的两步：规范写明数值的又几处（卡片内的分区标题 14px、下拉左右内边距 10、数字等宽）；
// 整行可点的表格（样例页 /dev/rows，截图 13）：点行里的文字链、按钮，或焦点在它们上面按回车，不触发整行的动作；
// 分段控件用 Tab 走到的两站（容器自己、里面的项）都是主色聚焦环；抽屉用键盘打开时根节点上没有描边。键盘一律真按 Tab 走。
// 第五轮复审之后加的两步：各级标题的行高 1.3、没有另写行高的正文段落 1.6（规范 第 2.3 节），表单控件里的数字同样等宽（第 2.4 节）；
// 表单提交有错时滚到第一个出错的字段（样例页 /dev/form，截图 14）：字段落在内容区中间，标签与错误提示一起看得见（第 8 节）。
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
  let stalls = 0;
  for (let round = 0; round < 40 && stalls < 2; round += 1) {
    await page.mouse.wheel(0, 400);
    // 等这一下滚轮生效；400 毫秒内没动算一次“没滚动”，连着两次就是到底了（或者根本滚不动）
    const next = await content.evaluate(async (element, from) => {
      const deadline = performance.now() + 400;
      while (performance.now() < deadline && element.scrollTop === from) {
        await new Promise((done) => requestAnimationFrame(done));
      }
      return element.scrollTop;
    }, scrollTop);
    stalls = next === scrollTop ? stalls + 1 : 0;
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

/** 样式变量里的阴影算出来的 box-shadow（浏览器的写法）：聚焦环拿它比，用例里不写色值 */
async function tokenShadow(page: Page, variable: string): Promise<string> {
  return page.evaluate((name) => {
    const probe = document.createElement("span");
    probe.style.boxShadow = `var(${name})`;
    document.body.appendChild(probe);
    const value = getComputedStyle(probe).boxShadow;
    probe.remove();
    return value;
  }, variable);
}

/**
 * 键盘走到一个元素之后：焦点在它上面、浏览器按键盘聚焦算（:focus-visible），样子是规范 第 12 节的主色聚焦环，
 * 没有 Ant Design 缺省的那圈浅色描边（第三轮复审的阻断项）。调用之前要用真实的按键（Tab）把焦点送过来。
 */
async function expectFocusRing(page: Page, target: Locator, name: string): Promise<void> {
  await expect(target, `${name}：按 Tab 之后焦点应当在它上面`).toBeFocused();
  const ring = await tokenShadow(page, "--lyx-shadow-focus-ring");
  await expect
    .poll(
      () =>
        target.evaluate((element) => {
          const style = getComputedStyle(element);
          return {
            keyboard: element.matches(":focus-visible"),
            outline: style.outlineStyle,
            ring: style.boxShadow,
          };
        }),
      { message: `${name}：键盘聚焦时应当是主色聚焦环` },
    )
    .toEqual({ keyboard: true, outline: "none", ring });
}

/** 弹窗四边到视口四边的留白：上下之差、左右之差（取整） */
async function offCenter(
  page: Page,
  dialog: Locator,
): Promise<{ vertical: number; horizontal: number } | null> {
  const box = await dialog.boundingBox();
  const size = page.viewportSize();
  if (!box || !size) return null;
  return {
    vertical: Math.round(Math.abs(box.y - (size.height - box.y - box.height))),
    horizontal: Math.round(Math.abs(box.x - (size.width - box.x - box.width))),
  };
}

/**
 * 控件的外框（带描边的那一层）的高与左右内边距：从控件里拿到焦点的那个输入往上找，第一个有描边的祖先就是外框。
 * 输入框、下拉是同一行规格（规范 第 5.3、5.4 节：高 36、左右内边距 10），用它量两种控件，不靠样式类名。
 */
async function framePadding(
  target: Locator,
): Promise<{ height: number; left: string; right: string } | null> {
  return target.evaluate((element) => {
    let frame: Element | null = element;
    while (frame && getComputedStyle(frame).borderTopWidth === "0px") frame = frame.parentElement;
    if (!frame) return null;
    const style = getComputedStyle(frame);
    return {
      // 取整：外框的高由文字行高撑出来，不同字体下会差出零点零几个像素
      height: Math.round(frame.getBoundingClientRect().height),
      left: style.paddingLeft,
      right: style.paddingRight,
    };
  });
}

/** 元素的 font-variant-numeric（规范 第 2.4 节：所有数字等宽） */
async function numericOf(target: Locator): Promise<string> {
  return target.evaluate((element) => getComputedStyle(element).fontVariantNumeric);
}

/** 行高是字号的几倍（三位小数）。规范 第 2.3 节：标题与双行单元格 1.3，段落 1.6 */
async function lineHeightRatio(target: Locator): Promise<number> {
  return target.evaluate((element) => {
    const style = getComputedStyle(element);
    const ratio = Number.parseFloat(style.lineHeight) / Number.parseFloat(style.fontSize);
    return Math.round(ratio * 1000) / 1000;
  });
}

/** 一个取值是数的设计变量（行高的倍数）：用例里不写数值，拿它与元素的行高比 */
async function tokenNumber(page: Page, variable: string): Promise<number> {
  return page.evaluate(
    (name) => Number(getComputedStyle(document.documentElement).getPropertyValue(name)),
    variable,
  );
}

/** 元素的上沿、下沿、中线（相对视口） */
async function edgesOf(target: Locator): Promise<{ top: number; bottom: number; middle: number }> {
  return target.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom, middle: (rect.top + rect.bottom) / 2 };
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

  await test.step("内容区的直接子项不被压缩：不经样例页那层容器，区块再高也滚得到底", async () => {
    // 还没实现的页面：页头与卡片直接就是内容区的子项（三个样例页最外层另包了一层 display: contents 的容器，
    // 外壳那条“直接子项不压缩”落在那层容器上，量不到）
    await page.goto("/merchants");
    await expect(page.getByRole("heading", { name: "页面建设中" })).toBeVisible();
    // 往内容区里直接放一个裁圆角的高区块：设了 overflow 的弹性子项最小高度按 0 算，正是会被压进可见高度的那一种
    await page.getByTestId("shell-content").evaluate((content) => {
      const block = document.createElement("section");
      block.className = "lyx-card";
      block.style.overflow = "hidden";
      block.setAttribute("aria-label", "冒烟用的高区块");
      for (let index = 1; index <= 40; index += 1) {
        const line = document.createElement("p");
        line.textContent = `第 ${index} 行`;
        block.appendChild(line);
      }
      content.appendChild(block);
    });
    const block = page.getByRole("region", { name: "冒烟用的高区块" });
    await expectWheelReaches(page, "直接放进内容区的高区块", {
      最后一行: block.getByText("第 40 行", { exact: true }),
    });
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

    // 键盘聚焦（规范 第 12 节）：从最后一个可排序的表头按 Tab，走到操作列的第一个文字链，是主色聚焦环
    await table.getByRole("columnheader", { name: "累计实付" }).focus();
    await page.keyboard.press("Tab");
    await expectFocusRing(
      page,
      table.getByRole("link", { name: "详情" }).first(),
      "表格里的文字链",
    );

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
    // 键盘聚焦：从最后一个复选框按 Tab，依次走到“驳回”（危险描边）与“审核通过”（主按钮），都是主色聚焦环
    await detail.getByRole("checkbox").last().focus();
    await page.keyboard.press("Tab");
    await expectFocusRing(page, detail.getByRole("button", { name: "驳回" }), "危险描边按钮");
    await page.keyboard.press("Tab");
    await expectFocusRing(page, approve, "主按钮");
    await approve.hover();
    await expect
      .poll(() => approve.evaluate((element) => getComputedStyle(element).backgroundColor))
      .toBe(await tokenColor(page, "--lyx-color-primary-text"));
    await approve.click();

    // 处理成功的提示是右上角通知；自动选中下一条；选中项进 URL；计数变化
    await expect(page.getByText("青柠茶饮（春熙路店）：审核已通过")).toBeVisible();
    // 操作结果用状态播报（规范 第 10 节）：成功的通知是 role=status
    await expect(
      page.getByRole("status").filter({ hasText: "青柠茶饮（春熙路店）：审核已通过" }),
    ).toBeVisible();
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
    // 提示条无描边（规范 第 5.3 节）：antd 自带的 1px 描边去掉了
    expect(
      await page
        .getByTestId("queue-result")
        .evaluate((element) => getComputedStyle(element).borderTopWidth),
    ).toBe("0px");
    // 提示条的字色取色调的文字色，不是正文色（规范 第 5.3 节“提示条”：色调取 1.4 的“文字 + 浅底”）
    const settledText = page.getByTestId("queue-result").getByText("审核已通过，已通知商家");
    expect(await settledText.evaluate((element) => getComputedStyle(element).color)).toBe(
      await tokenColor(page, "--lyx-color-success"),
    );
    // 已处理事项的状态标签取状态字典：队列项上与详情卡右上角是同一个色调（已通过为成功色调），不是一处绿一处灰
    for (const tag of [
      queue.locator('[aria-current="true"]').getByText("已通过", { exact: true }),
      detail.getByText("已通过", { exact: true }),
    ]) {
      expect(await tag.evaluate((element) => getComputedStyle(element).color)).toBe(
        await tokenColor(page, "--lyx-color-success"),
      );
    }
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
    // 弹窗两个方向都居中（规范 第 5.3 节“弹窗｜居中”）：上下留白相等、左右留白相等；最小视口与原型的画板尺寸各量一遍
    for (const size of [MIN_VIEWPORT, SHOT_VIEWPORT, MIN_VIEWPORT]) {
      await resize(page, size);
      await expect
        .poll(() => offCenter(page, dialog), {
          message: `弹窗在 ${size.width} × ${size.height} 下应当两个方向都居中`,
        })
        .toEqual({ vertical: 0, horizontal: 0 });
    }
    // 带框勾选行的文字 13px（规范 第 5.3 节）
    expect(
      await dialog
        .getByText("我已核对门店与联系电话，确认禁用")
        .evaluate((element) => getComputedStyle(element).fontSize),
    ).toBe("13px");
    await shot(page, "10-detail-confirm-dialog");
    // 键盘聚焦：弹窗的关闭键、“取消”（次按钮）、“确认禁用”（危险实心）用 Tab 走到时都是主色聚焦环
    await dialog.getByRole("textbox", { name: "请输入联系电话后 4 位" }).focus();
    await page.keyboard.press("Shift+Tab");
    await expectFocusRing(page, close, "弹窗关闭键");
    await dialog.getByRole("checkbox").focus();
    await page.keyboard.press("Tab");
    await expectFocusRing(page, dialog.getByRole("button", { name: "取消" }), "次按钮");
    await page.keyboard.press("Tab");
    await expectFocusRing(page, confirm, "危险实心按钮");
    await confirm.click();
    await expect(page.getByText("晴天洗衣：账号已禁用")).toBeVisible();
    await expect(dialog).toBeHidden();
    await expect(page.getByText("已禁用", { exact: true })).toBeVisible();
    const disable = backend.received.find((request) => request.path.endsWith("/disable"));
    expect(disable?.body).toEqual({ lockVersion: 1, confirm: { phoneTail: "5018" } });
    expect(disable?.headers["idempotency-key"]).toMatch(/^sample-store-disable:[0-9a-f-]{36}$/);
  });

  await test.step("规范写明数值的又几处：卡片内的分区标题 14px、下拉左右内边距 10、数字等宽", async () => {
    // 卡片内的分区标题（h3）14px / 600（规范 第 2.3 节 title-sm、第 13 节“分区 14”）：骨架出的“核对清单”与样例页写的一处
    await page.goto("/dev/queue");
    const queue = page.getByRole("region", { name: "资质审核的队列" });
    const detail = page.getByRole("region", { name: "资质审核的详情" });
    await expect(detail.getByRole("heading", { level: 2 })).toBeVisible();
    for (const name of ["核对清单", "营业执照 · 识别结果"]) {
      expect(
        await detail.getByRole("heading", { level: 3, name }).evaluate((element) => {
          const style = getComputedStyle(element);
          return { size: style.fontSize, weight: style.fontWeight };
        }),
        `卡片内的分区标题“${name}”`,
      ).toEqual({ size: "14px", weight: "600" });
    }
    // 数字等宽（规范 第 2.4 节）：加在 body 上全站继承；队列项（带提交时间）、详情卡（带截止时间）、页头副标题都继承得到
    expect(await numericOf(page.locator("body")), "body").toBe("tabular-nums");
    for (const [name, target] of Object.entries({
      队列项: queue.getByRole("button", { name: /XX 火锅/ }),
      详情卡: detail.getByRole("heading", { level: 2 }),
      面包屑: page.getByRole("navigation", { name: "面包屑" }),
      用户区: page.getByTestId("shell-user"),
    })) {
      expect(await numericOf(target), `${name}的数字`).toBe("tabular-nums");
    }

    // 卡片这一级的标题（h2）仍是 15px（title-md）
    await page.goto("/dev/detail/st-01");
    const sectionTitle = page.getByRole("heading", { level: 2, name: "基础信息" });
    await expect(sectionTitle).toBeVisible();
    expect(await sectionTitle.evaluate((element) => getComputedStyle(element).fontSize)).toBe(
      "15px",
    );
    expect(await numericOf(page.getByRole("tabpanel")), "详情页的信息列表").toBe("tabular-nums");

    // 下拉与输入框同一行规格：高 36、左右内边距 10（规范 第 5.3、5.4 节）。没选值的、选了值的各量一遍，与搜索框相同
    await page.goto("/dev/table?source=sales");
    const table = page.getByRole("region", { name: "商家列表" });
    await expect(table.getByText("共 23 条")).toBeVisible();
    const searchFrame = await framePadding(
      table.getByRole("searchbox", { name: "商家、主体名称" }),
    );
    expect(searchFrame, "搜索框的外框").toEqual({ height: 36, left: "10px", right: "10px" });
    for (const name of ["全部区域", "全部来源"]) {
      expect(
        await framePadding(table.getByRole("combobox", { name })),
        `下拉“${name}”的外框`,
      ).toEqual(searchFrame);
    }
    // 下拉浮层里的选项（“10 条”一类）同样等宽：antd 把浮层的 font-variant 设回了初始值，样式里接回来了
    await table.getByRole("combobox", { name: "每页条数" }).click();
    expect(await numericOf(page.getByTitle("10 条", { exact: true })), "下拉浮层的选项").toBe(
      "tabular-nums",
    );
    await page.keyboard.press("Escape");
  });

  await test.step("整行可点的表格：行内的文字链、按钮各管各的；分段控件、抽屉用键盘走到时的样子", async () => {
    await page.goto("/dev/rows");
    const table = page.getByRole("region", { name: "对公付款单" });
    const log = page.getByTestId("rows-log");
    const drawer = page.getByRole("dialog", { name: "付款单详情" });
    await expect(table.getByRole("row")).toHaveCount(4);
    await expect(log).toContainText("整行动作 0 次 · 行内按钮 0 次 · 正在看的凭证：无");
    await expectNoHorizontalScroll(page, "整行可点的表格");
    const firstRow = table.getByRole("row").nth(1);

    // 鼠标点行里的空白（付款方那一格）：整行的动作，右侧抽屉打开
    await firstRow.getByRole("cell").first().click();
    await expect(drawer).toBeVisible();
    await expect(log).toContainText("整行动作 1 次 · 行内按钮 0 次");
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    // 点行里的按钮：只算按钮自己的，整行的动作不跟着触发
    await firstRow.getByRole("button", { name: "确认收款" }).click();
    await expect(log).toContainText("整行动作 1 次 · 行内按钮 1 次");
    await expect(drawer).toBeHidden();
    // 点行里的文字链：只走链接（地址带上凭证），整行的动作不跟着触发
    await table.getByRole("row").nth(2).getByRole("link", { name: "查看凭证" }).click();
    await expect(page).toHaveURL(/[?&]voucher=pay-2(&|$)/);
    await expect(log).toContainText("整行动作 1 次 · 行内按钮 1 次 · 正在看的凭证：pay-2");
    await expect(drawer).toBeHidden();

    // 键盘：先点一下说明条（它不能聚焦，只为把起点定在表格卡前面），之后全用真实的 Tab 走
    const ring = await tokenShadow(page, "--lyx-shadow-focus-ring");
    await log.click();
    await page.keyboard.press("Tab");
    // 分段控件第一站：容器自己（它带 tabindex）。主色聚焦环，没有 antd 缺省的浅色描边（第四轮复审的阻断项）
    const segmented = page.getByRole("radiogroup", { name: "收款状态" });
    await expectFocusRing(page, segmented, "分段控件（容器这一站）");
    // 第二站：进到里面的项，环仍画在整条轨道上
    await page.keyboard.press("Tab");
    await expect(segmented.getByRole("radio", { name: "全部" })).toBeFocused();
    await expect
      .poll(
        () =>
          segmented.evaluate((element) => {
            const style = getComputedStyle(element);
            return { outline: style.outlineStyle, ring: style.boxShadow };
          }),
        { message: "分段控件（里面的项这一站）：环画在整条轨道上" },
      )
      .toEqual({ outline: "none", ring });
    // 第三站：第一行。可点的行是向内的 2px 主色环；回车触发整行的动作
    await page.keyboard.press("Tab");
    await expect(firstRow).toBeFocused();
    await expect
      .poll(() =>
        firstRow.evaluate((element) => {
          const style = getComputedStyle(element);
          return {
            keyboard: element.matches(":focus-visible"),
            style: style.outlineStyle,
            width: style.outlineWidth,
            offset: style.outlineOffset,
            color: style.outlineColor,
          };
        }),
      )
      .toEqual({
        keyboard: true,
        style: "solid",
        width: "2px",
        offset: "-2px",
        color: await tokenColor(page, "--lyx-color-primary"),
      });
    await page.keyboard.press("Enter");
    await expect(drawer).toBeVisible();
    await expect(log).toContainText("整行动作 2 次 · 行内按钮 1 次");
    // 抽屉用键盘打开：焦点先落在整个抽屉这一层上（它包着对话框）。那是容器不是控件，不画环，也没有浏览器缺省的描边
    await expect
      .poll(() =>
        page.evaluate(() => {
          const active = document.activeElement;
          const dialog = document.querySelector('[role="dialog"]');
          if (!active || !dialog) return null;
          const style = getComputedStyle(active);
          return {
            holdsDialog: active !== dialog && active.contains(dialog),
            keyboard: active.matches(":focus-visible"),
            outline: style.outlineStyle,
          };
        }),
      )
      .toEqual({ holdsDialog: true, keyboard: true, outline: "none" });
    await page.keyboard.press("Tab");
    await expectFocusRing(page, drawer.getByRole("button", { name: "关闭" }), "抽屉的关闭键");
    await shot(page, "13-clickable-rows-drawer");
    // Esc 关闭，焦点回到触发的那一行（规范 第 10 节“弹层”）
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(firstRow).toBeFocused();

    // 焦点在行里的文字链上按回车：只走链接。浏览器会给链接补发一次点击，它不该冒泡成整行的动作
    await page.keyboard.press("Tab");
    await expectFocusRing(page, firstRow.getByRole("link", { name: "查看凭证" }), "行里的文字链");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/[?&]voucher=pay-1(&|$)/);
    await expect(log).toContainText("整行动作 2 次 · 行内按钮 1 次 · 正在看的凭证：pay-1");
    await expect(drawer).toBeHidden();
    // 焦点在行里的按钮上按回车：只算按钮自己的
    await page.keyboard.press("Tab");
    await expectFocusRing(
      page,
      firstRow.getByRole("button", { name: "确认收款" }),
      "行里的小号按钮",
    );
    await page.keyboard.press("Enter");
    await expect(log).toContainText("整行动作 2 次 · 行内按钮 2 次 · 正在看的凭证：pay-1");
    await expect(drawer).toBeHidden();
  });

  await test.step("各级标题的行高 1.3，没有另写行高的正文段落 1.6；表单控件里的数字等宽", async () => {
    const title = await tokenNumber(page, "--lyx-line-height-title");
    const body = await tokenNumber(page, "--lyx-line-height-body");
    expect(title).toBeLessThan(body);
    const expectRatios = async (
      expected: number,
      targets: Readonly<Record<string, Locator>>,
    ): Promise<void> => {
      for (const [name, target] of Object.entries(targets)) {
        await expect(target, name).toBeVisible();
        expect(await lineHeightRatio(target), `${name}的行高`).toBe(expected);
      }
    };

    // 审核工作台：页头标题、详情卡标题、卡片内的分区标题是标题；页头副标题、详情卡说明、队列项、核对项、操作条提示是正文
    await page.goto("/dev/queue");
    const queue = page.getByRole("region", { name: "资质审核的队列" });
    const detail = page.getByRole("region", { name: "资质审核的详情" });
    await expect(detail.getByRole("heading", { level: 2 })).toBeVisible();
    await expectRatios(title, {
      页头标题: page.getByRole("heading", { level: 1 }),
      详情卡标题: detail.getByRole("heading", { level: 2 }),
      "分区标题“核对清单”": detail.getByRole("heading", { level: 3, name: "核对清单" }),
      "分区标题“营业执照 · 识别结果”": detail.getByRole("heading", {
        level: 3,
        name: "营业执照 · 识别结果",
      }),
    });
    await expectRatios(body, {
      页头副标题: page.getByText("样例页：审核工作台骨架", { exact: false }),
      详情卡的说明: detail.getByRole("heading", { level: 2 }).locator("xpath=following-sibling::p"),
      队列项: queue.getByRole("button", { name: /XX 火锅/ }),
      信息列表的值: detail.getByRole("definition").first(),
      核对项的文字: detail.getByRole("checkbox").first().locator("xpath=ancestor::label"),
      操作条左侧的提示: detail.getByText("核对清单全部勾选后才能通过"),
    });

    // 详情页：面板里卡片这一级的标题、侧栏信息卡标题、弹窗标题是标题；信息列表的值、弹窗的说明是正文
    // （st-01 在前面那一步已经禁用了，没有“禁用账号”按钮，这里换一家）
    await page.goto("/dev/detail/st-02");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("悦心瑜伽");
    await expectRatios(title, {
      "面板里的标题“基础信息”": page.getByRole("heading", { level: 2, name: "基础信息" }),
      "侧栏信息卡标题“套餐与积分”": page.getByRole("heading", { level: 2, name: "套餐与积分" }),
    });
    await expectRatios(body, {
      信息列表的值: page.getByRole("tabpanel").getByRole("definition").first(),
    });
    // 上传区：没有浏览器给按钮的缺省内边距（1px 6px，不在间距阶梯里），上下 0、左右取阶梯里的一档；文字是正文
    await page.getByRole("tab", { name: "资质" }).click();
    const zone = page.getByRole("button", { name: "点击上传营业执照" });
    await expectRatios(body, { 上传区的文字: zone });
    const ladder = await page.evaluate(() =>
      [2, 4, 6, 8, 10, 12, 14, 16, 20, 24].map((step) =>
        getComputedStyle(document.documentElement).getPropertyValue(`--lyx-space-${step}`).trim(),
      ),
    );
    const zonePadding = await zone.evaluate((element) => {
      const style = getComputedStyle(element);
      return { block: style.paddingTop, inline: style.paddingLeft };
    });
    expect(zonePadding.block).toBe("0px");
    expect(ladder).toContain(zonePadding.inline);
    await page.getByRole("button", { name: "禁用账号" }).click();
    const dialog = page.getByRole("dialog", { name: "禁用商家账号" });
    await expectRatios(title, { 弹窗标题: dialog.getByText("禁用商家账号", { exact: true }) });
    await expectRatios(body, {
      弹窗的说明: dialog.locator("p").first(),
      弹窗里信息块的值: dialog.getByRole("definition").first(),
    });
    // 输入框里的数字同样等宽：浏览器给表单控件的缺省字体会把这个属性重置掉，样式里显式继承了
    const phoneTail = dialog.getByRole("textbox", { name: "请输入联系电话后 4 位" });
    expect(await numericOf(phoneTail), "弹窗里的输入框").toBe("tabular-nums");
    expect(await numericOf(dialog.getByRole("button", { name: "确认禁用" })), "按钮").toBe(
      "tabular-nums",
    );
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    // 筛选表格：单元格的文字是正文；搜索框、分页的小按钮里的数字等宽；空状态的标题是标题、说明是正文
    await page.goto("/dev/table");
    const table = page.getByRole("region", { name: "商家列表" });
    await expect(table.getByText("共 46 条")).toBeVisible();
    await expectRatios(body, { 单元格的文字: table.getByRole("cell", { name: "销售" }).first() });
    const keyword = table.getByRole("searchbox", { name: "商家、主体名称" });
    expect(await numericOf(keyword), "搜索框").toBe("tabular-nums");
    expect(await numericOf(table.getByRole("button", { name: "下一页" })), "分页的小按钮").toBe(
      "tabular-nums",
    );
    // 可排序表头里没点亮的排序箭头取色板里的禁用色（antd 缺省算出来的颜色不在色板里）
    expect(
      await table
        .getByRole("columnheader", { name: "可用积分" })
        .locator("svg")
        .first()
        .evaluate((element) => getComputedStyle(element).color),
      "没点亮的排序箭头",
    ).toBe(await tokenColor(page, "--lyx-color-text-disabled"));
    await keyword.fill("没有这家店");
    await keyword.press("Enter");
    await expectRatios(title, { 空状态的标题: table.getByText("没有符合条件的记录") });
    await expectRatios(body, { 空状态的说明: table.getByText("换个筛选条件试试") });

    // 抽屉：标题是标题，里面的信息列表是正文
    await page.goto("/dev/rows");
    const rows = page.getByRole("region", { name: "对公付款单" });
    // 分段控件的选中项只是白底，不带阴影（规范 第 3 节：只有浮层有阴影）
    expect(
      await page
        .getByRole("radiogroup", { name: "收款状态" })
        .locator("label")
        .filter({ hasText: "全部" })
        .evaluate((element) => getComputedStyle(element).boxShadow),
      "分段控件选中项的阴影",
    ).toBe("none");
    await rows.getByRole("row").nth(1).getByRole("cell").first().click();
    const drawer = page.getByRole("dialog", { name: "付款单详情" });
    await expectRatios(title, { 抽屉标题: drawer.getByText("付款单详情", { exact: true }) });
    await expectRatios(body, { 抽屉里信息列表的值: drawer.getByRole("definition").first() });
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();

    // 整页说明（页面不存在）：标题是标题，说明是正文
    await page.goto("/no/such/page");
    await expectRatios(title, {
      整页说明的标题: page.getByRole("heading", { name: "页面不存在" }),
    });
    await expectRatios(body, {
      整页说明的说明: page.getByText("地址可能写错了", { exact: false }),
    });
  });

  await test.step("表单提交有错：滚到第一个出错的字段，落在内容区中间，标签与错误提示一起看得见", async () => {
    await page.goto("/dev/form");
    const form = page.getByRole("form", { name: "商家档案" });
    const content = page.getByTestId("shell-content");
    const save = form.getByRole("button", { name: "保存档案" });
    await expect(form.getByRole("textbox", { name: "主体名称" })).toHaveValue(/晴天/);
    await expectNoHorizontalScroll(page, "表单样例");
    // antd 卡片的标题是标题（行高 1.3）；字段下方的辅助说明是正文（1.6）；多行输入里的数字等宽
    expect(await lineHeightRatio(form.getByText("主体信息", { exact: true })), "卡片标题").toBe(
      await tokenNumber(page, "--lyx-line-height-title"),
    );
    expect(await lineHeightRatio(form.getByText("只有运营看得到", { exact: false }))).toBe(
      await tokenNumber(page, "--lyx-line-height-body"),
    );
    expect(await numericOf(form.getByRole("textbox", { name: "备注（选填）" })), "多行输入").toBe(
      "tabular-nums",
    );

    // 标签在上，标签文字的下沿到控件的上沿是 6；上一个控件的下沿到下一个标签的上沿是 14（规范 第 3、5.3 节）
    const spaceOf = (step: number): Promise<number> =>
      page.evaluate(
        (name) =>
          Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)),
        `--lyx-space-${step}`,
      );
    const nameLabel = await edgesOf(form.getByText("主体名称", { exact: true }));
    const nameInput = await edgesOf(form.getByRole("textbox", { name: "主体名称" }));
    const codeLabel = await edgesOf(form.getByText("统一社会信用代码", { exact: true }));
    expect(Math.round((nameInput.top - nameLabel.bottom) * 100) / 100, "标签到控件").toBe(
      await spaceOf(6),
    );
    expect(Math.round((codeLabel.top - nameInput.bottom) * 100) / 100, "字段之间").toBe(
      await spaceOf(14),
    );

    // 表单比一屏长：用滚轮滚到底，“保存档案”才看得全；这时第一个没填的必填项（所在区域）在视野之外
    await expectWheelReaches(page, "表单样例", { "“保存档案”": save });
    const district = form.getByRole("combobox", { name: "所在区域" });
    const frame = district.locator("xpath=ancestor::*[contains(@class, 'ant-select')][1]");
    expect((await visibilityOf(frame)).visible, "滚到底时“所在区域”应当在视野之外").toBe(false);
    await save.click();

    // 出错的字段：控件标记为无效，下方出现错误提示（规范 第 5.3 节“错误提示”、第 10 节“出错的控件标记为无效”）
    const error = form.getByText("请选择所在区域", { exact: true });
    await expect(error).toBeVisible();
    await expect(district).toHaveAttribute("aria-invalid", "true");
    expect(await lineHeightRatio(error), "错误提示的行高").toBe(
      await tokenNumber(page, "--lyx-line-height-body"),
    );
    // 落点：控件的中线在内容区的中线上（差不过 2px），标签的上沿、错误提示的下沿都在内容区之内。
    // antd 的缺省是让控件贴着滚动区的上沿，标签被顶栏挡住；等滚动停稳再量
    const label = form.getByText("所在区域", { exact: true });
    await expect
      .poll(
        async () => {
          const area = await edgesOf(content);
          const control = await edgesOf(frame);
          const top = (await edgesOf(label)).top;
          const bottom = (await edgesOf(error)).bottom;
          return {
            centered: Math.abs(control.middle - area.middle) <= 2,
            labelVisible: top >= area.top,
            errorVisible: bottom <= area.bottom,
          };
        },
        { message: "出错的字段应当落在内容区中间，标签与错误提示都看得见" },
      )
      .toEqual({ centered: true, labelVisible: true, errorVisible: true });
    await shot(page, "14-form-error");

    // 填上之后再提交：校验通过
    await district.click();
    await page.getByTitle("成华区", { exact: true }).click();
    await form.getByRole("textbox", { name: "详细地址" }).fill("建设路 2 号");
    await form.getByRole("textbox", { name: "联系电话" }).fill("13800005018");
    await save.click();
    await expect(page.getByText("校验通过。样例页不提交。")).toBeVisible();
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
