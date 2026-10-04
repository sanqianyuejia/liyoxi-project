// 构件自带的三态里的两态：空状态与出错重试（规范 第 5.2 节“空状态”、第 12 节“加载失败”；D7 第 5.7 节）。
// 加载态各构件自己画骨架（表格 5 行、队列 3 条）。
import { Button } from "antd";
import type { ReactNode } from "react";

export interface EmptyStateProps {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}

/** 空状态：内边距 56px 24px，居中；标题 15px / 600，说明 13px；无插图 */
export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="lyx-state" data-state="empty">
      <div className="lyx-state__title">{title}</div>
      {description ? <div className="lyx-state__desc">{description}</div> : null}
      {action ? <div className="lyx-state__action">{action}</div> : null}
    </div>
  );
}

export interface ErrorStateProps {
  message?: string;
  onRetry: () => void;
  retrying?: boolean;
}

/** 加载失败：说明加“重新加载”按钮 */
export function ErrorState({ message, onRetry, retrying }: ErrorStateProps) {
  return (
    <div className="lyx-state" data-state="error" role="alert">
      <div className="lyx-state__title">加载失败</div>
      <div className="lyx-state__desc">{message ?? "数据没有取到，请重新加载"}</div>
      <div className="lyx-state__action">
        <Button onClick={onRetry} loading={retrying}>
          重新加载
        </Button>
      </div>
    </div>
  );
}

/** 整页说明：没有访问权限、页面不存在、还没实现的页面 */
export function FullPageNotice({ title, description, action }: EmptyStateProps) {
  return (
    <div className="lyx-full-notice">
      <h1 className="lyx-full-notice__title">{title}</h1>
      {description ? <p className="lyx-full-notice__desc">{description}</p> : null}
      {action ? <div className="lyx-state__action">{action}</div> : null}
    </div>
  );
}
