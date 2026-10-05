import type { ReactNode } from "react";

import { Text, View } from "@tarojs/components";

import { Icon } from "@/components/Icon";
import { cx } from "@/lib/cx";

import "./index.scss";

export interface TextButtonProps {
  /** 主色（缺省）或弱化 */
  tone?: "primary" | "muted";
  /** 文字后带 14 的右箭头：卡片标题右侧的文字链（“积分明细”“查看全部”） */
  arrow?: boolean;
  disabled?: boolean;
  className?: string;
  onClick?: () => void;
  children?: ReactNode;
}

/** 文字按钮：无底无边，13px（规范 第 4.3 节“按钮”）。全部已读、撤回工单，以及卡片标题右侧的文字链 */
export function TextButton({
  tone = "primary",
  arrow = false,
  disabled = false,
  className,
  onClick,
  children,
}: TextButtonProps) {
  return (
    <View
      className={cx(
        "lyx-text-button",
        `lyx-text-button--${tone}`,
        disabled && "lyx-text-button--disabled",
        className,
      )}
      hoverClass={disabled ? "none" : "lyx-text-button--pressed"}
      ariaRole="button"
      onClick={disabled ? undefined : onClick}
    >
      <Text>{children}</Text>
      {arrow ? <Icon name="chevron-right" size={14} /> : null}
    </View>
  );
}
