import type { PropsWithChildren } from "react";

import { View } from "@tarojs/components";

import { getNavMetrics } from "@/lib/nav";

import "./index.scss";

/**
 * 自绘导航栏：只给首页与登录页用（规范 第 4.2 节；第 14 节第 4 项），其余页面用原生导航栏。
 * 运行时读胶囊位置避让：内容与胶囊同高同轴，右侧让出胶囊并留 8px。占位的那一层把页面内容顶到导航栏下面。
 */
export function NavBar({ children }: PropsWithChildren) {
  const { top, height, right } = getNavMetrics();
  return (
    <View className="lyx-navbar">
      <View
        className="lyx-navbar__bar"
        style={{ paddingTop: `${top}px`, paddingRight: `${right}px` }}
      >
        <View className="lyx-navbar__content" style={{ height: `${height}px` }}>
          {children}
        </View>
      </View>
      <View style={{ height: `${top + height}px` }} />
    </View>
  );
}
