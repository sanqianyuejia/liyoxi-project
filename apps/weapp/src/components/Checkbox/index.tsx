import type { ReactNode } from "react";

import { View } from "@tarojs/components";

import { Icon } from "@/components/Icon";
import { cx } from "@/lib/cx";

import "./index.scss";

export interface CheckboxProps {
  checked: boolean;
  /** square 复选框（圆角 4）；round 单选框（圆形） */
  shape?: "square" | "round";
  disabled?: boolean;
  onChange?: (checked: boolean) => void;
  className?: string;
  /** 右侧的文字；整行可点 */
  children?: ReactNode;
}

/** 复选框、单选框：18 × 18，选中主色底加白色对勾（规范 第 4.3 节“表单”）。整行可点，行高补足到 44 */
export function Checkbox({
  checked,
  shape = "square",
  disabled = false,
  onChange,
  className,
  children,
}: CheckboxProps) {
  return (
    <View
      className={cx(
        "lyx-checkbox",
        `lyx-checkbox--${shape}`,
        checked && "lyx-checkbox--checked",
        disabled && "lyx-checkbox--disabled",
        className,
      )}
      hoverClass={disabled ? "none" : "lyx-checkbox--pressed"}
      ariaRole={shape === "round" ? "radio" : "checkbox"}
      // 单选框点已选中的那个不取消
      onClick={disabled || (shape === "round" && checked) ? undefined : () => onChange?.(!checked)}
    >
      <View className="lyx-checkbox__box">{checked ? <Icon name="check" size={14} /> : null}</View>
      {children !== undefined ? <View className="lyx-checkbox__label">{children}</View> : null}
    </View>
  );
}
