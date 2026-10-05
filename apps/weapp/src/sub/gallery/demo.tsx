import type { PropsWithChildren } from "react";

import { View } from "@tarojs/components";

import { cx } from "@/lib/cx";

import "./demo.scss";

/** 预览里的一段：小标题加一组示例。row 横排并自动换行，缺省纵排 */
export function Demo({
  title,
  row = false,
  bare = false,
  children,
}: PropsWithChildren<{ title: string; row?: boolean; bare?: boolean }>) {
  return (
    <View className="lyx-demo">
      <View className="lyx-demo__title">{title}</View>
      <View
        className={cx(
          "lyx-demo__body",
          row && "lyx-demo__body--row",
          bare && "lyx-demo__body--bare",
        )}
      >
        {children}
      </View>
    </View>
  );
}
