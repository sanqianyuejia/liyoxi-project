import type { ReactNode } from "react";

import { View } from "@tarojs/components";

import { Badge } from "@/components/Badge";
import { Icon, type IconName } from "@/components/Icon";
import { cx } from "@/lib/cx";

import "./index.scss";

export interface ListProps {
  className?: string;
  children?: ReactNode;
}

/** 列表容器卡：白底卡片，内边距 4 16，里面放 ListRow（规范 第 4.3 节“卡片与列表”）。不用 NutUI 的 Cell */
export function List({ className, children }: ListProps) {
  return <View className={cx("lyx-list", className)}>{children}</View>;
}

export interface ListRowProps {
  /** 行首图标（22）。菜单行用 */
  icon?: IconName;
  /** 行首的头像或图标块（Avatar、IconTile）。给了它或 description 就是双行行，最小高 64 */
  media?: ReactNode;
  title: ReactNode;
  /** 副文，12px */
  description?: ReactNode;
  /** 右侧的值，13px；也可以放状态标签 */
  value?: ReactNode;
  /** 右侧的数字角标 */
  badge?: number;
  /** 右箭头。不给时：可点就有，不可点就没有 */
  arrow?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
}

/** 列表行：菜单行（最小高 52）与双行行（最小高 64）。行间分隔线自带，末行无线；可点的行按下不透明度 0.7 */
export function ListRow({
  icon,
  media,
  title,
  description,
  value,
  badge,
  arrow,
  disabled = false,
  onClick,
  className,
}: ListRowProps) {
  const clickable = onClick !== undefined && !disabled;
  const double = media !== undefined || description !== undefined;
  return (
    <View
      className={cx(
        "lyx-list-row",
        double && "lyx-list-row--double",
        disabled && "lyx-list-row--disabled",
        className,
      )}
      hoverClass={clickable ? "lyx-list-row--pressed" : "none"}
      onClick={clickable ? onClick : undefined}
    >
      {media !== undefined ? <View className="lyx-list-row__media">{media}</View> : null}
      {icon ? (
        <View className="lyx-list-row__icon">
          <Icon name={icon} />
        </View>
      ) : null}
      <View className="lyx-list-row__main">
        <View className="lyx-list-row__title">{title}</View>
        {description !== undefined ? (
          <View className="lyx-list-row__description">{description}</View>
        ) : null}
      </View>
      {value !== undefined ? <View className="lyx-list-row__value">{value}</View> : null}
      <Badge count={badge} />
      {(arrow ?? onClick !== undefined) ? (
        <View className="lyx-list-row__arrow">
          <Icon name="chevron-right" size={16} />
        </View>
      ) : null}
    </View>
  );
}
