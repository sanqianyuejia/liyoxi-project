import type { ReactNode } from "react";

import { View } from "@tarojs/components";

import { cx } from "@/lib/cx";

import "./index.scss";

export interface SectionProps {
  /** 卡片外的分组标题，17px / 600 */
  title: ReactNode;
  /** 标题右侧：文字链或 12px 的说明（如计数） */
  extra?: ReactNode;
  className?: string;
  children?: ReactNode;
}

/** 分组：卡片外的分组标题加一组内容，内容之间间距 12（规范 第 2.2 节 title；第 4.3 节“卡片与列表”） */
export function Section({ title, extra, className, children }: SectionProps) {
  return (
    <View className={cx("lyx-section", className)}>
      <View className="lyx-section__header">
        <View className="lyx-section__title">{title}</View>
        {extra !== undefined ? <View className="lyx-section__extra">{extra}</View> : null}
      </View>
      {children}
    </View>
  );
}
