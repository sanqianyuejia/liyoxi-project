// 页头：衬线标题、副标题、右侧操作或行内统计（规范 第 5.1、5.5 节）。
// 详情页的页头在标题后面带状态胶囊与属性胶囊，右侧操作按钮高 40（规范 第 5.2 节）。
import type { ReactNode } from "react";

export interface PageHeaderProps {
  title: string;
  subtitle?: ReactNode;
  /** 标题后面的状态胶囊、属性胶囊 */
  tags?: ReactNode;
  /** 右侧：操作按钮或行内统计 */
  extra?: ReactNode;
}

export function PageHeader({ title, subtitle, tags, extra }: PageHeaderProps) {
  return (
    <header className="lyx-page-header">
      <div className="lyx-page-header__main">
        <div className="lyx-page-header__title-row">
          <h1 className="lyx-page-header__title">{title}</h1>
          {tags ? <div className="lyx-page-header__tags">{tags}</div> : null}
        </div>
        {subtitle ? <p className="lyx-page-header__subtitle">{subtitle}</p> : null}
      </div>
      {extra ? <div className="lyx-page-header__extra">{extra}</div> : null}
    </header>
  );
}
