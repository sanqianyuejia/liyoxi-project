import type { ReactNode } from "react";

import { View } from "@tarojs/components";

import { cx } from "@/lib/cx";

import "./index.scss";

export interface PageBodyProps {
  /** 上面有副栏（页签、步骤条、筛选条）时顶边距为 0 */
  flush?: boolean;
  className?: string;
  children?: ReactNode;
}

/**
 * 内容区：左右边距 16，顶 4、底 20，卡片纵向排列、间距 12（规范 第 4.2 节）。
 * 页面级滚动，不套整页的滚动容器；底部操作栏用 FooterBar，它自己垫空白。
 */
export function PageBody({ flush = false, className, children }: PageBodyProps) {
  return (
    <View className={cx("lyx-page-body", flush && "lyx-page-body--flush", className)}>
      {children}
    </View>
  );
}
