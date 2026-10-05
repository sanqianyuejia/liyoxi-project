import NutTextArea from "@nutui/nutui-react-taro/dist/es/packages/textarea";
import { View } from "@tarojs/components";
import { useState } from "react";

import { cx } from "@/lib/cx";

import "./index.scss";

export interface TextAreaProps {
  /** 受控的值；不给就由组件自己记 */
  value?: string;
  defaultValue?: string;
  /** 占位文案由页面传（“如：……”或“请……”，规范 第 7 节） */
  placeholder?: string;
  /** 字数上限。给了就在右下角显示计数（“12/200”） */
  maxLength?: number;
  error?: boolean;
  disabled?: boolean;
  onChange?: (value: string) => void;
  className?: string;
}

/** 多行输入：NutUI 的 TextArea 套一层，圆角 10、描边、14px、行高 1.5，右下角计数（规范 第 4.3 节“表单”） */
export function TextArea({
  value,
  defaultValue = "",
  placeholder,
  maxLength,
  error = false,
  disabled = false,
  onChange,
  className,
}: TextAreaProps) {
  const [inner, setInner] = useState(defaultValue);
  const current = value ?? inner;
  return (
    <View
      className={cx(
        "lyx-textarea",
        error && "lyx-textarea--error",
        disabled && "lyx-textarea--disabled",
        className,
      )}
    >
      <NutTextArea
        plain
        value={current}
        placeholder={placeholder ?? ""}
        maxLength={maxLength ?? -1}
        disabled={disabled}
        onChange={(next) => {
          setInner(next);
          onChange?.(next);
        }}
      />
      {maxLength !== undefined ? (
        <View className="lyx-textarea__count">
          {current.length}/{maxLength}
        </View>
      ) : null}
    </View>
  );
}
