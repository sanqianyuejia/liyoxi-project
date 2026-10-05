import { View } from "@tarojs/components";

import { Badge } from "@/components/Badge";
import { cx } from "@/lib/cx";

import "./index.scss";

export interface TabItem<K extends string = string> {
  key: K;
  label: string;
  /** 页签上的数字角标（小号） */
  badge?: number;
}

export interface TabsProps<K extends string = string> {
  items: readonly TabItem<K>[];
  value: K;
  onChange?: (key: K) => void;
  /** 吸顶：作副栏用时打开，不随内容滚动（规范 第 4.2 节） */
  sticky?: boolean;
  className?: string;
}

/**
 * 下划线页签：白底通栏，项高 44，选中加 2px 主色下划线（规范 第 4.3 节“页签、分段与筛选”）。
 * 用它的页面把原生导航栏底色设成白色，与它连成一体（订单列表、发布任务）。
 */
export function Tabs<K extends string = string>({
  items,
  value,
  onChange,
  sticky = false,
  className,
}: TabsProps<K>) {
  return (
    <View className={cx("lyx-tabs", sticky && "lyx-tabs--sticky", className)}>
      {items.map((item) => {
        const active = item.key === value;
        return (
          <View
            key={item.key}
            className={cx("lyx-tabs__item", active && "lyx-tabs__item--active")}
            hoverClass={active ? "none" : "lyx-tabs__item--pressed"}
            ariaRole="tab"
            onClick={active ? undefined : () => onChange?.(item.key)}
          >
            <View className="lyx-tabs__label">
              {item.label}
              <Badge count={item.badge} size="sm" className="lyx-tabs__badge" />
            </View>
          </View>
        );
      })}
    </View>
  );
}
