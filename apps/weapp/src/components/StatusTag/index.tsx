import type { ReactNode } from "react";

import { Text } from "@tarojs/components";

import { cx } from "@/lib/cx";

import type { StatusTone } from "./tone";

import "./index.scss";

export { merchantStatusByEnum, merchantStatusByState } from "./tone";
export type { MerchantStatus, StatusTone } from "./tone";

export interface StatusTagProps {
  /** 色调：success、info、warning、danger、neutral。由状态取色表得出（merchantStatusByEnum），页面不自己挑颜色 */
  tone: StatusTone;
  /** 纯文字状态：无底，13px，用在列表卡片右上角 */
  plain?: boolean;
  className?: string;
  children?: ReactNode;
}

/** 状态标签（规范 第 4.3 节“标签与角标”；第 6 节）。状态必须有文字，不单靠颜色 */
export function StatusTag({ tone, plain = false, className, children }: StatusTagProps) {
  return (
    <Text
      className={cx(
        "lyx-status-tag",
        `lyx-status-tag--${tone}`,
        plain && "lyx-status-tag--plain",
        className,
      )}
    >
      {children}
    </Text>
  );
}
