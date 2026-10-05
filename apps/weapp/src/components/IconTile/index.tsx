import { View } from "@tarojs/components";

import { Icon, type IconName, type IconSize } from "@/components/Icon";
import { cx } from "@/lib/cx";

import "./index.scss";

export type IconTileSize = 44 | 40 | 36 | 32;

export interface IconTileProps {
  icon: IconName;
  /** 44（圆角 14，图标 24）、40（12，22）、36（10，20）、32（8，18） */
  size?: IconTileSize;
  /** primary 浅橙底、橙色图标（缺省）；neutral 灰底 */
  tone?: "primary" | "neutral";
  className?: string;
}

const ICON_SIZE: Record<IconTileSize, IconSize> = { 44: 24, 40: 22, 36: 20, 32: 18 };

/** 图标块：带底色的图标（规范 第 4.3 节“上传、播放与其他”）。首页快捷入口、入口卡行的行首 */
export function IconTile({ icon, size = 40, tone = "primary", className }: IconTileProps) {
  return (
    <View
      className={cx("lyx-icon-tile", `lyx-icon-tile--${size}`, `lyx-icon-tile--${tone}`, className)}
    >
      <Icon name={icon} size={ICON_SIZE[size]} />
    </View>
  );
}
