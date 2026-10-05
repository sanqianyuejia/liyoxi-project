import type { ReactNode } from "react";

import { Text } from "@tarojs/components";

import { cx } from "@/lib/cx";

import "./index.scss";

export interface InfoTagProps {
  className?: string;
  children?: ReactNode;
}

/** 信息标签：形状同状态标签，灰底、正文色、常规字重，用于行业、城市等属性（规范 第 4.3 节“标签与角标”） */
export function InfoTag({ className, children }: InfoTagProps) {
  return <Text className={cx("lyx-info-tag", className)}>{children}</Text>;
}
