// 菜单登记表的类型。登记数据在 src/lib/menu/ 下一个模块一个文件，汇总与查询函数在 src/lib/menu.ts。
// 登记文件只许 import type（页面清单脚本 infra/ci/pages/generate.mjs 用 Node 直接读它们，不经打包）。
import type { IconName } from "@liyoxi/shared/design/icons";

/** 13 个一级模块，与权限矩阵的模块一一对应（D7 第 5.2、5.4 节） */
export type AdminModuleKey =
  | "workbench"
  | "drama"
  | "billing"
  | "merchant"
  | "order"
  | "delivery"
  | "publish"
  | "service"
  | "finance"
  | "report"
  | "ops"
  | "system"
  | "channel";

/** 模块等级：n 无 / v 查看 / o 本人任务 / e 编辑（D7 第 5.4 节） */
export type ModuleLevel = "n" | "v" | "o" | "e";

/** 归属里程碑；V1.1 的页面只登记，不排里程碑 */
export type PageMilestone = "M1" | "M2" | "M3" | "M4" | "M5" | "M6" | "M7" | "V1.1";

/**
 * 页面种类：
 *   board    有画板的页面（routemap 的 screens 里 A: 开头的 56 个）
 *   no-board 无画板业务页（计划 第 8.3 节列的 16 个）
 *   basic    基础页（登录两步、首次改密、绑定动态口令、再验证弹层、403、404；W1-02）
 *   shell    属于外壳的部件（用户菜单）
 */
export type PageKind = "board" | "no-board" | "basic" | "shell";

/** 页面骨架（D7 第 5.2、5.3 节）。本包只交前三种；其余在 G2-0、M6、M7 */
export type PageSkeleton =
  | "query-table"
  | "queue-workbench"
  | "detail"
  | "master-detail"
  | "config"
  | "report"
  | "dashboard"
  | "calendar"
  | "form"
  | "overlay"
  | "plain";

/** 菜单角标的键，取值照 a02 第 5 节的 NavBadgeKey */
export type NavBadgeKey =
  | "merchant.review"
  | "order.receipts"
  | "order.renewals"
  | "delivery.tickets"
  | "delivery.ad_tasks"
  | "publish.deliveries"
  | "publish.verify"
  | "publish.accounts"
  | "publish.offline"
  | "publish.patrol"
  | "service.tickets"
  | "finance.refunds"
  | "finance.credit_adjust"
  | "finance.invoices"
  | "finance.reconcile"
  | "approval.mine"
  | "system.flow_ops";

export interface AdminPage {
  /** 路由键：<模块>.<页面>，a02 的 AdminRouteKey 里有的照它写 */
  key: string;
  title: string;
  /** 路由地址，$ 开头的段是参数；没有独立地址的（弹层、抽屉、面板）为 null */
  path: string | null;
  /** 所属模块；基础页与外壳部件不属于任何模块 */
  module: AdminModuleKey | null;
  /** V1.1 页面的开关键（release.*）；V1.0 的页面为 null。有开关键的默认不显示 */
  release: string | null;
  badgeKey?: NavBadgeKey;
  milestone: PageMilestone;
  /** 工作包编号；未拆包的写工作包组（如 G2-A），拆包 PR 改成编号；V1.1 写 — */
  workPackage: string;
  /** 页面包合并时改成 true */
  implemented: boolean;
  /** 画板名（screens 里去掉 A:）；无画板页是 screens 里“无画板：”后面的名字 */
  screen: string;
  kind: PageKind;
  skeleton: PageSkeleton;
  /** 是否出现在侧栏菜单 */
  inMenu: boolean;
  /** 不在菜单里的页面：保持哪个菜单项选中，面包屑挂在它后面（父页面的 key） */
  parent?: string;
  /** 入口隐藏：页面与接口照做，外壳不给入口（规范 第 14 节第 12 项）。不算留桩 */
  entryHidden?: boolean;
  /** 进入所需的模块等级，缺省 v */
  minLevel?: Exclude<ModuleLevel, "n">;
  /** 登记时拿不准的地方，页面包接手时核对 */
  note?: string;
}

export interface AdminModule {
  key: AdminModuleKey;
  title: string;
  icon: IconName;
  /** 侧栏里的先后 */
  order: number;
  pages: readonly AdminPage[];
}

/** 不属于任何模块的页面：基础页、外壳部件 */
export interface AdminBasePages {
  pages: readonly AdminPage[];
}
