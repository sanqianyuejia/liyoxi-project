// 关键词搜索框：回车或清空时触发（筛选条与队列共用）。左侧放搜索图标（规范 第 5.2 节“筛选条”）。
import { Input } from "antd";

import { Icon } from "./Icon";

export interface KeywordInputProps {
  /** 地址里当前的关键词 */
  value: string | undefined;
  placeholder: string;
  width?: number;
  onSearch: (value: string) => void;
}

export function KeywordInput({ value, placeholder, width, onSearch }: KeywordInputProps) {
  return (
    <Input
      // 地址里的关键词变了（后退、重置筛选）就重建输入框，让它显示地址里的值
      key={`q:${value ?? ""}`}
      type="search"
      allowClear
      style={width ? { width } : undefined}
      prefix={<Icon name="search" size={16} />}
      placeholder={placeholder}
      aria-label={placeholder}
      defaultValue={value}
      onPressEnter={(event) => onSearch(event.currentTarget.value)}
      onChange={(event) => {
        // 点清除按钮：立刻按空关键词查
        if (event.type === "click" && event.target.value === "") onSearch("");
      }}
    />
  );
}
