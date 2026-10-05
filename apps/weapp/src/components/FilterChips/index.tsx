import { ScrollView, Text, View } from "@tarojs/components";

import { cx } from "@/lib/cx";

import "./index.scss";

export interface FilterChipItem<K extends string = string> {
  key: K;
  label: string;
  /** 这一类有多少条，跟在文字后面 */
  count?: number;
}

export interface FilterChipsProps<K extends string = string> {
  items: readonly FilterChipItem<K>[];
  value: K;
  onChange?: (key: K) => void;
  className?: string;
}

/**
 * 筛选胶囊：列表上方的分类筛选，可横向滑动，选中是深色（规范 第 4.3 节“页签、分段与筛选”）。
 * 表单里取值用 Chip（选中是橙色）。要顶出页边距做满幅时，外层给负的左右外边距。
 */
export function FilterChips<K extends string = string>({
  items,
  value,
  onChange,
  className,
}: FilterChipsProps<K>) {
  return (
    <ScrollView
      scrollX
      enhanced
      showScrollbar={false}
      className={cx("lyx-filter-chips", className)}
    >
      {items.map((item) => {
        const active = item.key === value;
        return (
          <View
            key={item.key}
            className={cx("lyx-filter-chips__item", active && "lyx-filter-chips__item--active")}
            hoverClass={active ? "none" : "lyx-filter-chips__item--pressed"}
            ariaRole="tab"
            onClick={active ? undefined : () => onChange?.(item.key)}
          >
            <Text>{item.label}</Text>
            {item.count !== undefined ? (
              <Text className="lyx-filter-chips__count">{item.count}</Text>
            ) : null}
          </View>
        );
      })}
    </ScrollView>
  );
}
