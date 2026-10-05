import type { ReactNode } from "react";

import { View } from "@tarojs/components";

import { cx } from "@/lib/cx";

import "./index.scss";

export interface DescItem {
  label: string;
  value: ReactNode;
}

export interface DescListProps {
  items: readonly DescItem[];
  /** 键的宽度：md 64（缺省），键较长时用 lg 96 */
  labelWidth?: "md" | "lg";
  className?: string;
}

/** 键值网格：两列，键 13px 辅助色，值 13px，行距 8（规范 第 4.3 节“卡片与列表”） */
export function DescList({ items, labelWidth = "md", className }: DescListProps) {
  return (
    <View className={cx("lyx-desc-list", `lyx-desc-list--${labelWidth}`, className)}>
      {items.map((item) => (
        <View key={item.label} className="lyx-desc-list__row">
          <View className="lyx-desc-list__label">{item.label}</View>
          <View className="lyx-desc-list__value">{item.value}</View>
        </View>
      ))}
    </View>
  );
}
