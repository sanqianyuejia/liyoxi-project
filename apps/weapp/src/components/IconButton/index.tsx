import { View } from "@tarojs/components";

import { Icon, type IconName } from "@/components/Icon";
import { cx } from "@/lib/cx";

import "./index.scss";

export interface IconButtonProps {
  icon: IconName;
  /** 无障碍名称，必填：没有文字的按钮必须有（规范 第 10 节） */
  label: string;
  /** 图标边长，缺省 22；返回用 24 */
  size?: 22 | 24;
  /** 缺省正文色；muted 是弱化（弹层关闭） */
  tone?: "default" | "muted";
  disabled?: boolean;
  className?: string;
  onClick?: () => void;
}

/** 图标按钮：点击区 44 × 44，图标 22 到 24（规范 第 4.3 节“按钮”）。返回、弹层关闭 */
export function IconButton({
  icon,
  label,
  size = 22,
  tone = "default",
  disabled = false,
  className,
  onClick,
}: IconButtonProps) {
  return (
    <View
      className={cx(
        "lyx-icon-button",
        `lyx-icon-button--${tone}`,
        disabled && "lyx-icon-button--disabled",
        className,
      )}
      hoverClass={disabled ? "none" : "lyx-icon-button--pressed"}
      ariaRole="button"
      ariaLabel={label}
      onClick={disabled ? undefined : onClick}
    >
      <Icon name={icon} size={size} />
    </View>
  );
}
