// 页签：表格卡、详情页、审核工作台共用（规范 第 5.2 节）。高 46，选中带 2px 主色下划线，计数徽标放进标签。
// 不用 antd 的 Tabs：它的计数徽标、行高与卡片内的留白都要整段覆盖，自己写更短。
export interface TabItem {
  key: string;
  label: string;
  /** 计数；页签带数字的由对应的 summary 接口给（约定 C83） */
  count?: number;
  /** 未开放的页签：置灰、不可点 */
  disabled?: boolean;
}

export interface TabsProps {
  items: readonly TabItem[];
  activeKey: string;
  onChange: (key: string) => void;
  label: string;
}

export function Tabs({ items, activeKey, onChange, label }: TabsProps) {
  return (
    <div className="lyx-tabs" role="tablist" aria-label={label}>
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          role="tab"
          className="lyx-tabs__item lyx-focusable"
          aria-selected={item.key === activeKey}
          disabled={item.disabled}
          onClick={() => {
            if (item.key !== activeKey) onChange(item.key);
          }}
        >
          <span>{item.label}</span>
          {item.count !== undefined ? <span className="lyx-tabs__count">{item.count}</span> : null}
        </button>
      ))}
    </div>
  );
}
