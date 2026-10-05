import { View } from "@tarojs/components";

import { cx } from "@/lib/cx";

import "./index.scss";

export interface SkeletonProps {
  /** 占几张卡片的位置，缺省 3 */
  cards?: number;
  /** 每张卡片标题下面几行文字，缺省 2 */
  rows?: number;
  /** 左侧带一块封面缩略图的位置（列表里带封面的卡片） */
  media?: boolean;
  className?: string;
}

/** 首次加载的骨架屏：用色块占住卡片里的标题与文字位置，不转圈（规范 第 12 节） */
export function Skeleton({ cards = 3, rows = 2, media = false, className }: SkeletonProps) {
  return (
    <View className={cx("lyx-skeleton", className)}>
      {Array.from({ length: Math.max(1, cards) }, (_, card) => (
        <View key={card} className="lyx-skeleton__card">
          {media ? <View className="lyx-skeleton__media" /> : null}
          <View className="lyx-skeleton__lines">
            <View className="lyx-skeleton__block lyx-skeleton__block--title" />
            {Array.from({ length: Math.max(0, rows) }, (_, row) => (
              <View key={row} className="lyx-skeleton__block" />
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}
