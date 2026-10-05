import { Text } from "@tarojs/components";

import { cx } from "@/lib/cx";

import { badgeText } from "./text";

import "./index.scss";

export interface BadgeProps {
  /** 数量：不大于 0 不显示 */
  count?: number;
  /** 超过它显示“max+”，缺省 99 */
  max?: number;
  /** 未读红点：10 × 10，带白色外环；给了它就不看 count */
  dot?: boolean;
  /** md 高 18（列表行），sm 高 16（筛选条内） */
  size?: "md" | "sm";
  className?: string;
}

/** 数字角标与未读红点（规范 第 4.3 节“标签与角标”）。底部标签栏上的角标用原生角标接口，不用它 */
export function Badge({ count, max = 99, dot = false, size = "md", className }: BadgeProps) {
  if (dot) return <Text className={cx("lyx-badge-dot", className)} />;
  const text = badgeText(count, max);
  if (text === null) return null;
  return <Text className={cx("lyx-badge", `lyx-badge--${size}`, className)}>{text}</Text>;
}
