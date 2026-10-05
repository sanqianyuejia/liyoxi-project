// 筛选表格骨架的用例（任务书 第 7 节第 7 条）。不装 DOM 测试库（任务书 第 11 节第 2 项）：
// 结构用 react-dom/server 渲染后断言；“筛选、页码、排序、页签进 URL”断言地址参数的读写函数，
// 点击后地址真的变了由冒烟（test/e2e/smoke.spec.ts）覆盖。
import { ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_PAGE_SIZE,
  hasActiveFilters,
  PAGE_SIZE_OPTIONS,
  pageCount,
  readSort,
  readTableSearch,
  toListQuery,
  withFilter,
  withFiltersReset,
  withKeyword,
  withPage,
  withPageSize,
  withSort,
  withTab,
  writeTableSearch,
} from "../lib/table-search";

import {
  clickableRowProps,
  isRowOwnEvent,
  QueryTablePage,
  ROW_INNER_CONTROLS,
  type QueryColumn,
  type QueryState,
} from "./QueryTablePage";

interface Row {
  id: string;
  name: string;
  points: number;
}

const columns: QueryColumn<Row>[] = [
  { key: "name", title: "商家", render: (row) => row.name },
  {
    key: "points",
    title: "可用积分",
    width: 100,
    align: "right",
    sortField: "points",
    render: (row) => row.points,
  },
];

const rows = (count: number): Row[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `r${index + 1}`,
    name: `门店 ${index + 1}`,
    points: index,
  }));

function render(query: QueryState<Row>, raw: Record<string, unknown> = {}): string {
  return renderToStaticMarkup(
    <ConfigProvider locale={zhCN}>
      <QueryTablePage<Row>
        label="样例列表"
        tabs={[
          { key: "all", label: "全部", count: 46 },
          { key: "pending", label: "待审核", count: 6 },
        ]}
        search={readTableSearch(raw, ["region"])}
        onSearchChange={() => {}}
        keywordPlaceholder="商家名称"
        filters={[
          {
            key: "region",
            placeholder: "全部区域",
            options: [{ value: "成华区", label: "成华区" }],
          },
        ]}
        columns={columns}
        rowKey={(row) => row.id}
        query={query}
        onRetry={() => {}}
      />
    </ConfigProvider>,
  );
}

const count = (html: string, needle: string): number => html.split(needle).length - 1;

describe("每页条数", () => {
  it("缺省 20，可选 10、20、50", () => {
    expect(DEFAULT_PAGE_SIZE).toBe(20);
    expect([...PAGE_SIZE_OPTIONS]).toEqual([10, 20, 50]);
    expect(readTableSearch({}).pageSize).toBe(20);
    expect(readTableSearch({ pageSize: 50 }).pageSize).toBe(50);
    // 三档之外的（原型示例的 12、手改地址的 1000）回到缺省
    expect(readTableSearch({ pageSize: 12 }).pageSize).toBe(20);
    expect(readTableSearch({ pageSize: "1000" }).pageSize).toBe(20);
    expect(() => withPageSize(readTableSearch({}), 30)).toThrow(/10、20、50/);
  });

  it("分页条显示“共 N 条”与当前每页条数，页数按总数算", () => {
    const html = render({ status: "success", items: rows(20), total: 46 });
    expect(html).toContain("共 46 条");
    expect(html).toContain("20 条");
    expect(html).toContain("/ 3 页");
    expect(pageCount(46, 20)).toBe(3);
    expect(pageCount(0, 20)).toBe(1);
    expect(html).toContain('aria-label="每页条数"');
  });
});

describe("筛选、页码、排序、页签进 URL", () => {
  it("读：地址参数 → 筛选状态；不认识的页码回到第 1 页，登记之外的参数丢掉", () => {
    const search = readTableSearch(
      {
        tab: "pending",
        q: " 火锅 ",
        page: "3",
        pageSize: 10,
        sort: "-points",
        region: "成华区",
        hack: "x",
      },
      ["region"],
    );
    expect(search).toEqual({
      tab: "pending",
      q: "火锅",
      page: 3,
      pageSize: 10,
      sort: "-points",
      filters: { region: "成华区" },
    });
    expect(readTableSearch({ page: "0" }).page).toBe(1);
    expect(readTableSearch({ page: "abc" }).page).toBe(1);
    // 关键词是纯数字时路由会把它解析成数字，照样读成字符串
    expect(readTableSearch({ q: 123 }).q).toBe("123");
    expect(() => readTableSearch({}, ["page"])).toThrow(/重名/);
  });

  it("写：缺省值不进地址；其余原样写回，读写往返一致", () => {
    expect(writeTableSearch(readTableSearch({}))).toEqual({});
    const search = readTableSearch(
      { tab: "pending", q: "火锅", page: 2, pageSize: 50, sort: "points", region: "成华区" },
      ["region"],
    );
    const written = writeTableSearch(search);
    expect(written).toEqual({
      tab: "pending",
      q: "火锅",
      region: "成华区",
      sort: "points",
      page: 2,
      pageSize: 50,
    });
    expect(readTableSearch(written, ["region"])).toEqual(search);
    // 给列表接口的查询参数总是带页码与条数
    expect(toListQuery(readTableSearch({}))).toEqual({ page: 1, pageSize: 20 });
  });

  it("改筛选、关键词、页签、排序、每页条数都回到第 1 页；翻页只改页码", () => {
    const start = readTableSearch({ page: 3, region: "成华区" }, ["region"]);
    expect(writeTableSearch(withPage(start, 2))).toEqual({ region: "成华区", page: 2 });
    expect(writeTableSearch(withFilter(start, "region", "武侯区"))).toEqual({ region: "武侯区" });
    expect(writeTableSearch(withFilter(start, "region", undefined))).toEqual({});
    expect(writeTableSearch(withKeyword(start, "火锅"))).toEqual({ q: "火锅", region: "成华区" });
    expect(writeTableSearch(withTab(start, "pending"))).toEqual({
      tab: "pending",
      region: "成华区",
    });
    expect(writeTableSearch(withPageSize(start, 50))).toEqual({ region: "成华区", pageSize: 50 });
    expect(writeTableSearch(withSort(start, "points", "desc"))).toEqual({
      region: "成华区",
      sort: "-points",
    });
    expect(writeTableSearch(withSort(start, "points", "asc"))).toEqual({
      region: "成华区",
      sort: "points",
    });
    expect(
      writeTableSearch(withSort(withSort(start, "points", "asc"), "points", undefined)),
    ).toEqual({ region: "成华区" });
    expect(withPage(start, 0).page).toBe(1);
  });

  it("重置筛选：关键词与筛选清空，页签、排序、每页条数保留", () => {
    const search = readTableSearch(
      { tab: "pending", q: "火锅", region: "成华区", sort: "-points", pageSize: 10, page: 2 },
      ["region"],
    );
    expect(hasActiveFilters(search)).toBe(true);
    const reset = withFiltersReset(search);
    expect(writeTableSearch(reset)).toEqual({ tab: "pending", sort: "-points", pageSize: 10 });
    expect(hasActiveFilters(reset)).toBe(false);
  });

  it("排序参数照约定 C44：-字段 表示降序", () => {
    expect(readSort("-points")).toEqual({ field: "points", order: "desc" });
    expect(readSort("points,id")).toEqual({ field: "points", order: "asc" });
    expect(readSort(undefined)).toBeNull();
  });

  it("地址里的状态反映到界面：当前页签、当前页、排序方向、有筛选时出现“重置筛选”", () => {
    const html = render(
      { status: "success", items: rows(10), total: 46 },
      { tab: "pending", page: 2, pageSize: 10, sort: "-points", region: "成华区" },
    );
    expect(html).toMatch(/aria-selected="true"[^>]*>\s*<span>待审核<\/span>/);
    expect(html).toContain('aria-label="第 2 页"');
    expect(html).toContain("/ 5 页");
    expect(html).toContain('aria-sort="descending"');
    expect(html).toContain("重置筛选");
    expect(render({ status: "success", items: rows(10), total: 46 })).not.toContain("重置筛选");
  });
});

describe("空、加载、出错重试三态", () => {
  it("加载：5 行骨架，不出表格与分页", () => {
    const html = render({ status: "loading" });
    expect(html).toContain('data-state="loading"');
    expect(count(html, 'class="lyx-skeleton-row"')).toBe(5);
    expect(html).not.toContain("<table");
    expect(html).not.toContain("共 ");
  });

  it("空：不出表格；没有数据写“暂无……”，筛选无结果写“没有符合条件的……”并提示换个条件", () => {
    const html = render({ status: "success", items: [], total: 0 });
    expect(html).toContain('data-state="empty"');
    expect(html).toContain("暂无记录");
    expect(html).not.toContain("没有符合条件的记录");
    expect(html).not.toContain("<table");
    expect(html).toContain("共 0 条");
    const filtered = render({ status: "success", items: [], total: 0 }, { region: "成华区" });
    expect(filtered).toContain("没有符合条件的记录");
    expect(filtered).toContain("换个筛选条件试试");
    expect(filtered).not.toContain("暂无记录");
    // 只换了页签不算筛选：还是“暂无……”
    expect(render({ status: "success", items: [], total: 0 }, { tab: "pending" })).toContain(
      "暂无记录",
    );
  });

  it("出错：说明加“重新加载”按钮，带服务端给的文案", () => {
    const html = render({ status: "error", message: "服务异常，请稍后重试" });
    expect(html).toContain('data-state="error"');
    expect(html).toContain("加载失败");
    expect(html).toContain("服务异常，请稍后重试");
    expect(html).toContain("重新加载");
    expect(html).not.toContain("<table");
  });

  it("有数据：一行一条，页签带计数，数值列右对齐", () => {
    const html = render({ status: "success", items: rows(3), total: 3 });
    expect(count(html, "<tr")).toBe(4);
    expect(html).toContain("门店 3");
    expect(html).toMatch(/全部<\/span><span class="lyx-tabs__count">46</);
    expect(html).toContain("text-align:right");
  });
});

describe("可点的行", () => {
  const renderRows = (onRowClick?: (row: Row) => void): string =>
    renderToStaticMarkup(
      <ConfigProvider locale={zhCN}>
        <QueryTablePage<Row>
          label="样例列表"
          search={readTableSearch({}, [])}
          onSearchChange={() => {}}
          columns={columns}
          rowKey={(row) => row.id}
          query={{ status: "success", items: rows(2), total: 2 }}
          onRetry={() => {}}
          onRowClick={onRowClick}
        />
      </ConfigProvider>,
    );

  it("给了 onRowClick：每个数据行能用 Tab 聚焦（tabindex=0）并带可点的样式；不给就没有", () => {
    const focusableRows = (html: string): number =>
      (html.match(/<tr[^>]*data-row-key[^>]*>/g) ?? []).filter((tag) =>
        tag.includes('tabindex="0"'),
      ).length;
    const clickable = renderRows(() => {});
    expect(focusableRows(clickable)).toBe(2);
    expect(count(clickable, "lyx-row--clickable")).toBe(2);
    const plain = renderRows();
    expect(count(plain, "data-row-key")).toBe(2);
    expect(focusableRows(plain)).toBe(0);
    expect(plain).not.toContain("lyx-row--clickable");
  });

  it("回车触发；行里的链接、按钮自己拿到的回车不算；别的键不算", () => {
    const hits: string[] = [];
    const props = clickableRowProps(() => hits.push("go"));
    const rowElement = {} as EventTarget;
    const key = (name: string, target: EventTarget) =>
      props.onKeyDown?.({ key: name, target, currentTarget: rowElement } as never);
    key("Enter", rowElement);
    expect(hits).toEqual(["go"]);
    key("Enter", {} as EventTarget);
    key(" ", rowElement);
    key("Tab", rowElement);
    expect(hits).toEqual(["go"]);
    props.onClick?.({} as never);
    expect(hits).toEqual(["go", "go"]);
    expect(props.tabIndex).toBe(0);
  });

  // 没有 DOM 环境（任务书 第 11 节第 2 项），这里搭一棵只有 closest、contains 的小树，核对“事件落在哪算这一行的”这条判断；
  // 浏览器里真实冒泡的点击与回车由冒烟核对（test/e2e/smoke.spec.ts 的“整行可点的表格”一步，样例页 /dev/rows）。
  interface FakeNode {
    name: string;
    parent: FakeNode | null;
    control: boolean;
    closest: (selector: string) => FakeNode | null;
    contains: (other: unknown) => boolean;
  }
  const selectorsSeen: string[] = [];
  const node = (name: string, parent: FakeNode | null, control = false): FakeNode => {
    const self: FakeNode = {
      name,
      parent,
      control,
      // 行内控件的那张单子原样交给 closest；这棵小树里“是不是控件”由 control 标出
      closest: (selector) => {
        selectorsSeen.push(selector);
        for (let at: FakeNode | null = self; at; at = at.parent) if (at.control) return at;
        return null;
      },
      contains: (other) => {
        for (let at = other as FakeNode | null; at; at = at.parent) if (at === self) return true;
        return false;
      },
    };
    return self;
  };
  // tbody > tr（可点的行，自己带 tabindex）> td > 文字、文字链（里面还有一层 span）、按钮；另有一个画在行外的浮层
  const body = node("tbody", null);
  const tr = node("tr", body, true);
  const cell = node("td", tr);
  const text = node("span", cell);
  const link = node("a", cell, true);
  const linkText = node("span", link);
  const button = node("button", cell, true);
  const popup = node("div.popup", null);
  const popupButton = node("button", popup, true);

  it("事件落在哪算这一行的：行自己、行里的空白与文字算；行里的链接、按钮（连同它们里面的字）不算；画在行外的浮层不算", () => {
    const own = (target: unknown): boolean => isRowOwnEvent({ target, currentTarget: tr });
    expect(own(tr)).toBe(true);
    expect(own(cell)).toBe(true);
    expect(own(text)).toBe(true);
    expect(own(link)).toBe(false);
    expect(own(linkText)).toBe(false);
    expect(own(button)).toBe(false);
    expect(own(popup)).toBe(false);
    expect(own(popupButton)).toBe(false);
    // 不是元素的落点（文字节点之类）不算
    expect(own(null)).toBe(false);
    expect(own("x")).toBe(false);
    // 找行内控件用的是同一张单子：链接、按钮、输入类控件、带 role 或 tabindex 的、antd 的几种外框
    expect(new Set(selectorsSeen)).toEqual(new Set([ROW_INNER_CONTROLS]));
    for (const part of [
      "a[href]",
      "button",
      "input",
      "select",
      "textarea",
      "label",
      "[role='button']",
      "[role='combobox']",
      "[tabindex]:not([tabindex='-1'])",
      ".ant-select",
    ]) {
      expect(ROW_INNER_CONTROLS.split(", ")).toContain(part);
    }
  });

  it("点击：点行里的空白触发；点行里的链接、按钮不触发（各管各的）；回车被行里的链接、按钮拿走时补发的点击也不触发", () => {
    const hits: string[] = [];
    const props = clickableRowProps(() => hits.push("row"));
    const click = (target: unknown) => props.onClick?.({ target, currentTarget: tr } as never);
    click(cell);
    click(text);
    expect(hits).toEqual(["row", "row"]);
    click(link);
    click(linkText);
    click(button);
    click(popupButton);
    expect(hits).toEqual(["row", "row"]);
    // 焦点在行里的链接上按回车：行收到的 keydown 落点是链接（不算），随后浏览器补发的 click 落点也是链接（不算）
    props.onKeyDown?.({ key: "Enter", target: link, currentTarget: tr } as never);
    click(link);
    expect(hits).toEqual(["row", "row"]);
    // 焦点在行自己上按回车：算
    props.onKeyDown?.({ key: "Enter", target: tr, currentTarget: tr } as never);
    expect(hits).toEqual(["row", "row", "row"]);
  });
});
