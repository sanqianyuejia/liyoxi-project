import type { ReactNode } from "react";

import { View } from "@tarojs/components";

import { cx } from "@/lib/cx";

import "./index.scss";

/** 四种状态色调，加中性款（缺省） */
export type NoteTone = "neutral" | "success" | "info" | "warning" | "danger";

export interface NoteProps {
  tone?: NoteTone;
  className?: string;
  children?: ReactNode;
}

/** 提示条：常驻说明，放在相关内容上方。圆角 10，13px，无图标、无关闭（规范 第 4.3 节“提示与反馈”；第 8 节） */
export function Note({ tone = "neutral", className, children }: NoteProps) {
  return <View className={cx("lyx-note", `lyx-note--${tone}`, className)}>{children}</View>;
}
