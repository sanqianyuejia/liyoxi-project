import type { ReactNode } from "react";

import { Text, View } from "@tarojs/components";

import { Icon, type IconName } from "@/components/Icon";
import { cx } from "@/lib/cx";

import "./index.scss";

export interface PillButtonProps {
  /** 文字前的图标（16） */
  icon?: IconName;
  disabled?: boolean;
  className?: string;
  onClick?: () => void;
  children?: ReactNode;
}

/** 胶囊小按钮：高 32，用于复制、切换、查看详情这类次要动作（规范 第 4.3 节“按钮”）。点击区补足到 44 */
export function PillButton({
  icon,
  disabled = false,
  className,
  onClick,
  children,
}: PillButtonProps) {
  return (
    <View
      className={cx("lyx-pill-button", disabled && "lyx-pill-button--disabled", className)}
      hoverClass={disabled ? "none" : "lyx-pill-button--pressed"}
      ariaRole="button"
      onClick={disabled ? undefined : onClick}
    >
      {icon ? <Icon name={icon} size={16} /> : null}
      <Text>{children}</Text>
    </View>
  );
}
