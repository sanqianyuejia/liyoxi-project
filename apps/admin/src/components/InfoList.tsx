// 信息分组：固定标签宽的两列网格（规范 第 5.2 节“信息分组”、第 5.5 节 InfoList）。
import type { ReactNode } from "react";

export interface InfoListProps {
  items: readonly { label: string; value: ReactNode }[];
  /** 标签宽：64（缺省）、84、110 三档 */
  labelWidth?: 64 | 84 | 110;
}

export function InfoList({ items, labelWidth = 64 }: InfoListProps) {
  const className =
    labelWidth === 110
      ? "lyx-info lyx-info--xwide"
      : labelWidth === 84
        ? "lyx-info lyx-info--wide"
        : "lyx-info";
  return (
    <dl className={className}>
      {items.map((item) => (
        <div key={item.label} style={{ display: "contents" }}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
