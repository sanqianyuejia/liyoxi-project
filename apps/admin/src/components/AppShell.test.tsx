// 外壳的结构用例：菜单按权限与开关过滤后的样子、面包屑、用户区、隐藏的入口。点击与展开收起由冒烟覆盖。
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ADMIN_MODULES, breadcrumbOf, findPage, selectedMenuKey, visibleMenu } from "../lib/menu";
import type { AccessSnapshot } from "../lib/permissions";

import { AppShell } from "./AppShell";

const access = (releases: Record<string, boolean> = {}): AccessSnapshot => ({
  staff: { id: "s1", name: "周航", roleKey: "super_admin", roleName: "超级管理员" },
  isLead: true,
  moduleLevels: Object.fromEntries(ADMIN_MODULES.map((module) => [module.key, "e"])),
  actions: [],
  dataScope: "all",
  releases,
});

function render(
  pageKey: string,
  snapshot: AccessSnapshot,
  badges: Record<string, number> = {},
): string {
  const page = findPage(pageKey);
  if (!page) throw new Error(`登记表缺页 ${pageKey}`);
  return renderToStaticMarkup(
    <AppShell
      access={snapshot}
      menu={visibleMenu(snapshot)}
      selectedKey={selectedMenuKey(page)}
      crumbs={breadcrumbOf(page)}
      badges={badges}
      onNavigate={() => {}}
    >
      <p>内容</p>
    </AppShell>,
  );
}

describe("外壳", () => {
  it("品牌、12 个一级菜单（渠道是 V1.1，默认不出现）、用户区取姓氏", () => {
    const html = render("merchant.detail", access());
    expect(html).toContain("狸有戏");
    expect(html).toContain("运营管理后台");
    for (const module of ADMIN_MODULES.filter((entry) => entry.key !== "channel")) {
      expect(html, module.title).toContain(`>${module.title}</span>`);
    }
    expect(html).not.toContain(">渠道</span>");
    expect(html).not.toContain("V1.1");
    expect(html).toMatch(/lyx-user__avatar"[^>]*>周</);
    expect(html).toContain("超级管理员");
  });

  it("详情页：当前分组展开，父列表的菜单项选中；面包屑三级，末级不可点", () => {
    const html = render("merchant.detail", access());
    expect(html).toMatch(/ant-menu-item-selected[^>]*>.*?商家列表/s);
    expect(html).toContain("资质审核");
    // 别的分组没展开：订单下面的二级项不渲染
    expect(html).not.toContain("对公收款确认");
    expect(html).toMatch(/aria-current="page">商家详情</);
    expect(html).toMatch(/<button[^>]*lyx-crumbs__link[^>]*>商家列表</);
  });

  it("不显示全局搜索与通知入口（规范 第 14 节第 12 项）", () => {
    const html = render("workbench.main", access());
    expect(html).not.toContain('type="search"');
    expect(html).not.toMatch(/搜索|通知/);
  });

  it("开关打开后 V1.1 的菜单出现并带标记；角标按键显示，分组上显示合计", () => {
    const html = render("order.receipts", access({ "release.partner": true }), {
      "order.receipts": 3,
      "order.renewals": 19,
      "merchant.review": 4,
    });
    expect(html).toContain(">渠道</span>");
    expect(html).toContain('class="lyx-menu-v11">V1.1<');
    expect(html).toMatch(/对公收款确认<\/span><span class="lyx-menu-badge">3</);
    expect(html).toMatch(/订单<\/span><span class="lyx-menu-badge">22</);
    expect(html).toMatch(/商家<\/span><span class="lyx-menu-badge">4</);
  });
});
