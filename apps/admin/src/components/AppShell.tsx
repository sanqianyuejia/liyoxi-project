// 外壳：侧栏菜单、面包屑、用户区、全局提示（规范 第 5.1 节；D7 第 5.3 节）。
//   - 菜单项来自菜单登记表，已按模块等级与 release 开关过滤（lib/menu.ts 的 visibleMenu）。
//   - 同一时刻只展开当前所在的分组；详情页保持父列表的菜单项选中（selectedKey 由调用方按登记表算好）。
//   - 全局搜索与通知入口不显示（规范 第 14 节第 12 项）；用户菜单在 W1-02，这里只显示姓名与角色。
// 本构件不认识路由与请求：数据都从属性进来，点菜单时回调 onNavigate。
import { Menu, type MenuProps } from "antd";
import { useState, type ReactNode } from "react";

import type { Crumb, MenuGroupView, MenuItemView } from "../lib/menu";
import type { AccessSnapshot } from "../lib/permissions";

import { Icon } from "./Icon";

export interface AppShellProps {
  access: AccessSnapshot;
  menu: readonly MenuGroupView[];
  /** 当前选中的菜单项（页面的 key，或它父页面的 key） */
  selectedKey: string | null;
  crumbs: readonly Crumb[];
  /** 菜单角标：NavBadgeKey → 数量；0 与没有的不显示 */
  badges?: Readonly<Record<string, number>>;
  /** 全局提示：内容区上方的一条（如“后台已更新，请刷新”） */
  notice?: ReactNode;
  onNavigate: (path: string) => void;
  children: ReactNode;
}

const groupKey = (moduleKey: string): string => `module:${moduleKey}`;

function MenuLabel({ title, badge, isV11 }: { title: string; badge?: number; isV11?: boolean }) {
  return (
    <span className="lyx-menu-label">
      <span className="lyx-menu-label__text">{title}</span>
      {isV11 ? <span className="lyx-menu-v11">V1.1</span> : null}
      {badge ? <span className="lyx-menu-badge">{badge > 99 ? "99+" : badge}</span> : null}
    </span>
  );
}

/** 当前选中项所在的分组；一级菜单直接是链接的模块没有分组 */
function openGroupOf(menu: readonly MenuGroupView[], selectedKey: string | null): string[] {
  const group = menu.find(
    (entry) => entry.items.length > 1 && entry.items.some((item) => item.key === selectedKey),
  );
  return group ? [groupKey(group.module.key)] : [];
}

export function AppShell({
  access,
  menu,
  selectedKey,
  crumbs,
  badges = {},
  notice,
  onNavigate,
  children,
}: AppShellProps) {
  const [openKeys, setOpenKeys] = useState<string[]>(() => openGroupOf(menu, selectedKey));
  // 走到别的分组里的页面时，展开那个分组、收起原来的（渲染时按上一次的选中项比对，不用副作用）
  const [trackedKey, setTrackedKey] = useState(selectedKey);
  if (trackedKey !== selectedKey) {
    setTrackedKey(selectedKey);
    setOpenKeys(openGroupOf(menu, selectedKey));
  }

  const badgeOf = (item: MenuItemView): number =>
    item.badgeKey ? (badges[item.badgeKey] ?? 0) : 0;
  const pathByKey = new Map(
    menu.flatMap((group) => group.items).map((item) => [item.key, item.path]),
  );

  const items: MenuProps["items"] = menu.map((group) => {
    const icon = <Icon name={group.module.icon} />;
    const [only] = group.items;
    if (group.items.length === 1 && only) {
      return {
        key: only.key,
        icon,
        label: <MenuLabel title={group.module.title} badge={badgeOf(only)} isV11={only.isV11} />,
      };
    }
    const total = group.items.reduce((sum, item) => sum + badgeOf(item), 0);
    return {
      key: groupKey(group.module.key),
      icon,
      label: (
        <MenuLabel
          title={group.module.title}
          badge={total}
          isV11={group.items.every((item) => item.isV11)}
        />
      ),
      children: group.items.map((item) => ({
        key: item.key,
        label: <MenuLabel title={item.title} badge={badgeOf(item)} isV11={item.isV11} />,
      })),
    };
  });

  const lastCrumb = crumbs.length - 1;

  return (
    <div className="lyx-shell">
      <aside className="lyx-shell__sider">
        <div className="lyx-shell__brand">
          <span className="lyx-shell__brand-name">狸有戏</span>
          <span className="lyx-shell__brand-sub">运营管理后台</span>
        </div>
        <nav className="lyx-shell__nav" aria-label="主菜单">
          <Menu
            theme="dark"
            mode="inline"
            inlineIndent={12}
            items={items}
            selectedKeys={selectedKey ? [selectedKey] : []}
            openKeys={openKeys}
            // 只留最后展开的那一个分组
            onOpenChange={(keys) => setOpenKeys(keys.slice(-1))}
            onClick={({ key }) => {
              const path = pathByKey.get(key);
              if (path) onNavigate(path);
            }}
          />
        </nav>
      </aside>
      <div className="lyx-shell__main">
        <header className="lyx-shell__header">
          <nav aria-label="面包屑">
            <ol className="lyx-crumbs">
              {crumbs.map((crumb, index) => (
                <li key={`${index}-${crumb.title}`} className="lyx-crumbs">
                  {index > 0 ? <span aria-hidden="true">/</span> : null}
                  {index === lastCrumb ? (
                    <span className="lyx-crumbs__current" aria-current="page">
                      {crumb.title}
                    </span>
                  ) : crumb.path ? (
                    <button
                      type="button"
                      className="lyx-crumbs__link lyx-focusable"
                      onClick={() => crumb.path && onNavigate(crumb.path)}
                    >
                      {crumb.title}
                    </button>
                  ) : (
                    <span>{crumb.title}</span>
                  )}
                </li>
              ))}
            </ol>
          </nav>
          <div className="lyx-user" data-testid="shell-user">
            <span className="lyx-user__avatar" aria-hidden="true">
              {access.staff.name.slice(0, 1)}
            </span>
            <span>
              <div className="lyx-user__name">{access.staff.name}</div>
              <div className="lyx-user__role">{access.staff.roleName}</div>
            </span>
          </div>
        </header>
        {notice ? <div className="lyx-shell__notice">{notice}</div> : null}
        <main className="lyx-shell__content" data-testid="shell-content">
          {children}
        </main>
      </div>
    </div>
  );
}
