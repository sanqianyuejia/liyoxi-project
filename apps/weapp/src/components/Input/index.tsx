import type { InputProps as TaroInputProps } from "@tarojs/components";
import type { ReactNode } from "react";

import { Input as TaroInput, View } from "@tarojs/components";

import { cx } from "@/lib/cx";

import "./index.scss";

type NativeProps = Omit<
  TaroInputProps,
  "className" | "onInput" | "placeholderClass" | "disabled" | "style"
>;

export interface InputProps extends NativeProps {
  /** 出错：描边变红。错误文字由外层的 Field 显示 */
  error?: boolean;
  disabled?: boolean;
  /** 输入框右侧：单位、按钮（如“获取验证码”） */
  suffix?: ReactNode;
  /** 输入的内容变了 */
  onChange?: (value: string) => void;
  className?: string;
}

/**
 * 单行输入：高 44，圆角 10，描边（规范 第 4.3 节“表单”）。Taro 原生 Input 加样式，原生属性照传
 * （type、password、maxlength、confirmType、onConfirm、onBlur 等）。只读的值不用它，用文字块并说明原因（规范 第 8 节）。
 */
export function Input({
  error = false,
  disabled = false,
  suffix,
  onChange,
  className,
  ...native
}: InputProps) {
  return (
    <View
      className={cx(
        "lyx-input",
        error && "lyx-input--error",
        disabled && "lyx-input--disabled",
        className,
      )}
    >
      <TaroInput
        {...native}
        className="lyx-input__native"
        placeholderClass="lyx-input-placeholder"
        disabled={disabled}
        onInput={(event) => onChange?.(event.detail.value)}
      />
      {suffix !== undefined ? <View className="lyx-input__suffix">{suffix}</View> : null}
    </View>
  );
}
