import { View } from "@tarojs/components";

import { cx } from "@/lib/cx";

import "./index.scss";

export interface ListFooterProps {
  /** loading 正在加载下一页；done 没有更多了 */
  status: "loading" | "done";
  loadingText?: string;
  doneText?: string;
  className?: string;
}

/** 触底加载：列表底部一行 12px 的文字（规范 第 12 节）。列表为空时不放它，放空状态 */
export function ListFooter({
  status,
  loadingText = "加载中……",
  doneText = "没有更多了",
  className,
}: ListFooterProps) {
  return (
    <View className={cx("lyx-list-footer", className)}>
      {status === "loading" ? loadingText : doneText}
    </View>
  );
}
