// 菜单登记表：菜单、面包屑、路由守卫、角标的唯一来源（D7 第 5.2 节）。
// 登记数据一个模块一个文件（src/lib/menu/），页面包只改自己模块的那一份；这里做汇总与查询。
// docs/plan/pages.md 的后台部分由 infra/ci/pages/generate.mjs 从同一批登记文件生成。
import base from "./menu/_base";
import billing from "./menu/billing";
import channel from "./menu/channel";
import delivery from "./menu/delivery";
import drama from "./menu/drama";
import finance from "./menu/finance";
import merchant from "./menu/merchant";
import ops from "./menu/ops";
import order from "./menu/order";
import publish from "./menu/publish";
import report from "./menu/report";
import service from "./menu/service";
import system from "./menu/system";
import workbench from "./menu/workbench";
import type { AdminModule, AdminModuleKey, AdminPage } from "./menu-types";
import { hasModuleLevel, isReleased, type AccessSnapshot } from "./permissions";

export type {
  AdminModule,
  AdminModuleKey,
  AdminPage,
  ModuleLevel,
  NavBadgeKey,
} from "./menu-types";

/** 13 个一级模块，按侧栏顺序 */
export const ADMIN_MODULES: readonly AdminModule[] = [
  workbench,
  drama,
  billing,
  merchant,
  order,
  delivery,
  publish,
  service,
  finance,
  report,
  ops,
  system,
  channel,
].sort((a, b) => a.order - b.order);

/** 不属于任何模块的页面：基础页、外壳部件 */
export const BASE_PAGES: readonly AdminPage[] = base.pages;

/** 全部登记的页面 */
export const ALL_PAGES: readonly AdminPage[] = [
  ...ADMIN_MODULES.flatMap((module) => module.pages),
  ...BASE_PAGES,
];

const PAGE_BY_KEY = new Map(ALL_PAGES.map((page) => [page.key, page]));
const MODULE_BY_KEY = new Map(ADMIN_MODULES.map((module) => [module.key, module]));

export function findPage(key: string): AdminPage | undefined {
  return PAGE_BY_KEY.get(key);
}

export function findModule(key: AdminModuleKey): AdminModule {
  const found = MODULE_BY_KEY.get(key);
  if (!found) throw new Error(`菜单登记表里没有模块 ${key}`);
  return found;
}

const segmentsOf = (path: string): string[] => path.split("/").filter(Boolean);

/** 地址匹配到哪一页：静态段优先于参数段（/merchants/review 不会落到 /merchants/$storeId） */
export function matchPage(
  pathname: string,
): { page: AdminPage; params: Record<string, string> } | null {
  const target = segmentsOf(pathname);
  let best: { page: AdminPage; params: Record<string, string>; statics: number } | null = null;
  for (const page of ALL_PAGES) {
    if (page.path === null) continue;
    const pattern = segmentsOf(page.path);
    if (pattern.length !== target.length) continue;
    const params: Record<string, string> = {};
    let statics = 0;
    let matched = true;
    for (const [index, part] of pattern.entries()) {
      const actual = target[index] ?? "";
      if (part.startsWith("$")) params[part.slice(1)] = decodeURIComponent(actual);
      else if (part === actual) statics += 1;
      else {
        matched = false;
        break;
      }
    }
    if (matched && (best === null || statics > best.statics)) best = { page, params, statics };
  }
  return best ? { page: best.page, params: best.params } : null;
}

/** 这一页当前能不能进：模块等级够，且开关已打开。不属于任何模块的页面不受模块等级限制 */
export function canEnterPage(access: AccessSnapshot | null, page: AdminPage): boolean {
  if (!isReleased(access, page.release)) return false;
  if (page.module === null) return true;
  return hasModuleLevel(access, page.module, page.minLevel ?? "v");
}

export interface MenuItemView {
  key: string;
  title: string;
  path: string;
  badgeKey?: AdminPage["badgeKey"];
  /** V1.1 的页面：开关打开后显示，标题后带“V1.1”小标记 */
  isV11: boolean;
}

export interface MenuGroupView {
  module: AdminModule;
  /** 只有一项时一级菜单直接是链接，不展开 */
  items: MenuItemView[];
}

/**
 * 侧栏菜单：按模块等级与 release 开关过滤（D7 第 5.4 节）。
 * V1.1 的 13 个画板只登记、默认不显示；开关打开才出现。没有可见项的模块整个不出现。
 */
export function visibleMenu(access: AccessSnapshot | null): MenuGroupView[] {
  const groups: MenuGroupView[] = [];
  for (const module of ADMIN_MODULES) {
    const items = module.pages
      .filter((page) => page.inMenu && page.path !== null && canEnterPage(access, page))
      .map((page) => ({
        key: page.key,
        title: page.title,
        path: page.path as string,
        badgeKey: page.badgeKey,
        isV11: page.release !== null,
      }));
    if (items.length > 0) groups.push({ module, items });
  }
  return groups;
}

/** 这一页对应的菜单项：不在菜单里的页面（详情页等）保持父页面的菜单项选中（规范 第 5.1 节） */
export function selectedMenuKey(page: AdminPage): string | null {
  let current: AdminPage | undefined = page;
  for (let depth = 0; current && depth < 4; depth += 1) {
    if (current.inMenu) return current.key;
    current = current.parent ? findPage(current.parent) : undefined;
  }
  return null;
}

export interface Crumb {
  title: string;
  /** 可点的上级；末级与模块名不带 */
  path?: string;
}

/** 面包屑，最多三级：模块 / 父页面 / 本页（规范 第 5.1 节）。模块名与页面名相同的（工作台）只出一级 */
export function breadcrumbOf(page: AdminPage): Crumb[] {
  const crumbs: Crumb[] = [];
  if (page.module !== null) crumbs.push({ title: findModule(page.module).title });
  const parent = page.parent ? findPage(page.parent) : undefined;
  if (parent && parent.title !== crumbs.at(-1)?.title) {
    crumbs.push({ title: parent.title, path: parent.path ?? undefined });
  }
  if (page.title !== crumbs.at(-1)?.title) crumbs.push({ title: page.title });
  return crumbs.slice(-3);
}
