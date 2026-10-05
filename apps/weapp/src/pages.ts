// 小程序页面清单：49 个路由一行一条（D7 第 4.1 节；计划 第 8.3 节的里程碑归属）。
// 三处从这里取：src/app.config.ts 的 pages、subPackages、preloadRule（只输出已建的页）；
// docs/plan/pages.md 的小程序部分（infra/ci/pages/sources/weapp.mjs）；截图命令的页面列表。
// 页面包合并时：建页面文件，把自己那一行的 implemented 改成 true（占位页同时去掉 placeholder）。
// 本文件不得 import 任何东西：页面清单脚本用 Node 直接读它，不经打包。

/** 主包，或 D7 第 4.1 节的九个分包之一 */
export type WeappPackage =
  | "main"
  | "sub/catalog"
  | "sub/order"
  | "sub/publish"
  | "sub/billing"
  | "sub/profile"
  | "sub/asset"
  | "sub/ad"
  | "sub/service"
  | "sub/member";

export interface WeappPage {
  /** 路由，不带前导斜杠：主包 pages/<页>/index，分包 <分包>/<页>/index */
  route: string;
  pkg: WeappPackage;
  title: string;
  /** 原型画板（design/prototype/merchant），没有画板的为 null */
  screen: string | null;
  /** PRD 的页面编号，新增页为 null */
  code: string | null;
  /** V1.1 表示 V1.0 不做、只登记 */
  milestone: "M1" | "M2" | "M3" | "M4" | "M5" | "M6" | "M7" | "V1.1";
  /** 已拆包的写编号，没拆的写工作包组（拆包 PR 改成编号） */
  workPackage: string;
  /** 页面包已交付。docs/plan/pages.md 按它数“应实现未实现” */
  implemented: boolean;
  /** M0 的占位页：页面文件在、进构建，但不算已实现 */
  placeholder?: boolean;
  /** 原生标签栏的四项之一 */
  tab?: boolean;
  /** 自绘导航（规范 第 14 节第 4 项：首页与登录页） */
  customNav?: boolean;
  note?: string;
}

const page = (
  route: string,
  pkg: WeappPackage,
  title: string,
  screen: string | null,
  code: string | null,
  milestone: WeappPage["milestone"],
  workPackage: string,
  extra: Partial<WeappPage> = {},
): WeappPage => ({
  route,
  pkg,
  title,
  screen,
  code,
  milestone,
  workPackage,
  implemented: false,
  ...extra,
});

const TAB = { placeholder: true, tab: true } as const;

export const WEAPP_PAGES: readonly WeappPage[] = [
  // 主包（6 页）
  page("pages/home/index", "main", "首页", "Main", "M02", "M1", "W1-18", {
    ...TAB,
    customNav: true,
  }),
  page("pages/mall/index", "main", "短剧商城", "Mall", "M04", "M1", "W1-18", TAB),
  page("pages/cart/index", "main", "选剧单", "Cart", "M08", "M1", "W1-18", TAB),
  page("pages/mine/index", "main", "我的", "Mine", "M32", "M1", "W1-05", TAB),
  page("pages/login/index", "main", "登录", "Login", "M01", "M1", "W1-05", { customNav: true }),
  page("pages/agreement/index", "main", "协议正文", null, null, "M1", "W1-05", {
    note: "新增页：登录前可读",
  }),
  // sub/catalog（3 页）
  page("sub/catalog/search/index", "sub/catalog", "搜索", "Search", "M03", "M3", "G3-B"),
  page("sub/catalog/trailer/index", "sub/catalog", "预告片模式", "Trailer", "M05", "V1.1", "—", {
    note: "V1.0 不做（规范 第 11 节）",
  }),
  page("sub/catalog/detail/index", "sub/catalog", "短剧详情", "Detail", "M06", "M1", "W1-18"),
  // sub/order（8 页）
  page("sub/order/checkout/index", "sub/order", "确认订购", "Checkout", "M09", "M1", "W1-18"),
  page("sub/order/result/index", "sub/order", "结果页", "PayResult", "M11", "M1", "W1-12", {
    note: "订购成功与付款成功共用，?type=order|payment",
  }),
  page("sub/order/orders/index", "sub/order", "订单列表", "Orders", "M20", "M1", "W1-18"),
  page(
    "sub/order/order-detail/index",
    "sub/order",
    "订单详情",
    "OrderDetail",
    "M21",
    "M1",
    "W1-18",
  ),
  page("sub/order/plan/index", "sub/order", "方案确认", "Plan", "M22", "M1", "W1-20"),
  page("sub/order/sample/index", "sub/order", "样片确认", "Sample", "M23", "M1", "W1-20"),
  page(
    "sub/order/launch-record/index",
    "sub/order",
    "上线记录",
    "LaunchRecord",
    "M24",
    "M1",
    "W1-20",
  ),
  page("sub/order/my-dramas/index", "sub/order", "我的短剧", "MyDramas", "M33", "M5", "G5-A"),
  // sub/publish（4 页）
  page("sub/publish/tasks/index", "sub/publish", "发布任务", "Publish", "M28", "M1", "W1-20"),
  page("sub/publish/downloads/index", "sub/publish", "逐集下载", null, null, "M1", "W1-20", {
    note: "新增页：逐集下载管理与“扫码在电脑上下载”入口",
  }),
  page("sub/publish/accounts/index", "sub/publish", "发布账号", "Accounts", "M26", "M1", "W1-18", {
    note: "含 M27 弹层",
  }),
  page("sub/publish/portal-approve/index", "sub/publish", "扫码确认", null, null, "M6", "G6-B", {
    note: "新增页：下载页扫码后的确认页",
  }),
  // sub/billing（6 页）
  page(
    "sub/billing/wallet/index",
    "sub/billing",
    "钱包",
    "Wallet、WalletExpired",
    "M43",
    "M1",
    "W1-12",
    {
      note: "一页两态",
    },
  ),
  page("sub/billing/plan-pick/index", "sub/billing", "套餐选择", "PlanPick", "M44", "M1", "W1-12", {
    note: "含 M10 对公转账弹层与付款结果",
  }),
  page("sub/billing/topup/index", "sub/billing", "积分充值", "TopUp", "M45", "M4", "G4-C"),
  page("sub/billing/ledger/index", "sub/billing", "积分流水", "Ledger", "M46", "M4", "G4-C"),
  page("sub/billing/invoices/index", "sub/billing", "发票", "Invoices", "M35", "M4", "G4-C"),
  page("sub/billing/contracts/index", "sub/billing", "合同", "Contracts", "M34", "M4", "G4-C"),
  // sub/profile（9 页）
  page("sub/profile/profile/index", "sub/profile", "建档首页", "Profile", "M12", "M1", "W1-09"),
  page("sub/profile/basic/index", "sub/profile", "基础信息", "ProfileBasic", "M13", "M1", "W1-09"),
  page("sub/profile/store/index", "sub/profile", "门店环境", "ProfileStore", "M14", "M1", "W1-09"),
  page(
    "sub/profile/service/index",
    "sub/profile",
    "主推服务",
    "ProfileService",
    "M15",
    "M1",
    "W1-09",
  ),
  page("sub/profile/cert/index", "sub/profile", "证照", "ProfileCert", "M16", "M1", "W1-09"),
  page(
    "sub/profile/review/index",
    "sub/profile",
    "审核进度",
    "ProfileReview",
    "M17",
    "M1",
    "W1-09",
  ),
  page("sub/profile/stores/index", "sub/profile", "门店管理", "Stores", "M48", "M2", "G2-B"),
  page("sub/profile/store-add/index", "sub/profile", "新增门店", "StoreAdd", "M49", "M2", "G2-B"),
  page(
    "sub/profile/staff-profile/index",
    "sub/profile",
    "店员档案",
    "StaffProfile",
    "M56",
    "M2",
    "G2-B",
    {
      note: "仅店员",
    },
  ),
  // sub/asset（4 页）
  page("sub/asset/lib/index", "sub/asset", "素材库", "AssetLib", "M50", "M3", "G3-C"),
  page("sub/asset/upload/index", "sub/asset", "上传素材", "AssetUpload", "M51", "M3", "G3-C"),
  page("sub/asset/detail/index", "sub/asset", "素材详情", "AssetDetail", "M52", "M3", "G3-C"),
  page("sub/asset/uploader/index", "sub/asset", "上传中心", null, null, "M3", "G3-C", {
    note: "新增页：大文件上传",
  }),
  // sub/ad（2 页）
  page("sub/ad/ads/index", "sub/ad", "广告", "Ads", "M18", "M5", "G5-B", { note: "含 M42 弹层" }),
  page("sub/ad/ad-detail/index", "sub/ad", "广告详情", "AdDetail", "M19", "M5", "G5-B"),
  // sub/service（4 页）
  page("sub/service/service/index", "sub/service", "客服中心", "Service", "M29", "M7", "G7-A", {
    note: "含 M30 弹层",
  }),
  page(
    "sub/service/ticket/index",
    "sub/service",
    "工单",
    "Ticket、TicketDone",
    "M31",
    "M7",
    "G7-A",
    {
      note: "一页两态",
    },
  ),
  page("sub/service/messages/index", "sub/service", "消息", "Messages", "M36", "M2", "G2-C"),
  page("sub/service/settings/index", "sub/service", "设置", null, null, "M2", "G2-B", {
    note: "新增页：退出登录、注销、隐私协议、通知设置、已授权的电脑",
  }),
  // sub/member（3 页）
  page("sub/member/members/index", "sub/member", "成员", "Members", "M53", "M2", "G2-B"),
  page("sub/member/invite/index", "sub/member", "邀请店员", "Invite", "M54", "M2", "G2-B"),
  page("sub/member/join/index", "sub/member", "加入门店", "Join", "M55", "M2", "G2-B", {
    note: "游客可进",
  }),
];

/** 分包预下载（D7 第 4.1 节）：进到键所指的页面后预取这些分包 */
export const WEAPP_PRELOAD: Readonly<Record<string, readonly WeappPackage[]>> = {
  "pages/home/index": ["sub/catalog", "sub/order"],
  "pages/mall/index": ["sub/catalog"],
  "pages/mine/index": ["sub/billing", "sub/profile"],
  "pages/cart/index": ["sub/order"],
};

/** 进构建的页：已实现的，加上 M0 的占位页 */
export const isBuilt = (item: WeappPage): boolean => item.implemented || item.placeholder === true;

/** 由页面清单拼出 app.config 的 pages、subPackages、preloadRule：只含已建的页，没有页的分包不出现 */
export function buildRoutes(pages: readonly WeappPage[] = WEAPP_PAGES): {
  pages: string[];
  subPackages: { root: string; pages: string[] }[];
  preloadRule: Record<string, { network: "all"; packages: string[] }>;
} {
  const built = pages.filter(isBuilt);
  const main = built.filter((item) => item.pkg === "main").map((item) => item.route);
  const roots = [...new Set(built.filter((item) => item.pkg !== "main").map((item) => item.pkg))];
  const subPackages = roots.map((root) => ({
    root,
    pages: built
      .filter((item) => item.pkg === root)
      .map((item) => item.route.slice(root.length + 1)),
  }));
  const preloadRule: Record<string, { network: "all"; packages: string[] }> = {};
  for (const [route, packages] of Object.entries(WEAPP_PRELOAD)) {
    const present = packages.filter((name) => roots.includes(name));
    if (main.includes(route) && present.length > 0) {
      preloadRule[route] = { network: "all", packages: present };
    }
  }
  return { pages: main, subPackages, preloadRule };
}
