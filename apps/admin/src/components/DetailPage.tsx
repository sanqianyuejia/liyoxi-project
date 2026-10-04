// 详情页骨架（D7 第 5.3 节 DetailPage；规范 第 5.2 节“详情页”）：页头、状态、进度区、页签内容、侧栏卡片。
// 页面只填：标题与状态、操作按钮、页签与各页签的内容、侧栏卡片。当前页签由调用方接到地址上。
// 自带三态里的加载与出错重试；详情不存在由页面按 NOT_FOUND 处理。
import type { ReactNode } from "react";

import { PageHeader } from "./PageHeader";
import { ErrorState } from "./StateBlock";
import { Tabs, type TabItem } from "./Tabs";

export interface DetailTab extends TabItem {
  content: ReactNode;
}

export interface DetailSideCard {
  key: string;
  title: string;
  content: ReactNode;
}

export type DetailState =
  { status: "loading" } | { status: "error"; message?: string } | { status: "ready" };

export interface DetailPageProps {
  title: string;
  subtitle?: ReactNode;
  /** 状态胶囊（高 24）与属性胶囊 */
  tags?: ReactNode;
  /** 右侧操作按钮（高 40）；模块等级只有查看时页面不传写操作 */
  actions?: ReactNode;
  /** 页头下面的进度或指标区（工单的步骤条、商家的指标卡） */
  progress?: ReactNode;
  tabs: readonly DetailTab[];
  activeTab: string;
  onTabChange: (key: string) => void;
  /** 侧栏信息卡，宽 340 */
  aside?: readonly DetailSideCard[];
  state: DetailState;
  onRetry: () => void;
}

export function DetailPage({
  title,
  subtitle,
  tags,
  actions,
  progress,
  tabs,
  activeTab,
  onTabChange,
  aside = [],
  state,
  onRetry,
}: DetailPageProps) {
  if (state.status === "error") {
    return (
      <section className="lyx-card">
        <ErrorState message={state.message} onRetry={onRetry} />
      </section>
    );
  }
  if (state.status === "loading") {
    return (
      <section className="lyx-card lyx-skeleton-rows" data-state="loading" aria-busy="true">
        {Array.from({ length: 5 }, (_, index) => (
          <div key={index} className="lyx-skeleton-row">
            <span className="lyx-skeleton-bar lyx-skeleton-bar--short" />
            <span className="lyx-skeleton-bar" />
          </div>
        ))}
      </section>
    );
  }
  const current = tabs.find((tab) => tab.key === activeTab && !tab.disabled) ?? tabs[0];
  return (
    <>
      <PageHeader title={title} subtitle={subtitle} tags={tags} extra={actions} />
      {progress}
      <div className="lyx-detail">
        <section className="lyx-card lyx-detail__main">
          <Tabs
            label={`${title}的页签`}
            items={tabs}
            activeKey={current?.key ?? ""}
            onChange={onTabChange}
          />
          <div className="lyx-detail__panel" role="tabpanel">
            {current?.content}
          </div>
        </section>
        {aside.length > 0 ? (
          <aside className="lyx-detail__aside">
            {aside.map((card) => (
              <section key={card.key} className="lyx-card lyx-side-card">
                <h2 className="lyx-side-card__title">{card.title}</h2>
                {card.content}
              </section>
            ))}
          </aside>
        ) : null}
      </div>
    </>
  );
}
