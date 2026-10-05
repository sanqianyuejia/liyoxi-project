import { Input as TaroInput, View } from "@tarojs/components";
import { useState } from "react";

import { Icon } from "@/components/Icon";
import { cx } from "@/lib/cx";

import "./index.scss";

export interface SearchBarProps {
  value?: string;
  placeholder?: string;
  /** 只作入口：不能输入，点了由页面跳去搜索页 */
  entry?: boolean;
  /** 进页面就聚焦（搜索页） */
  focus?: boolean;
  onChange?: (value: string) => void;
  /** 键盘上点了“搜索” */
  onConfirm?: (value: string) => void;
  /** entry 为真时点整个搜索框 */
  onClick?: () => void;
  className?: string;
}

/** 搜索框：高 40，胶囊形，放大镜 18，14px；输入中描边变主色（规范 第 4.3 节“表单”） */
export function SearchBar({
  value,
  placeholder,
  entry = false,
  focus = false,
  onChange,
  onConfirm,
  onClick,
  className,
}: SearchBarProps) {
  const [focused, setFocused] = useState(false);
  return (
    <View
      className={cx("lyx-search-bar", focused && "lyx-search-bar--focused", className)}
      hoverClass={entry ? "lyx-search-bar--pressed" : "none"}
      onClick={entry ? onClick : undefined}
    >
      <View className="lyx-search-bar__icon">
        <Icon name="search" size={18} />
      </View>
      {entry ? (
        <View className="lyx-search-bar__entry">{value || placeholder}</View>
      ) : (
        <TaroInput
          className="lyx-search-bar__native"
          placeholderClass="lyx-search-bar-placeholder"
          value={value}
          placeholder={placeholder}
          focus={focus}
          confirmType="search"
          onInput={(event) => onChange?.(event.detail.value)}
          onConfirm={(event) => onConfirm?.(event.detail.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
      )}
    </View>
  );
}
