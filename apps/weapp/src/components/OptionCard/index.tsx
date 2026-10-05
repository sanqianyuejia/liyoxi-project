import type { ReactNode } from "react";

import { View } from "@tarojs/components";

import { cx } from "@/lib/cx";

import "./index.scss";

export interface OptionCardProps {
  title: ReactNode;
  description?: ReactNode;
  /** 右侧：价格、积分等，由服务端下发，页面不自算 */
  extra?: ReactNode;
  selected?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
  children?: ReactNode;
}

/** 选项卡片、单选卡：圆角 12，内边距 10 12；选中主色描边加浅橙底（规范 第 4.3 节“表单”） */
export function OptionCard({
  title,
  description,
  extra,
  selected = false,
  disabled = false,
  onClick,
  className,
  children,
}: OptionCardProps) {
  return (
    <View
      className={cx(
        "lyx-option-card",
        selected && "lyx-option-card--selected",
        disabled && "lyx-option-card--disabled",
        className,
      )}
      hoverClass={disabled ? "none" : "lyx-option-card--pressed"}
      ariaRole="radio"
      onClick={disabled ? undefined : onClick}
    >
      <View className="lyx-option-card__row">
        <View className="lyx-option-card__main">
          <View className="lyx-option-card__title">{title}</View>
          {description !== undefined ? (
            <View className="lyx-option-card__description">{description}</View>
          ) : null}
        </View>
        {extra !== undefined ? <View className="lyx-option-card__extra">{extra}</View> : null}
      </View>
      {children}
    </View>
  );
}
