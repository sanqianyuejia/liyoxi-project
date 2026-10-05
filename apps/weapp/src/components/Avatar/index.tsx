import { View } from "@tarojs/components";

import { cx } from "@/lib/cx";

import { firstGlyph } from "./glyph";

import "./index.scss";

export interface AvatarProps {
  /** 名字：只显示第一个字 */
  text: string;
  /** square 门店（圆角方形：56、44、40）；round 人物（圆形：40、36、32） */
  shape?: "square" | "round";
  size?: 56 | 44 | 40 | 36 | 32;
  /** soft 浅橙底、橙字（缺省）；solid 主色底、白字 */
  tone?: "soft" | "solid";
  className?: string;
}

/** 字形头像：衬线单字 900（规范 第 4.3 节“上传、播放与其他”）。系统没有宋体时回落为黑体 */
export function Avatar({
  text,
  shape = "square",
  size = 40,
  tone = "soft",
  className,
}: AvatarProps) {
  return (
    <View
      className={cx(
        "lyx-avatar",
        `lyx-avatar--${shape}`,
        `lyx-avatar--${size}`,
        `lyx-avatar--${tone}`,
        className,
      )}
    >
      {firstGlyph(text)}
    </View>
  );
}
