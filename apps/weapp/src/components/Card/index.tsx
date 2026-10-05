import type { ReactNode } from "react";

import { View } from "@tarojs/components";

import { cx } from "@/lib/cx";

import "./index.scss";

/**
 * default 标准卡片；item 列表项卡（内边距 14 16）；list 列表容器卡（内边距 4 16，行自带高度与分隔线）；
 * dark 深色卡（圆角 16）；subtle 卡内浅底块（圆角 10）
 */
export type CardVariant = "default" | "item" | "list" | "dark" | "subtle";

export interface CardProps {
  variant?: CardVariant;
  /** 卡片标题，16px / 600 */
  title?: ReactNode;
  /** 标题右侧：文字链（TextButton arrow）或 12px 的说明 */
  extra?: ReactNode;
  /** 眉标：深色卡标题上方的一行小字 */
  eyebrow?: ReactNode;
  /** 给了就是整张可点的卡，按下不透明度 0.7 */
  onClick?: () => void;
  className?: string;
  children?: ReactNode;
}

/** 卡片（规范 第 4.3 节“卡片与列表”）：白底、圆角 14、无描边无阴影，靠白底与页面底色区分 */
export function Card({
  variant = "default",
  title,
  extra,
  eyebrow,
  onClick,
  className,
  children,
}: CardProps) {
  const hasHeader = title !== undefined || extra !== undefined;
  return (
    <View
      className={cx("lyx-card", `lyx-card--${variant}`, className)}
      hoverClass={onClick ? "lyx-card--pressed" : "none"}
      onClick={onClick}
    >
      {eyebrow !== undefined ? <View className="lyx-card__eyebrow">{eyebrow}</View> : null}
      {hasHeader ? (
        <View className="lyx-card__header">
          <View className="lyx-card__title">{title}</View>
          {extra !== undefined ? <View className="lyx-card__extra">{extra}</View> : null}
        </View>
      ) : null}
      {children}
    </View>
  );
}
