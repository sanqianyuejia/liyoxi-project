// 菜单登记表的用例（任务书 第 7 节第 5 条）。画板清单拿 docs/api/working/routemap.json 的 screens 对账，
// 不是照登记表自己数一遍。
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { ICON_NAMES } from "@liyoxi/shared/design/icons";
import { describe, expect, it } from "vitest";

import {
  ADMIN_MODULES,
  ALL_PAGES,
  BASE_PAGES,
  breadcrumbOf,
  canEnterPage,
  findPage,
  matchPage,
  selectedMenuKey,
  visibleMenu,
} from "./menu";
import type { AccessSnapshot } from "./permissions";

const repoFile = (path: string): string =>
  fileURLToPath(new URL(`../../../../${path}`, import.meta.url));

interface RoutemapEntry {
  screens: string[];
  version: string;
}
const routemap = JSON.parse(
  readFileSync(repoFile("docs/api/working/routemap.json"), "utf8"),
) as RoutemapEntry[];

/** screens 里 A: 开头的画板 → 用到它的接口的版本集合 */
const boardVersions = new Map<string, Set<string>>();
for (const entry of routemap) {
  for (const screen of entry.screens) {
    if (!screen.startsWith("A:")) continue;
    const name = screen.slice(2);
    boardVersions.set(name, (boardVersions.get(name) ?? new Set()).add(entry.version));
  }
}

const boards = ALL_PAGES.filter((page) => page.kind === "board");
const noBoards = ALL_PAGES.filter((page) => page.kind === "no-board");
const basics = ALL_PAGES.filter((page) => page.kind === "basic");

const superAdmin = (releases: Record<string, boolean> = {}): AccessSnapshot => ({
  staff: { id: "s1", name: "周航", roleKey: "super_admin", roleName: "超级管理员" },
  isLead: true,
  moduleLevels: Object.fromEntries(ADMIN_MODULES.map((module) => [module.key, "e"])),
  actions: [],
  dataScope: "all",
  releases,
});

describe("画板登记", () => {
  it("56 个画板全部登记，与 routemap 的 screens 一一对应", () => {
    expect(boards).toHaveLength(56);
    expect(boards.map((page) => page.screen).sort()).toEqual([...boardVersions.keys()].sort());
  });

  it("V1.0 43 个、V1.1 13 个；V1.1 的带 release 键，V1.0 的不带", () => {
    const v11 = boards.filter((page) => page.milestone === "V1.1");
    const v10 = boards.filter((page) => page.milestone !== "V1.1");
    expect(v10).toHaveLength(43);
    expect(v11).toHaveLength(13);
    for (const page of v11) expect(page.release, page.key).toMatch(/^release\.[a-z0-9_]+$/);
    for (const page of v10) expect(page.release, page.key).toBeNull();
  });

  it("V1.1 的画板与 routemap 对得上：只被 V1.1 接口引用的画板，加 D7 第 5.2 节标了 V1.1 的五张报表与渠道页", () => {
    const onlyV11 = [...boardVersions]
      .filter(([, versions]) => !versions.has("V1.0"))
      .map(([name]) => name);
    const registered = boards
      .filter((page) => page.milestone === "V1.1")
      .map((page) => page.screen);
    for (const name of onlyV11) expect(registered).toContain(name);
    // routemap 里这七个画板另被一条 V1.0 的共用接口（导出、看板聚合）引用，版本以 D7 第 5.2 节的“版本”列为准
    expect(registered.filter((name) => !onlyV11.includes(name)).sort()).toEqual([
      "PartnerSettle",
      "Partners",
      "RptAds",
      "RptDelivery",
      "RptDramas",
      "RptPartners",
      "RptService",
    ]);
  });

  it("各里程碑的画板数照计划 第 8.3 节：M1 10、M2 7、M3 5、M4 10、M5 1、M6 4、M7 6", () => {
    const count = (milestone: string) =>
      boards.filter((page) => page.milestone === milestone).length;
    expect(["M1", "M2", "M3", "M4", "M5", "M6", "M7"].map(count)).toEqual([10, 7, 5, 10, 1, 4, 6]);
    const m1 = boards.filter((page) => page.milestone === "M1").map((page) => page.screen);
    expect(m1.sort()).toEqual(
      [
        "SysStaff",
        "Review",
        "Receipts",
        "Orders",
        "OrderDetail",
        "Tickets",
        "TicketDetail",
        "Accounts",
        "Delivery",
        "Verify",
      ].sort(),
    );
  });
});

describe("每一项的字段", () => {
  it("键唯一；都有模块（基础页与外壳部件除外）、里程碑、工作包、已实现", () => {
    expect(new Set(ALL_PAGES.map((page) => page.key)).size).toBe(ALL_PAGES.length);
    for (const page of ALL_PAGES) {
      expect(page.milestone, page.key).toMatch(/^(M[1-7]|V1\.1)$/);
      expect(page.workPackage, page.key).toMatch(/^(W\d-\d+[a-z]?|G\d-[0A-E]|—)$/);
      expect(typeof page.implemented, page.key).toBe("boolean");
      if (page.kind === "board") expect(page.module, page.key).not.toBeNull();
    }
    for (const module of ADMIN_MODULES) {
      for (const page of module.pages) expect(page.module, page.key).toBe(module.key);
    }
  });

  it("本包合并时没有一页标为已实现；V1.1 的不排工作包", () => {
    expect(ALL_PAGES.filter((page) => page.implemented)).toEqual([]);
    for (const page of ALL_PAGES) {
      expect(page.workPackage === "—", page.key).toBe(page.milestone === "V1.1");
    }
  });

  it("地址不重复；有画板的页面都有地址；父页面存在", () => {
    const paths = ALL_PAGES.map((page) => page.path).filter((path) => path !== null);
    expect(new Set(paths).size).toBe(paths.length);
    for (const page of boards) expect(page.path, page.key).toMatch(/^\/[a-z0-9$/-]*$/i);
    for (const page of ALL_PAGES) {
      if (page.parent) expect(findPage(page.parent), page.key).toBeDefined();
      if (!page.inMenu && page.kind === "board") expect(page.parent, page.key).toBeDefined();
    }
  });

  it("13 个一级模块，顺序照规范 第 5.1 节；图标都在 W0-26 的图标集里", () => {
    expect(ADMIN_MODULES.map((module) => module.title)).toEqual([
      "工作台",
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
      "渠道",
    ]);
    for (const module of ADMIN_MODULES) expect(ICON_NAMES).toContain(module.icon);
  });

  it("一个模块一个登记文件，没有漏汇总的", () => {
    const files = readdirSync(fileURLToPath(new URL("./menu/", import.meta.url)))
      .filter((name) => name.endsWith(".ts") && !name.startsWith("_"))
      .map((name) => name.replace(/\.ts$/, ""));
    expect(files.sort()).toEqual(ADMIN_MODULES.map((module) => module.key).sort());
  });
});

describe("无画板页与基础页", () => {
  it("无画板业务页 16 个，名字照计划 第 8.3 节，且都在 routemap 的 screens 里", () => {
    expect(noBoards.map((page) => page.screen).sort()).toEqual(
      [
        "开关管理",
        "清单模板管理",
        "我的待审批",
        "渠道码登记",
        "流程运维",
        "文件清除放行",
        "线下开单",
        "线下退款登记",
        "红字发票",
        "受控财务配置",
        "发送日志与重发",
        "通道配置",
        "系统健康",
        "导出记录抽屉",
        "通知面板",
        "全局搜索",
      ].sort(),
    );
    const screens = new Set(routemap.flatMap((entry) => entry.screens));
    for (const page of noBoards) expect(screens.has(`无画板：${page.screen}`), page.key).toBe(true);
  });

  it("基础页 7 个，都在 W1-02；用户菜单属外壳，另登记", () => {
    expect(basics.map((page) => page.title)).toEqual([
      "登录",
      "动态口令验证",
      "首次改密",
      "绑定动态口令",
      "再验证弹层",
      "没有访问权限",
      "页面不存在",
    ]);
    for (const page of basics) expect([page.milestone, page.workPackage]).toEqual(["M1", "W1-02"]);
    expect(BASE_PAGES.filter((page) => page.kind === "shell").map((page) => page.title)).toEqual([
      "用户菜单",
    ]);
  });

  it("通知面板、全局搜索标“入口隐藏”，只有这两项", () => {
    expect(ALL_PAGES.filter((page) => page.entryHidden).map((page) => page.title)).toEqual([
      "通知面板",
      "全局搜索",
    ]);
  });
});

describe("菜单、守卫与面包屑", () => {
  it("V1.1 的菜单默认不显示：渠道整个模块不出现，其余模块里不出现 V1.1 的项", () => {
    const menu = visibleMenu(superAdmin());
    expect(menu.map((group) => group.module.key)).not.toContain("channel");
    expect(menu).toHaveLength(12);
    expect(menu.flatMap((group) => group.items).filter((item) => item.isV11)).toEqual([]);
  });

  it("打开 release 开关后对应的 V1.1 菜单出现", () => {
    const menu = visibleMenu(superAdmin({ "release.partner": true }));
    const channel = menu.find((group) => group.module.key === "channel");
    expect(channel?.items.map((item) => item.title)).toEqual([
      "服务商列表",
      "入驻审核",
      "等级与返佣",
      "商家归属",
      "结算单",
    ]);
    const finance = menu.find((group) => group.module.key === "finance");
    expect(finance?.items.map((item) => item.title)).toContain("服务商结算");
  });

  it("菜单按模块等级过滤：等级为 n 的模块不出现，没登录时菜单为空", () => {
    const service: AccessSnapshot = {
      ...superAdmin(),
      moduleLevels: { workbench: "v", merchant: "e", service: "e", finance: "n" },
    };
    expect(visibleMenu(service).map((group) => group.module.key)).toEqual([
      "workbench",
      "merchant",
      "service",
    ]);
    expect(visibleMenu(null)).toEqual([]);
  });

  it("默认显示的菜单项就是 V1.0 里进菜单的画板页，无画板页实现前不进菜单", () => {
    const shown = visibleMenu(superAdmin()).flatMap((group) => group.items.map((item) => item.key));
    const expected = boards
      .filter((page) => page.milestone !== "V1.1" && page.inMenu)
      .map((page) => page.key);
    expect(shown.sort()).toEqual(expected.sort());
    expect(shown).toHaveLength(38);
    expect(noBoards.filter((page) => page.inMenu)).toEqual([]);
  });

  it("守卫：模块等级不够或开关没开都进不去；基础页不受模块等级限制", () => {
    const viewer: AccessSnapshot = { ...superAdmin(), moduleLevels: { finance: "v" } };
    const refunds = findPage("finance.refunds");
    const staff = findPage("system.staff");
    const settle = findPage("finance.settle");
    const forbidden = findPage("base.forbidden");
    if (!refunds || !staff || !settle || !forbidden) throw new Error("登记表缺页");
    expect(canEnterPage(viewer, refunds)).toBe(true);
    expect(canEnterPage(viewer, staff)).toBe(false);
    expect(canEnterPage(viewer, settle)).toBe(false);
    expect(canEnterPage({ ...viewer, releases: { "release.partner": true } }, settle)).toBe(true);
    expect(canEnterPage(null, forbidden)).toBe(true);
  });

  it("地址匹配：静态段优先于参数段；匹配不到返回 null", () => {
    expect(matchPage("/merchants/review")?.page.key).toBe("merchant.review");
    const detail = matchPage("/merchants/0192f0c1");
    expect(detail?.page.key).toBe("merchant.detail");
    expect(detail?.params).toEqual({ storeId: "0192f0c1" });
    expect(matchPage("/")?.page.key).toBe("workbench.main");
    expect(matchPage("/no/such/page")).toBeNull();
  });

  it("详情页保持父列表的菜单项选中", () => {
    const detail = findPage("merchant.detail");
    const review = findPage("merchant.review");
    if (!detail || !review) throw new Error("登记表缺页");
    expect(selectedMenuKey(detail)).toBe("merchant.list");
    expect(selectedMenuKey(review)).toBe("merchant.review");
  });

  it("面包屑最多三级，模块名与页面名相同时只出一级", () => {
    const titles = (key: string) => {
      const page = findPage(key);
      if (!page) throw new Error(`登记表缺页 ${key}`);
      return breadcrumbOf(page).map((crumb) => crumb.title);
    };
    expect(titles("workbench.main")).toEqual(["工作台"]);
    expect(titles("merchant.review")).toEqual(["商家", "资质审核"]);
    expect(titles("merchant.detail")).toEqual(["商家", "商家列表", "商家详情"]);
    for (const page of ALL_PAGES)
      expect(breadcrumbOf(page).length, page.key).toBeLessThanOrEqual(3);
  });
});
