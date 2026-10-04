// 筛选表格骨架（D7 第 5.3 节 QueryTablePage；规范 第 5.2 节“筛选表格页”）。
// 页签、筛选条、表格、分页都在同一张表格卡里。页面只填：页签、筛选项、列定义、取数结果、行操作。
//   - 筛选、页码、排序、页签全部进 URL：本构件是受控的，状态从 search 进、改动从 onSearchChange 出，
//     由路由把它们接到地址上（lib/table-search.ts；样例见 src/dev/TableSample.tsx）。
//   - 服务端分页，缺省每页 20 条，可选 10、20、50；翻页保留上一页数据（取数用 lib/query.ts 的 LIST_QUERY）。
//   - 自带三态：首次加载 5 行骨架、空状态、出错重试。
// 导出按钮在 M7（ExportButton），本构件先留 toolbar 位置。
import { Button, Select, Table, type TableColumnsType } from "antd";
import type { ReactNode } from "react";

import {
  hasActiveFilters,
  readSort,
  withFilter,
  withFiltersReset,
  withKeyword,
  withPage,
  withPageSize,
  withSort,
  withTab,
  type TableSearch,
} from "../lib/table-search";

import { KeywordInput } from "./KeywordInput";
import { SimplePager } from "./SimplePager";
import { EmptyState, ErrorState } from "./StateBlock";
import { Tabs, type TabItem } from "./Tabs";

export interface FilterOption {
  value: string;
  label: string;
}

/** 筛选项：下拉。键是 DTO 字段名（约定 C45） */
export interface FilterField {
  key: string;
  /** 没选时显示的字，如“全部审核状态” */
  placeholder: string;
  options: readonly FilterOption[];
  width?: number;
}

export interface QueryColumn<Row> {
  key: string;
  title: string;
  render: (row: Row) => ReactNode;
  /** 固定列宽；不给的是弹性列，窗口更宽时伸展（规范 第 5.1 节） */
  width?: number;
  /** 数值列右对齐 */
  align?: "left" | "right";
  /** 可排序时给排序字段名（契约里该列表声明的可排序字段） */
  sortField?: string;
}

export type QueryState<Row> =
  | { status: "loading" }
  | { status: "error"; message?: string }
  | { status: "success"; items: readonly Row[]; total: number };

export interface QueryTablePageProps<Row> {
  /** 表格的名字，读屏用 */
  label: string;
  tabs?: readonly TabItem[];
  /** 没有 tab 参数时落在哪个页签；缺省第一个 */
  defaultTab?: string;
  search: TableSearch;
  onSearchChange: (next: TableSearch) => void;
  /** 关键词搜索框的占位文字；不给就不显示搜索框 */
  keywordPlaceholder?: string;
  filters?: readonly FilterField[];
  columns: readonly QueryColumn<Row>[];
  rowKey: (row: Row) => string;
  query: QueryState<Row>;
  /** 正在后台重取（翻页、筛选后）：表格保留上一份数据并显示加载中 */
  refreshing?: boolean;
  onRetry: () => void;
  onRowClick?: (row: Row) => void;
  /** 行强调：超时或异常行 */
  rowTone?: (row: Row) => "danger" | undefined;
  /**
   * 空状态的文案（规范 第 7 节）：没有数据写“暂无……”（title、description，缺省“暂无记录”）；
   * 筛选无结果写“没有符合条件的……”（filteredTitle，缺省“没有符合条件的记录”）
   */
  empty?: { title: string; description?: string; filteredTitle?: string };
  /** 筛选条右侧的附加操作（导出按钮等） */
  toolbar?: ReactNode;
}

const SKELETON_ROWS = 5;

function SkeletonRows() {
  return (
    <div className="lyx-skeleton-rows" data-state="loading" aria-busy="true" aria-label="加载中">
      {Array.from({ length: SKELETON_ROWS }, (_, index) => (
        <div key={index} className="lyx-skeleton-row">
          <span className="lyx-skeleton-bar lyx-skeleton-bar--short" />
          <span className="lyx-skeleton-bar" />
          <span className="lyx-skeleton-bar lyx-skeleton-bar--short" />
          <span className="lyx-skeleton-bar lyx-skeleton-bar--short" />
        </div>
      ))}
    </div>
  );
}

export function QueryTablePage<Row extends object>({
  label,
  tabs,
  defaultTab,
  search,
  onSearchChange,
  keywordPlaceholder,
  filters = [],
  columns,
  rowKey,
  query,
  refreshing,
  onRetry,
  onRowClick,
  rowTone,
  empty,
  toolbar,
}: QueryTablePageProps<Row>) {
  const sort = readSort(search.sort);
  const activeTab = search.tab ?? defaultTab ?? tabs?.[0]?.key ?? "";

  const tableColumns: TableColumnsType<Row> = columns.map((column) => ({
    key: column.key,
    title: column.title,
    width: column.width,
    align: column.align,
    ellipsis: column.width === undefined,
    render: (_value: unknown, row: Row) => column.render(row),
    sorter: column.sortField !== undefined,
    sortOrder:
      column.sortField !== undefined && sort?.field === column.sortField
        ? sort.order === "asc"
          ? "ascend"
          : "descend"
        : null,
    showSorterTooltip: false,
  }));

  const hasFilterBar = keywordPlaceholder !== undefined || filters.length > 0 || toolbar;

  return (
    <section className="lyx-card lyx-table-card" aria-label={label}>
      {tabs && tabs.length > 0 ? (
        <Tabs
          label={`${label}的页签`}
          items={tabs}
          activeKey={activeTab}
          onChange={(key) => onSearchChange(withTab(search, key))}
        />
      ) : null}
      {hasFilterBar ? (
        <div className="lyx-filter-bar">
          {keywordPlaceholder !== undefined ? (
            <KeywordInput
              value={search.q}
              width={220}
              placeholder={keywordPlaceholder}
              onSearch={(value) => onSearchChange(withKeyword(search, value))}
            />
          ) : null}
          {filters.map((field) => (
            <Select
              key={field.key}
              allowClear
              style={{ width: field.width ?? 148 }}
              placeholder={field.placeholder}
              aria-label={field.placeholder}
              value={search.filters[field.key]}
              options={[...field.options]}
              onChange={(value: string | undefined) =>
                onSearchChange(withFilter(search, field.key, value))
              }
            />
          ))}
          {toolbar}
          {hasActiveFilters(search) ? (
            <Button
              type="link"
              className="lyx-filter-bar__reset"
              onClick={() => onSearchChange(withFiltersReset(search))}
            >
              重置筛选
            </Button>
          ) : null}
        </div>
      ) : null}
      {query.status === "loading" ? <SkeletonRows /> : null}
      {query.status === "error" ? (
        <ErrorState message={query.message} onRetry={onRetry} retrying={refreshing} />
      ) : null}
      {query.status === "success" && query.items.length === 0 ? (
        hasActiveFilters(search) ? (
          <EmptyState
            title={empty?.filteredTitle ?? "没有符合条件的记录"}
            description="换个筛选条件试试"
          />
        ) : (
          <EmptyState title={empty?.title ?? "暂无记录"} description={empty?.description} />
        )
      ) : null}
      {query.status === "success" && query.items.length > 0 ? (
        <Table<Row>
          className="lyx-table"
          tableLayout="fixed"
          columns={tableColumns}
          dataSource={[...query.items]}
          rowKey={rowKey}
          pagination={false}
          loading={refreshing}
          sortDirections={["ascend", "descend"]}
          rowClassName={(row) =>
            [
              rowTone?.(row) === "danger" ? "lyx-row--danger" : "",
              onRowClick ? "lyx-row--clickable" : "",
            ]
              .filter(Boolean)
              .join(" ")
          }
          onRow={onRowClick ? (row) => ({ onClick: () => onRowClick(row) }) : undefined}
          onChange={(_pagination, _filters, sorter) => {
            const single = Array.isArray(sorter) ? sorter[0] : sorter;
            const column = columns.find((item) => item.key === single?.columnKey);
            if (!column?.sortField) return;
            const order =
              single?.order === "ascend" ? "asc" : single?.order === "descend" ? "desc" : undefined;
            onSearchChange(withSort(search, column.sortField, order));
          }}
        />
      ) : null}
      {query.status === "success" ? (
        <SimplePager
          total={query.total}
          page={search.page}
          pageSize={search.pageSize}
          onPageChange={(page) => onSearchChange(withPage(search, page))}
          onPageSizeChange={(pageSize) => onSearchChange(withPageSize(search, pageSize))}
        />
      ) : null}
    </section>
  );
}
