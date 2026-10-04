// 状态标签：高 22 的全圆角标签，12px / 600，无描边（规范 第 5.5 节）。
// 色调名取状态字典（@liyoxi/shared/design/status-tone），这里只管某个色调长什么样，不认识业务状态。
import type { Tone } from "@liyoxi/shared/design/status-tone";
import type { ReactNode } from "react";

export interface StatusTagProps {
  tone: Tone;
  children: ReactNode;
  /** 详情页页头与队列详情卡里的大一号胶囊：高 24、13px（规范 第 5.2 节） */
  size?: "default" | "large";
}

export function StatusTag({ tone, children, size = "default" }: StatusTagProps) {
  const className = `lyx-tag lyx-tag--${tone}${size === "large" ? " lyx-tag--lg" : ""}`;
  return <span className={className}>{children}</span>;
}
