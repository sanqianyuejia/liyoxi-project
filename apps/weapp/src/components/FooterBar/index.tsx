import type { ReactNode } from "react";

import { View } from "@tarojs/components";

import { cx } from "@/lib/cx";

import "./index.scss";

export interface FooterBarProps {
  /** 固定在页面底部（缺省）。为假时就地排，不留空白 */
  fixed?: boolean;
  /** 标签页里的操作栏（选剧单的结算栏）：固定在原生标签栏之上，不再加安全区 */
  aboveTabBar?: boolean;
  /** 里面的按钮等分（缺省）。金额加一个按钮、图标入口加按钮这类自己排的传 false */
  equal?: boolean;
  className?: string;
  children?: ReactNode;
}

/**
 * 底部操作栏：白底，顶边 1px，内容高 64，常见内容是 1 到 2 个 46 高的按钮（规范 第 4.2 节）。
 * 固定时自带一块等高的空白垫在内容区底部，页面不用自己留。
 */
export function FooterBar({
  fixed = true,
  aboveTabBar = false,
  equal = true,
  className,
  children,
}: FooterBarProps) {
  const safe = !aboveTabBar;
  return (
    <>
      {fixed ? (
        <View className={cx("lyx-footer-bar-spacer", safe && "lyx-footer-bar-spacer--safe")} />
      ) : null}
      <View
        className={cx(
          "lyx-footer-bar",
          fixed && "lyx-footer-bar--fixed",
          safe && "lyx-footer-bar--safe",
          equal && "lyx-footer-bar--equal",
          className,
        )}
      >
        {children}
      </View>
    </>
  );
}
