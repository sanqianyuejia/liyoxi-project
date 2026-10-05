import type { ReactNode } from "react";

import { Text, View } from "@tarojs/components";

import { Icon, type IconName } from "@/components/Icon";
import { cx } from "@/lib/cx";

import "./index.scss";

export interface AddButtonProps {
  /** 缺省加号 */
  icon?: IconName;
  disabled?: boolean;
  className?: string;
  onClick?: () => void;
  children?: ReactNode;
}

/** 虚线添加按钮：高 48，圆角 14，不是胶囊形（规范 第 4.3 节“按钮”）。绑定新账号、添加主推服务、选择文件 */
export function AddButton({
  icon = "plus",
  disabled = false,
  className,
  onClick,
  children,
}: AddButtonProps) {
  return (
    <View
      className={cx("lyx-add-button", disabled && "lyx-add-button--disabled", className)}
      hoverClass={disabled ? "none" : "lyx-add-button--pressed"}
      ariaRole="button"
      onClick={disabled ? undefined : onClick}
    >
      <Icon name={icon} size={20} />
      <Text>{children}</Text>
    </View>
  );
}
