import type { ReactNode } from "react";

import { Empty } from "@/components/Empty";

export interface LoadErrorProps {
  /** 一行说明：原因与下一步，由页面按错误符号名给 */
  message: ReactNode;
  /** 按钮的文字 */
  retryText?: string;
  onRetry?: () => void;
  /** 正在重新加载：按钮显示加载图标，不可重复点 */
  retrying?: boolean;
  className?: string;
}

/** 加载失败：内容区居中，一行说明加“重新加载”按钮，样式同空状态（规范 第 12 节） */
export function LoadError({
  message,
  retryText = "重新加载",
  onRetry,
  retrying = false,
  className,
}: LoadErrorProps) {
  return (
    <Empty
      title={message}
      actionText={retryText}
      actionLoading={retrying}
      onAction={onRetry}
      className={className}
    />
  );
}
