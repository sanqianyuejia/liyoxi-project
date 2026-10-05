import type { ReactNode } from "react";

import { Text, View } from "@tarojs/components";

import { cx } from "@/lib/cx";

import "./index.scss";

export interface FieldProps {
  label: ReactNode;
  /** 必填：标签后加红色星号 */
  required?: boolean;
  /** 选填：标签右侧的 12px 小字，文案由页面传（“选填”） */
  optionalText?: string;
  /** 控件下方的说明 */
  hint?: ReactNode;
  /** 校验错误：给了就显示它，不显示说明（“请……”开头，规范 第 7 节） */
  error?: ReactNode;
  className?: string;
  /** 控件：Input、TextArea、SelectEntry、一组 Chip 等。出错时控件自己的描边由它的 error 属性管 */
  children?: ReactNode;
}

/** 表单字段：标签在上，控件在下，再下是说明或错误，三者间距 6；字段之间 16 由外层排（规范 第 4.3 节“表单”） */
export function Field({
  label,
  required = false,
  optionalText,
  hint,
  error,
  className,
  children,
}: FieldProps) {
  const hasError = error !== undefined && error !== null && error !== false && error !== "";
  return (
    <View className={cx("lyx-field", className)}>
      <View className="lyx-field__label-row">
        <View className="lyx-field__label">
          {label}
          {required ? <Text className="lyx-field__required">*</Text> : null}
        </View>
        {optionalText ? <Text className="lyx-field__optional">{optionalText}</Text> : null}
      </View>
      {children}
      {hasError ? (
        <View className="lyx-field__error" ariaRole="alert">
          {error}
        </View>
      ) : hint !== undefined ? (
        <View className="lyx-field__hint">{hint}</View>
      ) : null}
    </View>
  );
}
