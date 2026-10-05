import type { IconName } from "@liyoxi/shared/design/icons";

import { View } from "@tarojs/components";

import { cx } from "@/lib/cx";

import "./index.scss";

export type { IconName };
/** 规范 第 9.1 节的常用尺寸 */
export type IconSize = 14 | 16 | 18 | 20 | 22 | 24;

export interface IconProps {
  /** 图标名，取 @liyoxi/shared/design/icons 的登记 */
  name: IconName;
  /** 边长，缺省 22（行首图标） */
  size?: IconSize;
  className?: string;
}

/**
 * 图标（规范 第 9.1 节）。小程序不能写内联 SVG：取形用 CSS mask，取色跟随文字色（currentColor），
 * 所以换颜色是给外层设 color，不给图标传色值。纯装饰，不带无障碍名称；没有文字的可点图标用 IconButton。
 */
export function Icon({ name, size = 22, className }: IconProps) {
  return <View className={cx("lyx-icon", `lyx-icon--${name}`, `lyx-icon--${size}`, className)} />;
}
