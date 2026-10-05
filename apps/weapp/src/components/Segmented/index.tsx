import { View } from "@tarojs/components";

import { cx } from "@/lib/cx";

import "./index.scss";

export interface SegmentedItem<K extends string = string> {
  key: K;
  label: string;
}

export interface SegmentedProps<K extends string = string> {
  /** 两到三项 */
  items: readonly SegmentedItem<K>[];
  value: K;
  onChange?: (key: K) => void;
  className?: string;
}

/** 分段控件：两到三个互斥视图的切换。轨道高 40、内边距 3，选中项白底（规范 第 4.3 节“页签、分段与筛选”） */
export function Segmented<K extends string = string>({
  items,
  value,
  onChange,
  className,
}: SegmentedProps<K>) {
  return (
    <View className={cx("lyx-segmented", className)}>
      {items.map((item) => {
        const active = item.key === value;
        return (
          <View
            key={item.key}
            className={cx("lyx-segmented__item", active && "lyx-segmented__item--active")}
            hoverClass={active ? "none" : "lyx-segmented__item--pressed"}
            ariaRole="tab"
            onClick={active ? undefined : () => onChange?.(item.key)}
          >
            {item.label}
          </View>
        );
      })}
    </View>
  );
}
