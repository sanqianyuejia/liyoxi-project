import type { ReactNode } from "react";

import { View } from "@tarojs/components";

import { cx } from "@/lib/cx";

import "./index.scss";

export interface ChipProps {
  selected?: boolean;
  /** 不可选 */
  disabled?: boolean;
  /** md 高 34、13px（缺省）；lg 高 40、14px（弹层里的大号） */
  size?: "md" | "lg";
  onClick?: () => void;
  className?: string;
  children?: ReactNode;
}

/**
 * 选项胶囊：表单里取值用，选中是橙色（规范 第 4.3 节“表单”）。
 * 列表上方筛选、切换视图用 FilterChips（选中是深色），两者不要混用。
 */
export function Chip({
  selected = false,
  disabled = false,
  size = "md",
  onClick,
  className,
  children,
}: ChipProps) {
  return (
    <View
      className={cx(
        "lyx-chip",
        `lyx-chip--${size}`,
        selected && "lyx-chip--selected",
        disabled && "lyx-chip--disabled",
        className,
      )}
      hoverClass={disabled ? "none" : "lyx-chip--pressed"}
      ariaRole="button"
      onClick={disabled ? undefined : onClick}
    >
      {children}
    </View>
  );
}
