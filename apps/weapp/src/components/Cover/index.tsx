import type { ReactNode } from "react";

import { Image, View } from "@tarojs/components";
import { useState } from "react";

import { cx } from "@/lib/cx";

import "./index.scss";

/**
 * grid 宫格封面（占满所在列，圆角 8）；scroll 横滑卡封面（占满外层给的宽度，圆角 10）；
 * thumb 单张缩略图 60 × 80；thumb-sm 一行并排多张时 42 × 56（圆角都是 6）
 */
export type CoverVariant = "grid" | "scroll" | "thumb" | "thumb-sm";

export interface CoverProps {
  /** 剧名：占位样式里竖排显示；也是这张图的无障碍名称 */
  title: string;
  /** 封面图地址。没有、加载中、加载失败时显示占位样式 */
  src?: string;
  /** 占位样式的底色：每部剧一个主色，来自数据（接口给的颜色字段），不是界面色 */
  color?: string;
  variant?: CoverVariant;
  /** 左上角的角标文字，由引导数据或接口给 */
  badge?: ReactNode;
  /** 角标文字的色调 */
  badgeTone?: "warning" | "info" | "neutral";
  /** 左下角的文字（如“80 集”） */
  caption?: ReactNode;
  /** 失效态：去色并降低不透明度（剧已下架） */
  invalid?: boolean;
  className?: string;
}

/** 短剧封面：一律 3:4，铺满裁切（规范 第 9.2 节）。占位样式是纯色块加竖排剧名，也是加载中与加载失败的兜底 */
export function Cover({
  title,
  src,
  color,
  variant = "grid",
  badge,
  badgeTone = "neutral",
  caption,
  invalid = false,
  className,
}: CoverProps) {
  const [failed, setFailed] = useState(false);
  const withImage = Boolean(src) && !failed;
  const small = variant === "thumb" || variant === "thumb-sm";
  return (
    <View
      className={cx(
        "lyx-cover",
        `lyx-cover--${variant}`,
        invalid && "lyx-cover--invalid",
        className,
      )}
      // 底色来自数据，只能写行内
      style={color ? { backgroundColor: color } : undefined}
      ariaRole="img"
      ariaLabel={title}
    >
      <View className="lyx-cover__frame" />
      <View className="lyx-cover__title">{title}</View>
      {withImage ? (
        <Image
          className="lyx-cover__image"
          src={src ?? ""}
          mode="aspectFill"
          lazyLoad
          onError={() => setFailed(true)}
        />
      ) : null}
      {withImage && caption !== undefined && !small ? <View className="lyx-cover__shade" /> : null}
      {badge !== undefined && !small ? (
        <View className={cx("lyx-cover__badge", `lyx-cover__badge--${badgeTone}`)}>{badge}</View>
      ) : null}
      {caption !== undefined && !small ? (
        <View className="lyx-cover__caption">{caption}</View>
      ) : null}
    </View>
  );
}
