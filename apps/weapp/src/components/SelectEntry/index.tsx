import type { ReactNode } from "react";

import { View } from "@tarojs/components";

import { Icon } from "@/components/Icon";
import { cx } from "@/lib/cx";

import "./index.scss";

export interface SelectEntryProps {
  /** 已选的值；没有时显示占位文案 */
  value?: ReactNode;
  placeholder?: string;
  error?: boolean;
  disabled?: boolean;
  /** 点了由页面弹出选择器（底部弹层、地图选点等） */
  onClick?: () => void;
  className?: string;
}

/** 选择器入口：外形同单行输入，右侧 18 的箭头（规范 第 4.3 节“表单”）。弹出什么由页面接 */
export function SelectEntry({
  value,
  placeholder,
  error = false,
  disabled = false,
  onClick,
  className,
}: SelectEntryProps) {
  const empty = value === undefined || value === null || value === "";
  return (
    <View
      className={cx(
        "lyx-select-entry",
        error && "lyx-select-entry--error",
        disabled && "lyx-select-entry--disabled",
        className,
      )}
      hoverClass={disabled ? "none" : "lyx-select-entry--pressed"}
      ariaRole="button"
      onClick={disabled ? undefined : onClick}
    >
      <View
        className={cx("lyx-select-entry__value", empty && "lyx-select-entry__value--placeholder")}
      >
        {empty ? placeholder : value}
      </View>
      <View className="lyx-select-entry__arrow">
        <Icon name="chevron-down" size={18} />
      </View>
    </View>
  );
}
