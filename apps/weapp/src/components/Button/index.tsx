import type { ButtonProps as TaroButtonProps } from "@tarojs/components";
import type { ReactNode } from "react";

// 按组件的路径引：从包的根上引，H5 构建会把整个组件库（连同动画库）都带进来
import NutButton from "@nutui/nutui-react-taro/dist/es/packages/button";
import { View } from "@tarojs/components";

import { Icon, type IconName } from "@/components/Icon";
import { cx } from "@/lib/cx";

import "./index.scss";

/** 主按钮、次按钮（中性）、次按钮（主色）、危险按钮（规范 第 4.3 节“按钮”） */
export type ButtonVariant = "primary" | "secondary" | "outline" | "danger";
/** 特大 48、大 46、中 40、小 32 */
export type ButtonSize = "xl" | "lg" | "md" | "sm";

/** 原生按钮的开放能力与表单属性照传（手机号快捷登录、分享、客服会话等） */
type NativeProps = Pick<
  TaroButtonProps,
  | "openType"
  | "formType"
  | "onGetPhoneNumber"
  | "onChooseAvatar"
  | "onContact"
  | "onOpenSetting"
  | "onAgreePrivacyAuthorization"
  | "sendMessageTitle"
  | "sendMessagePath"
  | "sendMessageImg"
  | "showMessageCard"
>;

export interface ButtonProps extends NativeProps {
  variant?: ButtonVariant;
  /** 缺省 lg（底部操作栏、弹层底部、卡片内的主要动作） */
  size?: ButtonSize;
  /** 占满一行。并排等分由外层（FooterBar、Sheet）排 */
  block?: boolean;
  /** 禁用。文字常常就是原因说明（“第 2 版制作中”），所以禁用态不用白字 */
  disabled?: boolean;
  /** 提交中：显示加载图标，文字不变，不可重复点击（规范 第 12 节） */
  loading?: boolean;
  /** 文字前的图标 */
  icon?: IconName;
  className?: string;
  onClick?: () => void;
  children?: ReactNode;
}

/**
 * 按钮：NutUI 的 Button 套一层，颜色、尺寸、圆角按规范覆盖。按下不透明度 0.7。
 * 一个页面或弹层只放一个主按钮；文字由页面传（“动词加宾语”，规范 第 7 节）。
 */
export function Button({
  variant = "primary",
  size = "lg",
  block = false,
  disabled = false,
  loading = false,
  icon,
  className,
  onClick,
  openType,
  children,
  ...native
}: ButtonProps) {
  const inactive = disabled || loading;
  const lead = loading ? (
    <View className="lyx-button__spinner" />
  ) : icon ? (
    <Icon name={icon} size={size === "sm" ? 16 : 18} />
  ) : null;
  return (
    <NutButton
      {...native}
      // 不可用时不触发开放能力，也不显示按下态
      openType={inactive ? undefined : openType}
      hoverClass={inactive ? "none" : "lyx-button--pressed"}
      className={cx(
        "lyx-button",
        `lyx-button--${variant}`,
        `lyx-button--${size}`,
        block && "lyx-button--block",
        disabled && "lyx-button--disabled",
        loading && "lyx-button--loading",
        className,
      )}
      disabled={inactive}
      icon={lead}
      onClick={onClick}
    >
      {children}
    </NutButton>
  );
}
