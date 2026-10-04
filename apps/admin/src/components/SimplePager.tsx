// 分页（规范 第 5.2 节“分页”）：左侧“共 N 条 · 每页 N 条”，右侧上一页、当前页、“/ N 页”、下一页。
// 每页条数可选 10、20、50，缺省 20（计划 第 4.2 节 Q5 的默认）。
import { Select } from "antd";

import { PAGE_SIZE_OPTIONS, pageCount } from "../lib/table-search";

import { Icon } from "./Icon";

export interface SimplePagerProps {
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}

export function SimplePager({
  total,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
}: SimplePagerProps) {
  const pages = pageCount(total, pageSize);
  return (
    <div className="lyx-pager">
      <div className="lyx-pager__summary">
        <span>共 {total.toLocaleString("en-US")} 条</span>
        <span aria-hidden="true">·</span>
        <span>每页</span>
        <Select
          size="small"
          aria-label="每页条数"
          value={pageSize}
          onChange={onPageSizeChange}
          options={PAGE_SIZE_OPTIONS.map((size) => ({ value: size, label: `${size} 条` }))}
          popupMatchSelectWidth={false}
        />
      </div>
      <div className="lyx-pager__nav">
        <button
          type="button"
          className="lyx-pager__button lyx-focusable"
          aria-label="上一页"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          <Icon name="chevron-left" size={16} />
        </button>
        <span className="lyx-pager__current" aria-label={`第 ${page} 页`}>
          {page}
        </span>
        <span>/ {pages} 页</span>
        <button
          type="button"
          className="lyx-pager__button lyx-focusable"
          aria-label="下一页"
          disabled={page >= pages}
          onClick={() => onPageChange(page + 1)}
        >
          <Icon name="chevron-right" size={16} />
        </button>
      </div>
    </div>
  );
}
